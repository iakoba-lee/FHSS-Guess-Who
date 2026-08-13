require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT, 10) || 8080;
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || process.env.MANAGER_KEY;
// When DATA_DIR is set (production Docker), live data lives on a persistent volume.
// Without it, data stays in the repo data/ folder for local development.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
const REPO_DATA_DIR = path.join(ROOT, 'data');
const SEED_DATA_DIR = fs.existsSync(path.join(ROOT, 'seed-data'))
  ? path.join(ROOT, 'seed-data')
  : REPO_DATA_DIR;
const DATA_ROOT = DATA_DIR || REPO_DATA_DIR;
const LEGACY_PEOPLE_FILE = path.join(DATA_ROOT, 'people.json');
const GROUPS_FILE = path.join(DATA_ROOT, 'groups.json');
const LEADERBOARD_FILE = path.join(DATA_ROOT, 'leaderboard.json');
const UPLOAD_DIR = DATA_DIR
  ? path.join(DATA_DIR, 'uploads')
  : path.join(ROOT, 'public', 'uploads');
// Roster photos (media/students, etc.) persist on the data volume in Docker.
const MEDIA_ROOT = DATA_DIR
  ? path.join(DATA_DIR, 'media')
  : path.join(ROOT, 'public', 'media');
const PUBLIC_MEDIA_ROOT = path.join(ROOT, 'public', 'media');
const LEADERBOARD_SIZE = 10;
const IMPORT_GROUP_ID = 'student-employees';
const MAX_JSON_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMPORT_BODY_BYTES = 100 * 1024 * 1024;

function peopleFileFor(groupId) {
  return path.join(DATA_ROOT, `${groupId}.json`);
}

function seedPathFor(filename) {
  return path.join(SEED_DATA_DIR, filename);
}

/** Default quiz pools seeded when groups.json is missing. */
const PEOPLE_FIELDS = [
  {
    id: 'photo',
    label: 'Photo',
    type: 'photo',
    required: false,
    shown: true,
    guessed: false,
    filter_by_gender: false
  },
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    required: true,
    shown: false,
    guessed: true,
    filter_by_gender: true
  },
  {
    id: 'position',
    label: 'Position / Detail',
    type: 'text',
    required: true,
    shown: false,
    guessed: true,
    filter_by_gender: false
  },
  {
    id: 'gender',
    label: 'Gender for Name Options',
    type: 'gender',
    required: true,
    shown: false,
    guessed: false,
    filter_by_gender: false
  }
];

const PLACE_FIELDS = [
  {
    id: 'photo',
    label: 'Photo',
    type: 'photo',
    required: false,
    shown: true,
    guessed: false,
    filter_by_gender: false
  },
  {
    id: 'name',
    label: 'Full Name',
    type: 'text',
    required: true,
    shown: false,
    guessed: true,
    filter_by_gender: false
  },
  {
    id: 'abbreviation',
    label: 'Abbreviation',
    type: 'text',
    required: true,
    shown: false,
    guessed: true,
    filter_by_gender: false
  }
];

const STUDENT_EMPLOYEE_FIELDS = [
  {
    id: 'photo',
    label: 'Photo',
    type: 'photo',
    required: false,
    shown: true,
    guessed: false,
    filter_by_gender: false
  },
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    required: true,
    shown: false,
    guessed: true,
    filter_by_gender: true
  },
  {
    id: 'team',
    label: 'Team',
    type: 'text',
    required: true,
    shown: false,
    guessed: true,
    filter_by_gender: false
  },
  {
    id: 'fun_fact',
    label: 'Fun Fact',
    type: 'text',
    required: false,
    shown: false,
    guessed: true,
    filter_by_gender: false
  },
  {
    id: 'gender',
    label: 'Gender for Name Options',
    type: 'gender',
    required: true,
    shown: false,
    guessed: false,
    filter_by_gender: false
  }
];

function defaultFieldsForGroupId(groupId) {
  if (groupId === 'clients' || groupId === 'internal-staff') {
    return PEOPLE_FIELDS.map((field) => ({ ...field }));
  }
  if (groupId === 'student-employees') {
    return STUDENT_EMPLOYEE_FIELDS.map((field) => ({ ...field }));
  }
  return PLACE_FIELDS.map((field) => ({ ...field }));
}

const DEFAULT_GROUPS = [
  {
    id: 'clients',
    label: 'Clients',
    description: 'Important FHSS staff and faculty clients',
    fields: defaultFieldsForGroupId('clients')
  },
  {
    id: 'internal-staff',
    label: 'Internal Staff',
    description: 'People within FHSS Computing Services',
    fields: defaultFieldsForGroupId('internal-staff')
  },
  {
    id: 'locations',
    label: 'Locations',
    description: 'FHSS buildings and locations',
    fields: defaultFieldsForGroupId('locations')
  },
  {
    id: 'departments',
    label: 'Departments',
    description: 'FHSS departments we service',
    fields: defaultFieldsForGroupId('departments')
  },
  {
    id: 'student-employees',
    label: 'Student Employees',
    description: 'Guess their name, team, and a fun fact from their photo',
    fields: defaultFieldsForGroupId('student-employees')
  }
];
const DEFAULT_GROUP = 'clients';
let groups = DEFAULT_GROUPS.map((group) => ({
  ...group,
  fields: (group.fields || []).map((field) => ({ ...field }))
}));
let groupIds = new Set(groups.map((group) => group.id));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const games = new Map();
const GAME_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GAME_TTL_MS = 8 * 60 * 60 * 1000;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomToken(length = 32) {
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += GAME_CODE_ALPHABET[Math.floor(Math.random() * GAME_CODE_ALPHABET.length)];
  }
  return token;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function makeGameCode() {
  let code = randomToken(6);
  while (games.has(code)) code = randomToken(6);
  return code;
}

function createGameState(code = makeGameCode()) {
  return {
    code,
    status: 'lobby',
    round: 0,
    max_rounds: 15,
    selected_groups: [DEFAULT_GROUP],
    current_person: null,
    used_person_ids: [],
    options_name: [],
    options_pos: [],
    options: {},
    guess_fields: [],
    teams: {},
    host_id: `host_${randomInt(1000, 9999)}`,
    host_token: randomToken(40),
    start_time: 0,
    time_limit: 30,
    scores_recorded: false,
    created_at: Date.now(),
    updated_at: Date.now()
  };
}

function rebuildGroupIds() {
  groupIds = new Set(groups.map((group) => group.id));
}

function normalizeGroups(input) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string' && input.trim()
      ? input.split(',')
      : [];
  const normalized = [...new Set(
    values
      .map((value) => String(value || '').trim())
      .filter((id) => groupIds.has(id))
  )];
  return normalized.length > 0 ? normalized : [DEFAULT_GROUP];
}

function slugifyGroupId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function slugifyFieldId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

function sanitizeField(input = {}, index = 0) {
  let type = String(input.type || 'text').trim().toLowerCase();
  if (!['text', 'photo', 'gender'].includes(type)) type = 'text';

  let id = slugifyFieldId(input.id || input.label || `field_${index + 1}`);
  if (!id) id = `field_${index + 1}`;
  if (type === 'photo') id = 'photo';
  if (type === 'gender') id = 'gender';

  const label = String(input.label || id).trim() || id;
  const guessed = type === 'text' ? Boolean(input.guessed) : false;
  const shown = type === 'photo' ? (input.shown !== false) : Boolean(input.shown);

  return {
    id,
    label,
    type,
    required: type === 'photo' ? false : Boolean(input.required),
    shown,
    guessed,
    filter_by_gender: type === 'text' ? Boolean(input.filter_by_gender) : false
  };
}

function sanitizeGroupFields(fields, groupId) {
  const source = Array.isArray(fields) && fields.length > 0
    ? fields
    : defaultFieldsForGroupId(groupId);
  const normalized = [];
  const seen = new Set();

  source.forEach((entry, index) => {
    try {
      const field = sanitizeField(entry, index);
      if (seen.has(field.id)) return;
      seen.add(field.id);
      normalized.push(field);
    } catch (error) {
      // Skip invalid field definitions.
    }
  });

  if (!seen.has('name')) {
    normalized.unshift({
      id: 'name',
      label: 'Name',
      type: 'text',
      required: true,
      shown: false,
      guessed: true,
      filter_by_gender: false
    });
  }

  if (!normalized.some((field) => field.type === 'photo')) {
    normalized.unshift({
      id: 'photo',
      label: 'Photo',
      type: 'photo',
      required: false,
      shown: true,
      guessed: false,
      filter_by_gender: false
    });
  }

  if (!normalized.some((field) => field.guessed && field.type === 'text')) {
    const firstText = normalized.find((field) => field.type === 'text');
    if (firstText) firstText.guessed = true;
  }

  return normalized;
}

function sanitizeGroup(input, { requireId = false } = {}) {
  const label = String(input.label || '').trim();
  const description = String(input.description || '').trim();
  if (!label) {
    throw new Error('Group label is required.');
  }

  let id = String(input.id || '').trim().toLowerCase();
  if (!id) id = slugifyGroupId(label);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('Group id must be lowercase letters, numbers, and hyphens.');
  }
  if (requireId && !input.id) {
    throw new Error('Group id is required.');
  }

  return {
    id,
    label,
    description,
    fields: sanitizeGroupFields(input.fields, id)
  };
}

function getGroupById(groupId) {
  return groups.find((group) => group.id === groupId) || null;
}

function mergeFieldsForGroups(groupIdsInput) {
  const ids = normalizeGroups(groupIdsInput);
  const merged = [];
  const seen = new Set();
  ids.forEach((id) => {
    const group = getGroupById(id);
    const fields = group?.fields || defaultFieldsForGroupId(id);
    fields.forEach((field) => {
      if (seen.has(field.id)) return;
      seen.add(field.id);
      merged.push({ ...field });
    });
  });
  return merged.length > 0 ? merged : defaultFieldsForGroupId(DEFAULT_GROUP);
}

function getGuessFields(groupIdsInput) {
  return mergeFieldsForGroups(groupIdsInput).filter(
    (field) => field.type === 'text' && field.guessed
  );
}

function getPersonQuizGroups(person, selectedGroupIds) {
  const selected = normalizeGroups(selectedGroupIds);
  const personGroups = normalizeGroups(person?.groups);
  const overlap = personGroups.filter((id) => selected.includes(id));
  if (overlap.length > 0) return overlap;
  if (personGroups.length > 0) return personGroups;
  return selected;
}

function getPersonFieldValue(person, fieldId) {
  if (!person) return '';
  if (fieldId === 'name') return String(person.name || '');
  if (fieldId === 'position') return String(person.position || '');
  if (fieldId === 'gender') return String(person.gender || 'F');
  if (fieldId === 'photo') return String(person.image || '');

  const valueKeys = [fieldId];
  if (fieldId.includes('-')) valueKeys.push(fieldId.replace(/-/g, '_'));
  if (fieldId.includes('_')) valueKeys.push(fieldId.replace(/_/g, '-'));
  for (const key of valueKeys) {
    const fromValues = person.values && person.values[key] != null
      ? String(person.values[key]).trim()
      : '';
    if (fromValues) return fromValues;
  }

  // Migration: older place/department entries stored abbreviation in position.
  if (fieldId === 'abbreviation') return String(person.position || '');
  // Placeholder so games remain playable before real fun facts are written.
  if (fieldId === 'fun_fact' || fieldId === 'fun-fact') return 'TBD';
  return '';
}

function groupsWithCounts() {
  return groups.map((group) => ({
    ...group,
    count: people.filter((person) => personInGroups(person, [group.id])).length
  }));
}

function groupsKey(groups) {
  return normalizeGroups(groups).slice().sort().join('+');
}

function personInGroups(person, groupIds) {
  const personGroups = normalizeGroups(person.groups);
  return groupIds.some((id) => personGroups.includes(id));
}

function getPeopleForGroups(groupIds) {
  const groups = normalizeGroups(groupIds);
  return people.filter((person) => personInGroups(person, groups));
}

function pruneExpiredGames() {
  const now = Date.now();
  for (const [code, game] of games.entries()) {
    if (now - game.updated_at > GAME_TTL_MS) games.delete(code);
  }
}

function touchGame(game) {
  game.updated_at = Date.now();
}

function findPlayerSession(teamName) {
  const normalizedName = String(teamName || '').trim().toLowerCase();
  if (!normalizedName) return null;

  pruneExpiredGames();
  let best = null;

  for (const game of games.values()) {
    const teamId = Object.entries(game.teams).find(
      ([, team]) => team.name.toLowerCase() === normalizedName
    )?.[0];
    if (!teamId) continue;

    if (!best || game.updated_at > best.game.updated_at) {
      best = { game, teamId };
    }
  }

  return best;
}

function publicGameMeta(game) {
  return {
    code: game.code,
    status: game.status,
    round: game.round,
    max_rounds: game.max_rounds,
    selected_groups: normalizeGroups(game.selected_groups),
    team_count: Object.keys(game.teams).length
  };
}

function getCodeFrom(req, url, data = {}) {
  return normalizeCode(data.code || url.searchParams.get('code') || req.headers['x-game-code']);
}

function getHostTokenFrom(req, url, data = {}) {
  return String(data.host_token || url.searchParams.get('host_token') || req.headers['x-host-token'] || '');
}

function getGameOrError(code) {
  const game = games.get(normalizeCode(code));
  if (!game) {
    const error = new Error('Game code not found. Check the host screen and try again.');
    error.status = 404;
    throw error;
  }
  touchGame(game);
  return game;
}

function requireHost(req, url, data = {}) {
  const game = getGameOrError(getCodeFrom(req, url, data));
  const token = getHostTokenFrom(req, url, data);
  if (!token || token !== game.host_token) {
    const error = new Error('Host access is required.');
    error.status = 403;
    throw error;
  }
  return game;
}

function isManagerAuthorized(req, data = {}) {
  const suppliedPassword = String(
    data.manager_password ||
    data.manager_key ||
    req.headers['x-manager-password'] ||
    req.headers['x-manager-key'] ||
    ''
  );
  return Boolean(MANAGER_PASSWORD) && suppliedPassword === MANAGER_PASSWORD;
}

function requireManager(req, data = {}) {
  if (!MANAGER_PASSWORD) {
    const error = new Error('Manager password is not configured. Set MANAGER_PASSWORD before editing staff.');
    error.status = 503;
    throw error;
  }

  if (!isManagerAuthorized(req, data)) {
    const error = new Error('Manager access is required.');
    error.status = 403;
    throw error;
  }
}

function makeId(person, index = 0) {
  const source = `${person.name || 'staff'}-${person.position || 'role'}-${index}`;
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `staff-${index}`;
}

function withIds(records) {
  const seen = new Set();
  return records.map((person, index) => {
    let id = person.id || makeId(person, index);
    let suffix = 2;
    while (seen.has(id)) {
      id = `${person.id || makeId(person, index)}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    return {
      ...person,
      id,
      groups: normalizeGroups(person.groups)
    };
  });
}

function ensureDataDir() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  if (DATA_DIR) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(path.join(MEDIA_ROOT, 'students'), { recursive: true });

  // Only seed into a separate DATA_DIR volume (Docker). Local already uses repo data/.
  if (DATA_DIR && path.resolve(DATA_DIR) !== path.resolve(SEED_DATA_DIR)) {
    const copyIfMissing = (dest, seedPath, emptyContent) => {
      if (fs.existsSync(dest)) return;
      if (fs.existsSync(seedPath)) {
        fs.copyFileSync(seedPath, dest);
        console.log(`Seeded ${path.basename(dest)} from repo defaults.`);
        return;
      }
      fs.writeFileSync(dest, emptyContent);
    };

    copyIfMissing(GROUPS_FILE, seedPathFor('groups.json'), `${JSON.stringify(DEFAULT_GROUPS, null, 4)}\n`);
    copyIfMissing(LEADERBOARD_FILE, seedPathFor('leaderboard.json'), '[]\n');

    const seedGroupIds = DEFAULT_GROUPS.map((group) => group.id);
    let seededAnyGroupFile = false;
    for (const groupId of seedGroupIds) {
      const dest = peopleFileFor(groupId);
      const seedPath = seedPathFor(`${groupId}.json`);
      if (!fs.existsSync(dest) && fs.existsSync(seedPath)) {
        copyIfMissing(dest, seedPath, '[]\n');
        seededAnyGroupFile = true;
      }
    }
    if (!seededAnyGroupFile && !seedGroupIds.some((id) => fs.existsSync(peopleFileFor(id)))) {
      copyIfMissing(LEGACY_PEOPLE_FILE, seedPathFor('people.json'), '[]\n');
    }

    const legacyUploads = path.join(ROOT, 'public', 'uploads');
    if (fs.existsSync(legacyUploads)) {
      for (const name of fs.readdirSync(legacyUploads)) {
        if (name.startsWith('.')) continue;
        const src = path.join(legacyUploads, name);
        const dest = path.join(UPLOAD_DIR, name);
        if (fs.statSync(src).isFile() && !fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
    }
  }
}

function loadGroups() {
  try {
    if (!fs.existsSync(GROUPS_FILE)) {
      const seeded = DEFAULT_GROUPS.map((group) => sanitizeGroup(group, { requireId: true }));
      fs.writeFileSync(GROUPS_FILE, `${JSON.stringify(seeded, null, 4)}\n`);
      return seeded;
    }
    const raw = fs.readFileSync(GROUPS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_GROUPS.map((group) => sanitizeGroup(group, { requireId: true }));
    }
    const loaded = [];
    const seen = new Set();
    let needsPersist = false;
    for (const entry of parsed) {
      try {
        const hadFields = Array.isArray(entry.fields) && entry.fields.length > 0;
        const group = sanitizeGroup(entry, { requireId: true });
        if (!hadFields) needsPersist = true;
        if (seen.has(group.id)) continue;
        seen.add(group.id);
        loaded.push(group);
      } catch (error) {
        // Skip invalid entries rather than failing the whole catalog.
      }
    }
    if (!seen.has(DEFAULT_GROUP)) {
      loaded.unshift(sanitizeGroup(DEFAULT_GROUPS[0], { requireId: true }));
      needsPersist = true;
    }
    const result = loaded.length > 0
      ? loaded
      : DEFAULT_GROUPS.map((group) => sanitizeGroup(group, { requireId: true }));
    if (needsPersist) {
      fs.writeFileSync(GROUPS_FILE, `${JSON.stringify(result, null, 4)}\n`);
      console.log('Migrated groups.json to include field schemas.');
    }
    return result;
  } catch (error) {
    console.error(`Unable to load groups.json: ${error.message}`);
    return DEFAULT_GROUPS.map((group) => sanitizeGroup(group, { requireId: true }));
  }
}

function saveGroups() {
  fs.writeFileSync(GROUPS_FILE, `${JSON.stringify(groups, null, 4)}\n`);
}

function primaryGroupId(person) {
  const ids = Array.isArray(person?.groups) ? person.groups : [];
  for (const id of ids) {
    if (groupIds.has(id)) return id;
  }
  return DEFAULT_GROUP;
}

function ensurePeopleFileForGroup(groupId) {
  if (!groupId || !/^[a-z0-9-]+$/.test(groupId)) return;
  const filePath = peopleFileFor(groupId);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]\n');
  }
}

function readPeopleFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Unable to read ${path.basename(filePath)}: ${error.message}`);
    return [];
  }
}

function writePeopleFile(filePath, entries) {
  fs.writeFileSync(filePath, `${JSON.stringify(entries, null, 4)}\n`);
}

function migrateLegacyPeopleFileIfNeeded(knownGroupIds) {
  const anyGroupFile = knownGroupIds.some((id) => fs.existsSync(peopleFileFor(id)));
  if (anyGroupFile || !fs.existsSync(LEGACY_PEOPLE_FILE)) return false;

  const legacy = readPeopleFile(LEGACY_PEOPLE_FILE);
  const partitions = new Map();
  for (const id of knownGroupIds) partitions.set(id, []);

  legacy.forEach((person) => {
    const groupsForPerson = Array.isArray(person.groups) && person.groups.length
      ? person.groups
      : [DEFAULT_GROUP];
    const primary = groupsForPerson.find((id) => knownGroupIds.includes(id)) || DEFAULT_GROUP;
    if (!partitions.has(primary)) partitions.set(primary, []);
    partitions.get(primary).push({
      ...person,
      groups: groupsForPerson
    });
  });

  for (const [groupId, entries] of partitions.entries()) {
    writePeopleFile(peopleFileFor(groupId), entries);
  }

  const bakPath = `${LEGACY_PEOPLE_FILE}.bak`;
  try {
    if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
    fs.renameSync(LEGACY_PEOPLE_FILE, bakPath);
  } catch (error) {
    console.error(`Unable to rename legacy people.json: ${error.message}`);
  }
  console.log('Migrated people.json into per-group roster files.');
  return true;
}

function loadPeople() {
  try {
    const knownGroupIds = groups.map((group) => group.id);
    migrateLegacyPeopleFileIfNeeded(knownGroupIds);

    const merged = [];
    for (const groupId of knownGroupIds) {
      const filePath = peopleFileFor(groupId);
      if (!fs.existsSync(filePath)) {
        writePeopleFile(filePath, []);
        continue;
      }
      const entries = readPeopleFile(filePath);
      entries.forEach((person) => {
        const personGroups = Array.isArray(person.groups) && person.groups.length
          ? person.groups
          : [groupId];
        merged.push({
          ...person,
          groups: personGroups
        });
      });
    }

    return withIds(merged);
  } catch (error) {
    console.error(`Unable to load roster files: ${error.message}`);
    return [];
  }
}

function savePeople() {
  const partitions = new Map();
  for (const group of groups) {
    partitions.set(group.id, []);
    ensurePeopleFileForGroup(group.id);
  }

  people.forEach((person) => {
    const primary = primaryGroupId(person);
    if (!partitions.has(primary)) partitions.set(primary, []);
    partitions.get(primary).push(person);
  });

  for (const [groupId, entries] of partitions.entries()) {
    writePeopleFile(peopleFileFor(groupId), entries);
  }
}

function normalizeLeaderboardEntry(entry) {
  const groups = normalizeGroups(entry.groups);
  return {
    ...entry,
    groups,
    groups_key: entry.groups_key || groupsKey(groups),
    questions: Number.parseInt(entry.questions ?? entry.rounds, 10) || 15,
    rounds: Number.parseInt(entry.rounds ?? entry.questions, 10) || 15
  };
}

function loadLeaderboard() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.map(normalizeLeaderboardEntry);
    const needsPersist = parsed.some(
      (entry) => !Array.isArray(entry.groups) || entry.groups.length === 0 || entry.questions == null
    );
    if (needsPersist && entries.length > 0) {
      saveLeaderboard(entries);
      console.log('Migrated leaderboard.json to include group tags (default: clients).');
    }
    return entries;
  } catch (error) {
    return [];
  }
}

function saveLeaderboard(entries) {
  fs.writeFileSync(LEADERBOARD_FILE, `${JSON.stringify(entries, null, 2)}\n`);
}

function normalizeMaxRounds(value) {
  const rounds = Number.parseInt(value, 10);
  if (!Number.isFinite(rounds) || rounds < 1) return 15;
  const cap = Math.max(people.length, 1);
  return Math.min(Math.floor(rounds), cap);
}

function filterLeaderboard(entries, groupFilter) {
  if (!groupFilter || groupFilter === 'all' || (Array.isArray(groupFilter) && groupFilter[0] === 'all')) {
    return entries
      .slice()
      .sort((a, b) => b.score - a.score || new Date(b.recorded_at) - new Date(a.recorded_at));
  }
  const key = groupsKey(groupFilter);
  return entries.filter((entry) => (entry.groups_key || groupsKey(entry.groups)) === key);
}

function topScoresForKey(entries, key, size = LEADERBOARD_SIZE) {
  return entries
    .filter((entry) => (entry.groups_key || groupsKey(entry.groups)) === key)
    .sort((a, b) => b.score - a.score || new Date(b.recorded_at) - new Date(a.recorded_at))
    .slice(0, size);
}

function recordLeaderboardScores(game) {
  const groups = normalizeGroups(game.selected_groups);
  const entries = loadLeaderboard();
  const recordedAt = new Date().toISOString();
  const questions = game.max_rounds || 15;
  const key = groupsKey(groups);

  Object.values(game.teams).forEach((team) => {
    if (!team.name || team.score <= 0) return;
    entries.push({
      team_name: team.name,
      score: team.score,
      questions,
      rounds: questions,
      groups,
      groups_key: key,
      recorded_at: recordedAt
    });
  });

  // Keep top N per mode key (single group or multi-group combo).
  const keys = [...new Set(entries.map((entry) => entry.groups_key || groupsKey(entry.groups)))];
  const retained = keys.flatMap((entryKey) => topScoresForKey(entries, entryKey));
  retained.sort((a, b) => b.score - a.score || new Date(b.recorded_at) - new Date(a.recorded_at));
  saveLeaderboard(retained);
}

function finalizeGame(game) {
  if (!game.scores_recorded) {
    recordLeaderboardScores(game);
    game.scores_recorded = true;
  }
  game.status = 'end';
  touchGame(game);
}

function sanitizePerson(input) {
  const groups = normalizeGroups(input.groups);
  const schema = mergeFieldsForGroups(groups);
  const incomingValues = input.values && typeof input.values === 'object' ? input.values : {};
  const values = {};

  let name = String(input.name || incomingValues.name || '').trim();
  let position = String(input.position || incomingValues.position || '').trim();
  let gender = String(input.gender || incomingValues.gender || 'F').trim().toUpperCase() === 'M' ? 'M' : 'F';
  const image = String(input.image || '').trim();

  schema.forEach((field) => {
    if (field.type === 'photo') return;

    let raw = incomingValues[field.id];
    if (raw == null && field.id === 'name') raw = input.name;
    if (raw == null && field.id === 'position') raw = input.position;
    if (raw == null && field.id === 'gender') raw = input.gender;
    if (raw == null && field.id === 'abbreviation') {
      raw = incomingValues.abbreviation ?? input.abbreviation ?? input.position;
    }

    const value = String(raw ?? '').trim();
    if (field.required && field.type !== 'gender' && !value) {
      throw new Error(`${field.label} is required.`);
    }

    if (field.type === 'gender') {
      gender = value.toUpperCase() === 'M' ? 'M' : 'F';
      return;
    }

    if (field.id === 'name') {
      name = value;
      return;
    }

    if (field.id === 'position') {
      position = value;
      values.position = value;
      return;
    }

    values[field.id] = value;
    if (field.id === 'abbreviation' && !position) position = value;
  });

  if (!name) throw new Error('Name is required.');

  if (!position) {
    const secondary = schema.find((field) => field.type === 'text' && field.id !== 'name');
    if (secondary) position = values[secondary.id] || '—';
    else position = '—';
  }

  return { name, position, image, gender, groups, values };
}

function parseDataUrlImage(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Photo must be a PNG, JPEG, GIF, or WebP image.');
  }
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const ext = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp'
  }[mime];
  return { mime, ext, buffer: Buffer.from(match[2], 'base64') };
}

function saveUploadedPhoto(photo) {
  if (!photo || !photo.dataUrl) return '';

  const { ext, buffer } = parseDataUrlImage(photo.dataUrl);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const baseName = String(photo.name || 'staff-photo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'staff-photo';
  const filename = `${Date.now()}-${baseName}${ext}`;
  const diskPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(diskPath, buffer);
  return `uploads/${filename}`;
}

function slugifyFileBase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'photo';
}

function photoBasename(value) {
  return path.basename(String(value || '').replace(/\\/g, '/')).toLowerCase();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const input = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      if (row.some((value) => String(value).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (ch === '\r') continue;
    cell += ch;
  }
  row.push(cell);
  if (row.some((value) => String(value).trim() !== '')) rows.push(row);
  return rows;
}

function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      if (!header) return;
      obj[header] = String(cells[index] ?? '').trim();
    });
    return obj;
  });
}

function ensureImportGroup() {
  if (groupIds.has(IMPORT_GROUP_ID)) return getGroupById(IMPORT_GROUP_ID);
  const group = sanitizeGroup({
    id: IMPORT_GROUP_ID,
    label: 'Student Employees',
    description: 'Guess their name, team, and a fun fact from their photo',
    fields: defaultFieldsForGroupId(IMPORT_GROUP_ID)
  }, { requireId: true });
  groups.push(group);
  rebuildGroupIds();
  saveGroups();
  ensurePeopleFileForGroup(IMPORT_GROUP_ID);
  return group;
}

function resolveMediaFile(relativeMediaPath) {
  const cleaned = String(relativeMediaPath || '')
    .replace(/^\/+/, '')
    .replace(/^media\//, '');
  if (!cleaned || cleaned.includes('..')) return null;

  const candidates = [
    path.join(MEDIA_ROOT, cleaned),
    path.join(PUBLIC_MEDIA_ROOT, cleaned)
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
  }
  return null;
}

function saveImportedRosterPhoto(photo, preferredRelativePath = '') {
  if (!photo || !photo.dataUrl) return '';

  const { ext, buffer } = parseDataUrlImage(photo.dataUrl);
  return writeStudentMediaFile(buffer, ext, preferredRelativePath || photo.name || photo.filename || '');
}

function writeStudentMediaFile(buffer, ext, preferredRelativePath = '') {
  const preferredBase = photoBasename(preferredRelativePath);
  const preferredExt = path.extname(preferredBase);
  const base = slugifyFileBase(preferredBase || 'photo');
  const finalExt = preferredExt && /^\.(png|jpe?g|gif|webp)$/i.test(preferredExt)
    ? preferredExt.toLowerCase().replace('.jpeg', '.jpg')
    : (ext || '.jpg');
  const filename = `${base}${finalExt === '.jpeg' ? '.jpg' : finalExt}`;
  const destDir = path.join(MEDIA_ROOT, 'students');
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, filename), buffer);
  return `media/students/${filename}`;
}

const STUDENT_PHOTO_ALIASES = {
  'sofia texeira': ['sofia silva'],
  'arianne blad': ['annie blad'],
  'madeline xu': ['madeline charles']
};

const PHOTO_JUNK_TOKENS = new Set([
  'for', 'website', 'web', 'print', 'headshot', 'head', 'shot',
  'img', 'image', 'photo', 'portrait', 'copy', 'final', 'edited',
  'new', 'dsc'
]);

function tokenizePhotoName(value) {
  return String(value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function significantPhotoTokens(tokens) {
  return tokens.filter((token) => (
    token.length >= 2
    && !/^\d+$/.test(token)
    && !PHOTO_JUNK_TOKENS.has(token)
  ));
}

function tokenEditDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const next = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function tokensFuzzyEqual(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.min(a.length, b.length) >= 5 && tokenEditDistance(a, b) <= 1) return true;
  return false;
}

function compactPhotoKey(filename) {
  return photoBasename(filename)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function stripPhotoJunkCompact(value) {
  let remainder = String(value || '');
  const junk = ['website', 'headshot', 'print', 'photo', 'image', 'web', 'new'];
  let changed = true;
  while (changed && remainder) {
    changed = false;
    for (const token of junk) {
      if (remainder.endsWith(token)) {
        remainder = remainder.slice(0, -token.length);
        changed = true;
      }
    }
    const next = remainder.replace(/\d+$/, '');
    if (next !== remainder) {
      remainder = next;
      changed = true;
    }
  }
  return remainder;
}

function compactScoreForPerson(nameTokens, filename) {
  if (!nameTokens.length) return 0;
  const fileCompact = compactPhotoKey(filename);
  if (!fileCompact) return 0;
  const first = nameTokens[0];
  const rest = nameTokens.slice(1);
  let firstLen = 0;
  if (fileCompact.startsWith(first)) {
    firstLen = first.length;
  } else {
    for (let len = Math.max(4, first.length - 1); len <= first.length + 1 && len <= fileCompact.length; len += 1) {
      if (tokensFuzzyEqual(fileCompact.slice(0, len), first)) {
        firstLen = len;
        break;
      }
    }
  }
  if (!firstLen) return 0;

  const remainder = stripPhotoJunkCompact(fileCompact.slice(firstLen));
  const raw = tokenizePhotoName(filename).concat(fileCompact);
  let score = 18;
  if (raw.some((token) => token === 'web' || token === 'website') || fileCompact.includes('web')) score += 8;
  if (raw.includes('print') || fileCompact.includes('print')) score -= 5;
  if (!rest.length) return remainder ? 0 : score;

  const restHit = rest.some((token) => (
    remainder === token
    || remainder.startsWith(token)
    || (token.startsWith(remainder) && remainder.length >= 4)
    || remainder.includes(token)
    || tokensFuzzyEqual(remainder, token)
  ));
  return restHit ? score + 6 : 0;
}

function scoreOnePhotoName(personName, filename) {
  const nameTokens = significantPhotoTokens(tokenizePhotoName(personName));
  const rawFileTokens = tokenizePhotoName(filename);
  const fileTokens = significantPhotoTokens(rawFileTokens);
  if (!nameTokens.length) return 0;

  let score = 0;
  if (fileTokens.length) {
    const first = nameTokens[0];
    const rest = nameTokens.slice(1);
    if (fileTokens.some((token) => tokensFuzzyEqual(token, first))) {
      const restMatches = rest.filter((token) => fileTokens.some((fileToken) => tokensFuzzyEqual(fileToken, token)));
      if (!rest.length || restMatches.length > 0) {
        score = 20 + restMatches.length * 8;
        if (rawFileTokens.includes('web') || rawFileTokens.includes('website')) score += 10;
        if (rawFileTokens.includes('print')) score -= 6;
        score -= Math.max(0, fileTokens.length - nameTokens.length) * 2;
      }
    }
  }

  return Math.max(score, compactScoreForPerson(nameTokens, filename));
}

function scorePhotoForPerson(personName, filename) {
  const names = [
    personName,
    ...(STUDENT_PHOTO_ALIASES[String(personName || '').trim().toLowerCase()] || [])
  ];
  return names.reduce((best, name) => Math.max(best, scoreOnePhotoName(name, filename)), 0);
}

function listStudentMediaFiles() {
  const dirs = [
    path.join(MEDIA_ROOT, 'students'),
    path.join(PUBLIC_MEDIA_ROOT, 'students')
  ];
  const seen = new Set();
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (error) {
      continue;
    }
    for (const name of names) {
      if (!/\.(png|jpe?g|gif|webp)$/i.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      const full = path.join(dir, name);
      try {
        if (!fs.statSync(full).isFile()) continue;
      } catch (error) {
        continue;
      }
      seen.add(key);
      files.push({
        name,
        full,
        relative: `media/students/${name}`
      });
    }
  }
  return files;
}

function copyStudentPhotoToCanonical(sourceFullPath, preferredRelativePath) {
  const sourceExt = path.extname(sourceFullPath).toLowerCase().replace('.jpeg', '.jpg') || '.jpg';
  const preferredExt = path.extname(photoBasename(preferredRelativePath)).toLowerCase().replace('.jpeg', '.jpg');
  const ext = preferredExt && /^\.(png|jpg|gif|webp)$/.test(preferredExt) ? preferredExt : sourceExt;
  const base = slugifyFileBase(preferredRelativePath || path.basename(sourceFullPath));
  const destDir = path.join(MEDIA_ROOT, 'students');
  fs.mkdirSync(destDir, { recursive: true });
  const destName = `${base}${ext}`;
  const destFull = path.join(destDir, destName);
  if (path.resolve(sourceFullPath) !== path.resolve(destFull)) {
    fs.copyFileSync(sourceFullPath, destFull);
  }
  return `media/students/${destName}`;
}

function findExistingStudentPhoto(personName, csvPhotoPath, usedRelatives = new Set()) {
  const candidates = [];
  if (csvPhotoPath) {
    const normalized = String(csvPhotoPath).replace(/^\/+/, '');
    candidates.push(normalized.startsWith('media/') ? normalized : `media/students/${photoBasename(normalized)}`);
  }
  const slug = slugifyFileBase(personName);
  ['.jpg', '.jpeg', '.png', '.webp', '.gif'].forEach((ext) => {
    candidates.push(`media/students/${slug}${ext}`);
  });

  for (const relative of candidates) {
    if (usedRelatives.has(relative)) continue;
    if (resolveMediaFile(relative)) {
      usedRelatives.add(relative);
      return relative;
    }
  }

  const available = listStudentMediaFiles().filter((file) => !usedRelatives.has(file.relative));
  let best = null;
  available.forEach((file) => {
    const score = scorePhotoForPerson(personName, file.name);
    if (score <= 0) return;
    if (!best || score > best.score) best = { ...file, score };
  });
  if (!best) return '';

  usedRelatives.add(best.relative);
  const canonicalPreferred = csvPhotoPath || `media/students/${slug}.jpg`;
  const canonical = copyStudentPhotoToCanonical(best.full, canonicalPreferred);
  usedRelatives.add(canonical);
  return canonical;
}

function extensionForImageMime(mimeType, fallbackName = '') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === 'image/png') return '.png';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  const fromName = path.extname(photoBasename(fallbackName)).toLowerCase();
  if (/^\.(png|jpe?g|gif|webp)$/.test(fromName)) {
    return fromName === '.jpeg' ? '.jpg' : fromName;
  }
  return '.jpg';
}

function readRawBody(req, { maxBytes = MAX_IMPORT_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function importStudentEmployeesFromCsv(data = {}) {
  ensureImportGroup();

  const csvText = String(data.csv || data.csv_text || '');
  if (!csvText.trim()) {
    throw new Error('CSV content is required.');
  }

  const rows = csvRowsToObjects(parseCsv(csvText));
  if (rows.length === 0) {
    throw new Error('CSV has no data rows.');
  }

  // Optional inline photos remain supported, but the UI uploads them separately first.
  const photos = Array.isArray(data.photos) ? data.photos : [];
  const photosByBasename = new Map();
  photos.forEach((photo) => {
    const key = photoBasename(photo?.name || photo?.filename || '');
    if (key) photosByBasename.set(key, photo);
  });

  const existingInGroup = people.filter((person) => personInGroups(person, [IMPORT_GROUP_ID]));
  const existingByName = new Map(
    existingInGroup.map((person) => [String(person.name || '').trim().toLowerCase(), person])
  );

  const imported = [];
  const warnings = [];
  const usedPhotoRelatives = new Set();
  let photosSaved = 0;
  let photosMatchedExisting = 0;

  rows.forEach((row, index) => {
    const name = String(row.name || '').trim();
    if (!name) {
      warnings.push(`Row ${index + 2}: skipped (missing name).`);
      return;
    }

    const team = String(row.team || row.position || '').trim() || '—';
    const funFact = String(row['fun fact'] || row.fun_fact || row.funfact || '').trim() || 'TBD';
    const title = String(row.title || '').trim();
    const csvPhoto = String(row.photo || row.image || '').trim();
    const csvPhotoKey = photoBasename(csvPhoto);
    const matchedUpload = (csvPhotoKey && photosByBasename.get(csvPhotoKey))
      || photosByBasename.get(`${slugifyFileBase(name)}.jpg`)
      || photosByBasename.get(`${slugifyFileBase(name)}.png`)
      || photosByBasename.get(`${slugifyFileBase(name)}.jpeg`)
      || photosByBasename.get(`${slugifyFileBase(name)}.webp`);

    let image = '';
    if (matchedUpload) {
      image = saveImportedRosterPhoto(matchedUpload, csvPhoto || matchedUpload.name);
      photosSaved += 1;
      if (image) usedPhotoRelatives.add(image);
    } else {
      image = findExistingStudentPhoto(name, csvPhoto, usedPhotoRelatives);
      if (image) {
        photosMatchedExisting += 1;
        usedPhotoRelatives.add(image);
      } else {
        warnings.push(`${name}: no photo found for ${csvPhotoKey || csvPhoto || 'this person'}.`);
      }
    }

    const previous = existingByName.get(name.toLowerCase());
    const person = sanitizePerson({
      name,
      position: team,
      gender: previous?.gender || 'F',
      image,
      groups: [IMPORT_GROUP_ID],
      values: {
        team,
        fun_fact: funFact,
        ...(title ? { title } : {})
      }
    });
    person.id = makeId(person, imported.length);
    imported.push(person);
  });

  if (imported.length === 0) {
    throw new Error('No valid people found in the CSV.');
  }

  const replace = data.replace !== false;
  const kept = replace
    ? people.filter((person) => !personInGroups(person, [IMPORT_GROUP_ID]))
    : people;

  if (!replace) {
    const existingIds = new Set(kept.map((person) => person.id));
    imported.forEach((person) => {
      const prior = existingByName.get(person.name.toLowerCase());
      if (prior) {
        const idx = kept.findIndex((entry) => entry.id === prior.id);
        if (idx !== -1) {
          kept[idx] = { ...person, id: prior.id, gender: prior.gender || person.gender };
          return;
        }
      }
      let id = person.id;
      let suffix = 2;
      while (existingIds.has(id)) {
        id = `${person.id}-${suffix}`;
        suffix += 1;
      }
      person.id = id;
      existingIds.add(id);
      kept.push(person);
    });
    people = withIds(kept);
  } else {
    people = withIds([...kept, ...imported]);
  }

  savePeople();

  return {
    success: true,
    group_id: IMPORT_GROUP_ID,
    imported: imported.length,
    replaced: replace,
    photos_saved: photosSaved,
    photos_reused: photosMatchedExisting,
    warnings,
    groups: groupsWithCounts()
  };
}

function generateFieldOptions(correctPerson, pool = people, guessFields = []) {
  const optionPool = Array.isArray(pool) && pool.length > 0 ? pool : people;
  const fields = Array.isArray(guessFields) && guessFields.length > 0
    ? guessFields
    : getGuessFields([DEFAULT_GROUP]);
  const options = {};

  fields.forEach((field) => {
    const correctValue = getPersonFieldValue(correctPerson, field.id);
    const choices = [];
    if (correctValue) choices.push(correctValue);

    let sourcePool = optionPool;
    if (field.filter_by_gender) {
      const targetGender = getPersonFieldValue(correctPerson, 'gender') || 'F';
      const sameGenderPeople = optionPool.filter(
        (person) => (getPersonFieldValue(person, 'gender') || 'F') === targetGender
      );
      if (sameGenderPeople.length >= 4) sourcePool = sameGenderPeople;
    }

    const candidates = shuffle(
      [...new Set(
        sourcePool
          .map((person) => getPersonFieldValue(person, field.id))
          .filter((value) => value && value !== correctValue)
      )]
    );

    for (const value of candidates) {
      if (choices.length >= 4) break;
      choices.push(value);
    }

    // Keep Fun Fact playable before real facts exist (all TBD → only one unique value).
    if (field.id === 'fun_fact' || field.id === 'fun-fact') {
      let n = 2;
      while (choices.length < 4) {
        const filler = `TBD ${n}`;
        if (!choices.includes(filler)) choices.push(filler);
        n += 1;
      }
    }

    options[field.id] = shuffle(choices);
  });

  return {
    options,
    guess_fields: fields.map((field) => ({ id: field.id, label: field.label })),
    options_name: options.name || [],
    options_pos: options.position || options.abbreviation || []
  };
}

function generateOptions(correctPerson, pool = people) {
  const generated = generateFieldOptions(correctPerson, pool, getGuessFields([DEFAULT_GROUP]));
  return [generated.options_name, generated.options_pos];
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickNextPerson(game) {
  const pool = getPeopleForGroups(game.selected_groups);
  if (pool.length === 0) return null;

  let usedIds = new Set(game.used_person_ids || []);
  let available = pool.filter((person) => !usedIds.has(person.id));

  // After every entry has appeared once, reshuffle and continue for remaining questions.
  if (available.length === 0) {
    game.used_person_ids = [];
    usedIds = new Set();
    available = pool;
  }

  return available[Math.floor(Math.random() * available.length)];
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Game-Code, X-Host-Token, X-Manager-Key, X-Manager-Password',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function safeState(game) {
  const clientState = {
    code: game.code,
    status: game.status,
    round: game.round,
    teams: Object.fromEntries(
      Object.entries(game.teams).map(([key, team]) => [key, {
        name: team.name,
        score: team.score,
        answered: team.answered
      }])
    ),
    start_time: game.start_time,
    time_limit: game.time_limit
  };

  if (game.status === 'question' && game.current_person) {
    clientState.options_name = game.options_name;
    clientState.options_pos = game.options_pos;
    clientState.options = game.options || {};
    clientState.guess_fields = game.guess_fields || [];
  } else if (game.status === 'reveal') {
    clientState.person = game.current_person;
    clientState.teams = game.teams;
    clientState.guess_fields = game.guess_fields || [];
  }

  return clientState;
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') return sendJson(res, {});

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const game = getGameOrError(getCodeFrom(req, url));
    return sendJson(res, safeState(game));
  }

  if (req.method === 'GET' && url.pathname === '/api/host_state') {
    const game = requireHost(req, url);
    return sendJson(res, { ...game, host_token: undefined });
  }

  if (req.method === 'GET' && url.pathname === '/api/people') {
    return sendJson(res, people);
  }

  if (req.method === 'GET' && url.pathname === '/api/groups') {
    return sendJson(res, {
      groups: groupsWithCounts(),
      default: DEFAULT_GROUP
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/reconnect') {
    const teamName = String(url.searchParams.get('name') || '').trim();
    if (!teamName) return sendJson(res, { success: false, error: 'Name is required.' }, 400);

    const session = findPlayerSession(teamName);
    if (!session) {
      return sendJson(res, {
        success: false,
        error: 'No game found for that name. Enter the host code to join.'
      }, 404);
    }

    touchGame(session.game);
    return sendJson(res, {
      success: true,
      code: session.game.code,
      team_id: session.teamId,
      rejoined: true
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const entries = loadLeaderboard();
    const groupParam = url.searchParams.get('group') || url.searchParams.get('groups');
    if (groupParam) {
      if (groupParam === 'all') {
        return sendJson(res, filterLeaderboard(entries, 'all').slice(0, LEADERBOARD_SIZE));
      }
      const groups = normalizeGroups(groupParam.split(','));
      return sendJson(res, filterLeaderboard(entries, groups).slice(0, LEADERBOARD_SIZE));
    }
    // Default board is the combined All view.
    return sendJson(res, filterLeaderboard(entries, 'all').slice(0, LEADERBOARD_SIZE));
  }

  const maxBytes = (
    url.pathname === '/api/people/import'
    || url.pathname === '/api/people/import/photo'
  )
    ? MAX_IMPORT_BODY_BYTES
    : MAX_JSON_BODY_BYTES;

  if (req.method === 'POST' && url.pathname === '/api/people/import/photo') {
    requireManager(req, {});
    const filename = String(
      url.searchParams.get('name')
      || url.searchParams.get('filename')
      || req.headers['x-photo-name']
      || ''
    ).trim();
    if (!filename) {
      throw Object.assign(new Error('Photo filename is required.'), { status: 400 });
    }
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
      throw Object.assign(new Error('Photo upload must be an image.'), { status: 400 });
    }
    const buffer = await readRawBody(req, { maxBytes: MAX_IMPORT_BODY_BYTES });
    if (!buffer.length) {
      throw Object.assign(new Error('Photo upload was empty.'), { status: 400 });
    }
    const ext = extensionForImageMime(contentType, filename);
    const image = writeStudentMediaFile(buffer, ext, filename);
    return sendJson(res, { success: true, image });
  }

  const data = await readBody(req, { maxBytes });

  if (req.method === 'POST' && url.pathname === '/api/manager/login') {
    requireManager(req, data);
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/groups') {
    requireManager(req, data);
    const group = sanitizeGroup(data);
    if (groupIds.has(group.id)) {
      return sendJson(res, { success: false, error: 'A group with that id already exists.' }, 409);
    }
    groups.push(group);
    rebuildGroupIds();
    saveGroups();
    ensurePeopleFileForGroup(group.id);
    return sendJson(res, { success: true, group, groups: groupsWithCounts() }, 201);
  }

  const groupMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (groupMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    const id = decodeURIComponent(groupMatch[1]);
    const index = groups.findIndex((group) => group.id === id);
    if (index === -1) return sendJson(res, { success: false, error: 'Group not found.' }, 404);

    if (req.method === 'DELETE') {
      requireManager(req, data);
      if (id === DEFAULT_GROUP) {
        return sendJson(res, { success: false, error: 'The default Clients group cannot be deleted.' }, 400);
      }
      const inUse = people.some((person) => personInGroups(person, [id]));
      if (inUse) {
        return sendJson(res, {
          success: false,
          error: 'Remove or reassign roster items in this group before deleting it.'
        }, 409);
      }
      groups.splice(index, 1);
      rebuildGroupIds();
      saveGroups();
      return sendJson(res, { success: true, groups: groupsWithCounts() });
    }

    requireManager(req, data);
    const updated = sanitizeGroup({ ...data, id });
    groups[index] = updated;
    saveGroups();
    return sendJson(res, { success: true, group: groups[index], groups: groupsWithCounts() });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/session') {
    pruneExpiredGames();
    const requestedCode = normalizeCode(data.code);
    const requestedGame = requestedCode ? games.get(requestedCode) : null;
    if (requestedGame && String(data.host_token || '') === requestedGame.host_token) {
      touchGame(requestedGame);
      return sendJson(res, {
        success: true,
        game: publicGameMeta(requestedGame),
        host_token: requestedGame.host_token
      });
    }

    const game = createGameState();
    if (data.groups || data.selected_groups) {
      game.selected_groups = normalizeGroups(data.groups || data.selected_groups);
    }
    if (data.max_rounds != null) {
      game.max_rounds = normalizeMaxRounds(data.max_rounds);
    }
    games.set(game.code, game);
    return sendJson(res, {
      success: true,
      game: publicGameMeta(game),
      host_token: game.host_token
    }, 201);
  }

  if (req.method === 'POST' && url.pathname === '/api/join') {
    const game = getGameOrError(data.code);
    const teamName = String(data.name || '').trim();
    if (!teamName) return sendJson(res, { success: false, error: 'Team name is required.' }, 400);
    if (game.status === 'end') {
      return sendJson(res, { success: false, error: 'This game has already ended.' }, 409);
    }

    const normalizedName = teamName.toLowerCase();
    const existingTeamId = Object.entries(game.teams).find(
      ([, team]) => team.name.toLowerCase() === normalizedName
    )?.[0];

    if (existingTeamId) {
      touchGame(game);
      return sendJson(res, { success: true, team_id: existingTeamId, rejoined: true });
    }

    const teamId = `team_${randomInt(10000, 99999)}`;
    game.teams[teamId] = {
      name: teamName,
      score: 0,
      answered: false,
      correct_name: false,
      correct_pos: false,
      time_taken: 0
    };
    touchGame(game);
    return sendJson(res, { success: true, team_id: teamId, rejoined: false });
  }

  if (req.method === 'POST' && url.pathname === '/api/answer') {
    const game = getGameOrError(data.code);
    const teamId = data.team_id;
    const team = game.teams[teamId];
    if (team && game.status === 'question' && !team.answered && game.current_person) {
      const guessFields = Array.isArray(game.guess_fields) && game.guess_fields.length
        ? game.guess_fields
        : [
          { id: 'name', label: 'Name' },
          { id: 'position', label: 'Position' }
        ];
      const answers = data.answers && typeof data.answers === 'object' ? data.answers : {
        name: data.name,
        position: data.position
      };
      const timeTaken = (Date.now() / 1000) - game.start_time;
      const timeLimit = game.time_limit || 30;
      const correctByField = {};
      let allCorrect = true;
      let correctCount = 0;

      guessFields.forEach((field) => {
        const expected = getPersonFieldValue(game.current_person, field.id);
        const given = String(answers[field.id] ?? '').trim();
        let isCorrect = given === expected;
        if (timeTaken > timeLimit) isCorrect = false;
        correctByField[field.id] = isCorrect;
        if (isCorrect) correctCount += 1;
        else allCorrect = false;
      });

      team.answered = true;
      team.time_taken = timeTaken;
      team.correct_fields = correctByField;
      team.correct_name = Boolean(correctByField.name);
      team.correct_pos = Boolean(
        correctByField.position
        || correctByField.abbreviation
        || (guessFields[1] && correctByField[guessFields[1].id])
      );

      let points = 0;
      const instantWindowSeconds = 3;
      const speedTime = Math.max(0, timeTaken - instantWindowSeconds);
      const speedMultiplier = Math.max(0.1, 1 - (speedTime / timeLimit));
      points += correctCount * Math.floor(1000 * speedMultiplier);
      if (allCorrect && guessFields.length > 1) points += 500;
      team.score += points;
      touchGame(game);
    }
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/start_round') {
    const game = requireHost(req, url, data);
    if (game.status === 'question') {
      return sendJson(res, {
        success: false,
        error: 'Reveal the answer or wait for the timer before starting the next round.'
      }, 400);
    }
    if (data.groups || data.selected_groups) {
      game.selected_groups = normalizeGroups(data.groups || data.selected_groups);
    }
    const pool = getPeopleForGroups(game.selected_groups);
    if (pool.length === 0) {
      return sendJson(res, {
        success: false,
        error: 'No people in the selected groups. Add roster entries or choose different groups.'
      }, 400);
    }
    if (game.round >= game.max_rounds) {
      return sendJson(res, { success: false, error: 'All rounds are complete. End the game to finish.' }, 400);
    }

    game.max_rounds = normalizeMaxRounds(data.max_rounds ?? game.max_rounds);
    const nextPerson = pickNextPerson(game);
    if (!nextPerson) {
      return sendJson(res, {
        success: false,
        error: 'No people in the selected groups. Add roster entries or choose different groups.'
      }, 400);
    }

    const quizGroups = getPersonQuizGroups(nextPerson, game.selected_groups);
    const guessFields = getGuessFields(quizGroups);
    const fieldPool = getPeopleForGroups(quizGroups);
    const generated = generateFieldOptions(nextPerson, fieldPool, guessFields);

    game.status = 'question';
    game.round += 1;
    game.time_limit = Number.parseInt(data.time_limit, 10) || 30;
    game.current_person = nextPerson;
    game.used_person_ids.push(nextPerson.id);
    game.options = generated.options;
    game.guess_fields = generated.guess_fields;
    game.options_name = generated.options_name;
    game.options_pos = generated.options_pos;
    game.start_time = Date.now() / 1000;

    Object.values(game.teams).forEach((team) => {
      team.answered = false;
      team.correct_name = false;
      team.correct_pos = false;
      team.correct_fields = {};
      team.time_taken = 0;
    });
    touchGame(game);
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/reveal') {
    const game = requireHost(req, url, data);
    game.status = 'reveal';
    touchGame(game);
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/settings') {
    const game = requireHost(req, url, data);
    if (game.status === 'question') {
      return sendJson(res, { success: false, error: 'Settings cannot be changed during an active round.' }, 400);
    }
    game.max_rounds = normalizeMaxRounds(data.max_rounds ?? game.max_rounds);
    if (data.groups || data.selected_groups) {
      game.selected_groups = normalizeGroups(data.groups || data.selected_groups);
    }
    // Changing groups mid-game resets the used pool so new groups can appear.
    if (data.groups || data.selected_groups) {
      game.used_person_ids = [];
    }
    touchGame(game);
    return sendJson(res, {
      success: true,
      max_rounds: game.max_rounds,
      selected_groups: game.selected_groups,
      pool_size: getPeopleForGroups(game.selected_groups).length
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/end') {
    const game = requireHost(req, url, data);
    finalizeGame(game);
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/reset') {
    const game = requireHost(req, url, data);
    if (game.status !== 'end') {
      return sendJson(res, { success: false, error: 'End the game before starting a new one.' }, 400);
    }
    game.status = 'lobby';
    game.round = 0;
    game.current_person = null;
    game.used_person_ids = [];
    game.options_name = [];
    game.options_pos = [];
    game.teams = {};
    game.start_time = 0;
    game.scores_recorded = false;
    if (data.groups || data.selected_groups) {
      game.selected_groups = normalizeGroups(data.groups || data.selected_groups);
    }
    touchGame(game);
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/people') {
    requireManager(req, data);
    const person = sanitizePerson(data);
    person.image = saveUploadedPhoto(data.photo) || person.image;
    person.id = makeId(person, people.length);
    people = withIds([...people, person]);
    savePeople(); // Persist the new roster entry to per-group files
    return sendJson(res, { success: true, person: people[people.length - 1] }, 201);
  }

  if (req.method === 'POST' && url.pathname === '/api/people/import') {
    requireManager(req, data);
    const result = importStudentEmployeesFromCsv(data);
    return sendJson(res, result);
  }

  const personMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
  if (personMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    const id = decodeURIComponent(personMatch[1]);
    const index = people.findIndex((person) => person.id === id);
    if (index === -1) return sendJson(res, { success: false, error: 'Staff member not found.' }, 404);

    if (req.method === 'DELETE') {
      requireManager(req, data);
      const [removed] = people.splice(index, 1);
      for (const game of games.values()) {
        if (game.current_person && game.current_person.id === removed.id) {
          game.current_person = null;
          game.status = 'lobby';
          touchGame(game);
        }
      }
      savePeople(); // Persist the deletion to per-group files
      return sendJson(res, { success: true });
    }

    requireManager(req, data);
    const updated = sanitizePerson(data);
    updated.id = id;
    updated.image = saveUploadedPhoto(data.photo) || updated.image || people[index].image;
    people[index] = updated;
    people = withIds(people);
    for (const game of games.values()) {
      if (game.current_person && game.current_person.id === id) {
        game.current_person = people.find((person) => person.id === id) || null;
        touchGame(game);
      }
    }
    savePeople(); // Persist the updates to per-group files
    return sendJson(res, { success: true, person: people[index] });
  }

  return sendJson(res, { success: false, error: 'Not found.' }, 404);
}

function resolveStaticPath(requestPath) {
  let filePath = requestPath;
  const allowedRoot = path.join(ROOT, 'public');

  if (filePath === '/' || filePath === '/index.html') {
    filePath = '/public/index.html';
  } else if (filePath === '/host' || filePath === '/host.html') {
    filePath = '/public/host.html';
  } else if (filePath === '/leaderboard' || filePath === '/leaderboard.html') {
    filePath = '/public/leaderboard.html';
  } else if (!filePath.startsWith('/public/')) {
    filePath = `/public${filePath}`;
  }

  const fullPath = path.normalize(path.join(ROOT, filePath));
  if (fullPath !== allowedRoot && !fullPath.startsWith(`${allowedRoot}${path.sep}`)) return null;
  return fullPath;
}

function resolveStaticPathWithHtmlFallback(requestPath) {
  const primary = resolveStaticPath(requestPath);
  if (!primary) return null;
  if (fs.existsSync(primary)) return primary;

  if (!path.extname(requestPath)) {
    const htmlPath = resolveStaticPath(`${requestPath}.html`);
    if (htmlPath && fs.existsSync(htmlPath)) return htmlPath;
  }

  return primary;
}

function resolveUploadPath(urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/uploads\//, '');
  if (!relative || relative.includes('..')) return null;

  const candidates = [
    path.join(UPLOAD_DIR, relative),
    path.join(ROOT, 'public', 'uploads', relative)
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }

  return null;
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end('Not found');
    }

    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

function resolveMediaPath(urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/media\//, '');
  if (!relative || relative.includes('..')) return null;
  return resolveMediaFile(`media/${relative}`);
}

function serveStatic(req, res, url) {
  if (url.pathname.startsWith('/uploads/')) {
    const uploadPath = resolveUploadPath(url.pathname);
    if (uploadPath) return sendFile(res, uploadPath);
    res.writeHead(404);
    return res.end('Not found');
  }

  if (url.pathname.startsWith('/media/')) {
    const mediaPath = resolveMediaPath(url.pathname);
    if (mediaPath) return sendFile(res, mediaPath);
    res.writeHead(404);
    return res.end('Not found');
  }

  const filePath = resolveStaticPathWithHtmlFallback(decodeURIComponent(url.pathname));
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  sendFile(res, filePath);
}

function getIp() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  return '127.0.0.1';
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((error) => {
        sendJson(res, { success: false, error: error.message }, error.status || 400);
      });
      return;
    }

    serveStatic(req, res, url);
  });
}

function startServer(port = PORT) {
  const server = createServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${port} is already in use. Trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Server started at http://${getIp()}:${port}`);
    console.log(`Host should visit http://${getIp()}:${port}/host`);
  });
}

ensureDataDir();
groups = loadGroups();
rebuildGroupIds();
let people = loadPeople();

if (require.main === module) {
  startServer();
}

module.exports = { createServer };

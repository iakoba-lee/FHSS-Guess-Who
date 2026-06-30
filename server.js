require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT, 10) || 8080;
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || process.env.MANAGER_KEY;
const PEOPLE_FILE = path.join(ROOT, 'people.json'); // Permanent storage file for staff roster
const LEADERBOARD_FILE = path.join(ROOT, 'leaderboard.json');
const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
const LEADERBOARD_SIZE = 10;

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

let people = loadPeople();
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
    current_person: null,
    used_person_ids: [],
    options_name: [],
    options_pos: [],
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
    return { ...person, id };
  });
}

function loadPeople() {
  try {
    const raw = fs.readFileSync(PEOPLE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return withIds(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    console.error(`Unable to load people.json: ${error.message}`);
    return [];
  }
}

function savePeople() {
  // Overwrites people.json with the current 'people' array to persist changes
  fs.writeFileSync(PEOPLE_FILE, `${JSON.stringify(people, null, 4)}\n`);
}

function loadLeaderboard() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveLeaderboard(entries) {
  fs.writeFileSync(LEADERBOARD_FILE, `${JSON.stringify(entries, null, 2)}\n`);
}

function normalizeMaxRounds(value) {
  const rounds = Number.parseInt(value, 10);
  return rounds === 30 ? 30 : 15;
}

function recordLeaderboardScores(game) {
  const entries = loadLeaderboard();
  const recordedAt = new Date().toISOString();
  const rounds = game.max_rounds || 15;

  Object.values(game.teams).forEach((team) => {
    if (!team.name || team.score <= 0) return;
    entries.push({
      team_name: team.name,
      score: team.score,
      rounds,
      recorded_at: recordedAt
    });
  });

  entries.sort((a, b) => b.score - a.score || new Date(b.recorded_at) - new Date(a.recorded_at));
  saveLeaderboard(entries.slice(0, LEADERBOARD_SIZE));
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
  const name = String(input.name || '').trim();
  const position = String(input.position || '').trim();
  const gender = String(input.gender || 'F').trim().toUpperCase() === 'M' ? 'M' : 'F';
  const image = String(input.image || '').trim();

  if (!name || !position) {
    throw new Error('Name and position are required.');
  }

  return { name, position, image, gender };
}

function saveUploadedPhoto(photo) {
  if (!photo || !photo.dataUrl) return '';

  const match = String(photo.dataUrl).match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Photo must be a PNG, JPEG, GIF, or WebP image.');
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const ext = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp'
  }[mime];
  const baseName = String(photo.name || 'staff-photo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'staff-photo';
  const filename = `${Date.now()}-${baseName}${ext}`;
  const diskPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
  return `uploads/${filename}`;
}

function generateOptions(correctPerson) {
  const names = [correctPerson.name];
  const positions = [correctPerson.position];
  const targetGender = correctPerson.gender || 'F';
  const sameGenderPeople = people.filter((person) => (person.gender || 'F') === targetGender);
  const namePool = sameGenderPeople.length >= 4 ? sameGenderPeople : people;

  while (names.length < 4 && namePool.length > names.length) {
    const person = namePool[Math.floor(Math.random() * namePool.length)];
    if (!names.includes(person.name)) names.push(person.name);
  }

  while (positions.length < 4 && people.length > positions.length) {
    const person = people[Math.floor(Math.random() * people.length)];
    if (!positions.includes(person.position)) positions.push(person.position);
  }

  return [shuffle(names), shuffle(positions)];
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
  const usedIds = new Set(game.used_person_ids || []);
  const available = people.filter((person) => !usedIds.has(person.id));
  if (available.length === 0) return null;
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
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
  } else if (game.status === 'reveal') {
    clientState.person = game.current_person;
    clientState.teams = game.teams;
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
    return sendJson(res, loadLeaderboard());
  }

  const data = await readBody(req);

  if (req.method === 'POST' && url.pathname === '/api/manager/login') {
    requireManager(req, data);
    return sendJson(res, { success: true });
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
      const nameAnswer = data.name;
      const positionAnswer = data.position;
      const timeTaken = (Date.now() / 1000) - game.start_time;
      const timeLimit = game.time_limit || 30;
      let correctName = nameAnswer === game.current_person.name;
      let correctPosition = positionAnswer === game.current_person.position;

      team.answered = true;
      team.time_taken = timeTaken;

      if (timeTaken > timeLimit) {
        correctName = false;
        correctPosition = false;
      }

      team.correct_name = correctName;
      team.correct_pos = correctPosition;

      let points = 0;
      const speedMultiplier = Math.max(0.1, 1 - (timeTaken / timeLimit));
      if (correctName) points += Math.floor(1000 * speedMultiplier);
      if (correctPosition) points += Math.floor(1000 * speedMultiplier);
      if (correctName && correctPosition) points += 500;
      team.score += points;
      touchGame(game);
    }
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/start_round') {
    const game = requireHost(req, url, data);
    if (people.length === 0) {
      return sendJson(res, { success: false, error: 'Add at least one staff member before starting.' }, 400);
    }
    if (game.round >= game.max_rounds) {
      return sendJson(res, { success: false, error: 'All rounds are complete. End or reset the game.' }, 400);
    }

    game.max_rounds = normalizeMaxRounds(data.max_rounds ?? game.max_rounds);
    const nextPerson = pickNextPerson(game);
    if (!nextPerson) {
      return sendJson(res, {
        success: false,
        error: 'All staff members have been shown. End or reset the game.'
      }, 400);
    }

    game.status = 'question';
    game.round += 1;
    game.time_limit = Number.parseInt(data.time_limit, 10) || 30;
    game.current_person = nextPerson;
    game.used_person_ids.push(nextPerson.id);
    [game.options_name, game.options_pos] = generateOptions(game.current_person);
    game.start_time = Date.now() / 1000;

    Object.values(game.teams).forEach((team) => {
      team.answered = false;
      team.correct_name = false;
      team.correct_pos = false;
      team.time_taken = 0;
    });
    touchGame(game);
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/reveal') {
    const game = requireHost(req, url, data);
    if (game.round >= game.max_rounds) {
      finalizeGame(game);
    } else {
      game.status = 'reveal';
      touchGame(game);
    }
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/settings') {
    const game = requireHost(req, url, data);
    if (game.status === 'question') {
      return sendJson(res, { success: false, error: 'Settings cannot be changed during an active round.' }, 400);
    }
    game.max_rounds = normalizeMaxRounds(data.max_rounds ?? game.max_rounds);
    touchGame(game);
    return sendJson(res, { success: true, max_rounds: game.max_rounds });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/end') {
    const game = requireHost(req, url, data);
    finalizeGame(game);
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/host/reset') {
    const game = requireHost(req, url, data);
    game.status = 'lobby';
    game.round = 0;
    game.current_person = null;
    game.used_person_ids = [];
    game.options_name = [];
    game.options_pos = [];
    game.teams = {};
    game.start_time = 0;
    game.scores_recorded = false;
    touchGame(game);
    return sendJson(res, { success: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/people') {
    requireManager(req, data);
    const person = sanitizePerson(data);
    person.image = saveUploadedPhoto(data.photo) || person.image;
    person.id = makeId(person, people.length);
    people = withIds([...people, person]);
    savePeople(); // Persist the new staff member to people.json
    return sendJson(res, { success: true, person: people[people.length - 1] }, 201);
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
      savePeople(); // Persist the deletion to people.json
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
    savePeople(); // Persist the updates to people.json
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

function serveStatic(req, res, url) {
  const filePath = resolveStaticPathWithHtmlFallback(decodeURIComponent(url.pathname));
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

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

if (require.main === module) {
  startServer();
}

module.exports = { createServer };

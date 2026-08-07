# Production VM setup (Jacob’s notes)

How to get this Guess Who game onto the Docker VM with student employees working.

## What GitHub has vs what stays local

**On GitHub (commit/push):**
- App code (`server.js`, `public/*.html`, `public/style.css`, etc.)
- Roster/schema data (`data/groups.json`, `data/student-employees.json`, other `data/*.json`)
- Existing tracked media already in the repo (clients/locations/etc.)

**Not on GitHub (kept under `notes for jacob/` or local `public/media/`):**
- Source / print dumps: `photos-students/`, `photos-review/`
- Import spreadsheet: `student-employees.csv`
- Old backup: `people.json.bak`
- Served game photos for students/staff that are local-only for now:
  - `public/media/students/`
  - `public/media/internal-staff/`

Use SSH/`rsync` for those photo folders — do not rely on `git pull` alone for student headshots.

---

## Preferred photo set

Use the **website / WEB** versions from `notes for jacob/photos-students/` (not print masters).

They must end up on the VM as:

```text
/app/public/media/students/<slug>.jpg   # names match student-employees.json "image" paths
```

Example roster path: `media/students/carter-traveller.jpg`  
→ file on disk: `public/media/students/carter-traveller.jpg`

---

## Ship photos + roster over SSH (recommended)

From your Mac (adjust `USER`, `HOST`):

```bash
# Served photos already prepared for the game
rsync -avz --progress \
  public/media/students/ \
  USER@HOST:/tmp/faces-students/

rsync -avz --progress \
  public/media/internal-staff/ \
  USER@HOST:/tmp/faces-internal-staff/

# Roster + group schema (needed for Student Employees mode)
rsync -avz \
  data/student-employees.json data/groups.json \
  USER@HOST:/tmp/faces-data/
```

On the VM (container name from compose: `faces-game`):

```bash
# Ensure dirs exist
docker exec faces-game mkdir -p /app/public/media/students /app/public/media/internal-staff

# Photos live in the container image filesystem (not the data volume)
docker cp /tmp/faces-students/. faces-game:/app/public/media/students/
docker cp /tmp/faces-internal-staff/. faces-game:/app/public/media/internal-staff/

# JSON lives in the persistent volume mounted at /app/data
docker cp /tmp/faces-data/student-employees.json faces-game:/app/data/
docker cp /tmp/faces-data/groups.json faces-game:/app/data/

docker restart faces-game
```

Then verify in a browser: host → new game → select **Student Employees** → photos and TBD fun facts appear.

---

## Code / Docker deploy reminder

```bash
# On the VM, in the project directory
git pull
docker compose build faces-game
docker compose up -d faces-game
```

**Important:** `docker-compose.yml` mounts volume `faces-game-data` at `/app/data`.  
After the first run, that volume keeps old JSON even if the image is rebuilt. Always `docker cp` (or otherwise update) `student-employees.json` / `groups.json` into the volume when those change.

Photos under `public/media/` are **not** on that volume — they come from the image **or** from `docker cp` as above. A rebuild without copying photos again will wipe any `docker cp`’d media unless you bake them into the image.

---

## Optional: bake photos into the image later

If you eventually want photos in the image:

1. Put files in `public/media/students/` and `public/media/internal-staff/`
2. Remove those paths from `.gitignore`
3. Commit (watch GitHub’s 100MB per-file limit — compress large PNGs first)
4. Rebuild/redeploy on the VM

Until then, keep using `rsync` + `docker cp`.

---

## Quick checklist

- [ ] `git pull` + rebuild/restart container for code
- [ ] `student-employees.json` and `groups.json` copied into `/app/data` (volume)
- [ ] Student photos copied into `/app/public/media/students/`
- [ ] Internal-staff photos copied if needed
- [ ] `.env` present on VM (never committed; manager password etc.)
- [ ] Smoke test: Student Employees group alone, then combined with Internal Staff

# Deploying Doc-Tool with Docker Compose

Three containers: `mongo` (database), `server` (Express API, port 5000,
internal only), `client` (nginx serving the built React app and proxying
`/api` and `/assets` to the API). Only the client's port is published, on
`127.0.0.1`.

```
browser → host nginx/Caddy (TLS) → 127.0.0.1:8080 → client (nginx) ─┬─ static files
                                                                    └─ /api, /assets → server:5000 → mongo:27017
```

Persistent data lives in two named volumes: `mongo_data` (database) and
`uploads` (screenshots + uploaded documents, mounted at `/app/data` in the
server container). Rebuilding images never touches them.

---

## Environment files

**Exactly the two files you already use locally — no third file.** Both are
gitignored; templates are committed next to them.

| File | Read by | When |
|---|---|---|
| `server/.env` | the API container | **runtime** — compose passes it in via `env_file` |
| `client/.env` | the Vite build | **build time** — values are inlined into the JS bundle |

Nothing is baked into the server image: `server/.env` is excluded by
`.dockerignore` and injected at startup, so the same file drives local dev and
the container.

`client/.env` is different by nature. A browser bundle has no runtime env, so
Vite substitutes `VITE_*` during `npm run build`. That means:

- the file **must** be present when the client image is built (it is copied in
  for the build stage only — the final nginx image contains just `dist/`);
- changing it needs a **rebuild**, not a restart:
  `docker compose up -d --build client`.

Two settings that must be right or the deploy looks broken in confusing ways:

- **`MONGODB_URI`** — with the bundled mongo container this must be
  `mongodb://mongo:27017/docproject`. Inside a container `localhost` is the
  container itself, so a localhost URI just hangs and fails. The server now
  refuses to start on this and tells you. (Atlas SRV strings work as-is.)
- **`FRONTEND_URL`** — must match your public URL exactly, no trailing slash,
  or the API's CORS check rejects the browser.

`PORT` in `server/.env` only affects local dev; compose forces `5000` inside
the container so nginx and the healthcheck always agree.

The server prints a `[config]` line at boot for anything missing, and exits
with a clear message if `MONGODB_URI` or `JWT_SECRET` is absent — so
`docker compose logs server` always tells you what's wrong.

---

## One-time setup on the server

1. **Install Docker** (Ubuntu/Debian):

   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER      # then log out and back in
   docker compose version
   ```

2. **Clone the repo:**

   ```bash
   sudo mkdir -p /opt && cd /opt
   git clone <repo-url> doc-tool
   cd doc-tool
   ```

3. **Add the two env files** (copy from your local machine, or start from the
   templates):

   ```bash
   cp server/.env.example server/.env && nano server/.env
   cp client/.env.example client/.env && nano client/.env
   ```

   In `server/.env` set at minimum `MONGODB_URI` (use `mongo:27017`),
   `JWT_SECRET` (`openssl rand -hex 32`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `FRONTEND_URL`, `MICROSOFT_REDIRECT_URI` and the `AZURE_*` values.
   In `client/.env` set `VITE_AZURE_CLIENT_ID` and `VITE_AZURE_TENANT_ID` to
   the same ids.

4. **Start it:**

   ```bash
   docker compose up -d --build
   docker compose ps
   curl -s localhost:8080/api/health     # {"ok":true,"mongo":"connected"}
   ```

   If a container is restarting, read why: `docker compose logs server`.

5. **Put TLS in front of it.** The client container listens on
   `127.0.0.1:8080` only. Example host nginx server block:

   ```nginx
   server {
     listen 443 ssl;
     server_name docs.example.com;
     # ssl_certificate ... (certbot)
     client_max_body_size 60m;

     location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 300s;
     }
   }
   ```

---

## Every deploy after a `git push`

```bash
cd /opt/doc-tool
git pull
docker compose up -d --build
curl -s localhost:8080/api/health
```

`up -d --build` rebuilds only what changed and replaces those containers;
volumes and the database are untouched. Env files are never overwritten by
`git pull` — they are gitignored.

```bash
# Server-only change
docker compose up -d --build server

# Frontend change, or any client/.env edit
docker compose up -d --build client

# server/.env edit — recreate, no rebuild needed
docker compose up -d --force-recreate server
```

### Roll back

```bash
git log --oneline -5
git checkout <previous-sha>
docker compose up -d --build
```

---

## Day-to-day commands

| Task | Command |
|---|---|
| Logs (all / one) | `docker compose logs -f` · `docker compose logs -f server` |
| Restart one service | `docker compose restart server` |
| Shell into the API | `docker compose exec server sh` |
| Check env inside container | `docker compose exec server env \| sort` |
| Mongo shell | `docker compose exec mongo mongosh docproject` |
| Stop everything | `docker compose down` (volumes survive) |
| Stop **and wipe data** | `docker compose down -v` ← destroys the database |
| Disk usage | `docker system df` · prune images: `docker image prune -f` |

### Backups

```bash
# Database
docker compose exec -T mongo mongodump --archive --db=docproject > backup-$(date +%F).archive
# Restore
docker compose exec -T mongo mongorestore --archive --drop < backup-2026-09-17.archive

# Uploaded files
docker run --rm -v doc-tool_uploads:/data -v "$PWD":/out alpine \
  tar czf /out/uploads-$(date +%F).tar.gz -C /data .
```

(The volume name is prefixed with the compose project name — the directory
name. Confirm with `docker volume ls`.)

---

## Notes

- **Using MongoDB Atlas instead of the bundled container:** put the SRV string
  in `server/.env`, then drop the `mongo` service and the `depends_on` block
  from `docker-compose.yml`. If the host can't resolve SRV records, set
  `MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1`.
- **The client build needs outbound network** — `xlsx` installs from
  `cdn.sheetjs.com`, not the npm registry.
- **Existing screenshots from the old `/var/www/doc360tool` deploy** need
  copying into the volume once:

  ```bash
  docker run --rm -v doc-tool_uploads:/data -v /var/www/doc360tool/client/dist/assets:/old:ro \
    alpine sh -c 'mkdir -p /data/public && cp -r /old/screenshots /data/public/'
  docker run --rm -v doc-tool_uploads:/data -v /opt/doc-tool-old/server/assets/documents:/old:ro \
    alpine sh -c 'mkdir -p /data/documents && cp -r /old/. /data/documents/'
  ```

- **Asset layout inside the server container** (`ASSETS_DIR=/app/data`):
  `public/screenshots/` is served at `/assets/screenshots/…`, and
  `documents/` at `/assets/documents/…` with forced-download headers.

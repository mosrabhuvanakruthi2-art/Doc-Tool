# Deploying Doc-Tool with Docker Compose

Three containers: `mongo` (database), `server` (Express API, port 5000, internal
only), `client` (nginx serving the built React app and proxying `/api` and
`/assets` to the API). Only the client's port is published, on `127.0.0.1`.

```
browser → host nginx/Caddy (TLS) → 127.0.0.1:8080 → client (nginx) ─┬─ static files
                                                                    └─ /api, /assets → server:5000 → mongo:27017
```

Persistent data lives in two named volumes: `mongo_data` (database) and
`uploads` (screenshots + uploaded documents, mounted at `/app/data` in the
server container). Rebuilding images never touches them.

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

3. **Create `.env` in the repo root** (it is gitignored — never commit it):

   ```bash
   cp .env.example .env
   nano .env
   ```

   Fill in at minimum: `FRONTEND_URL`, `MICROSOFT_REDIRECT_URI`, `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`, `JWT_SECRET` (`openssl rand -hex 32`), and the Azure ids.

   Two of those values are used **twice** by design:
   `AZURE_CLIENT_ID`/`AZURE_TENANT_ID` go to the API at runtime, and
   `VITE_AZURE_CLIENT_ID`/`VITE_AZURE_TENANT_ID` are baked into the frontend
   bundle at build time. Set both pairs to the same values.

4. **Start it:**

   ```bash
   docker compose up -d --build
   docker compose ps
   curl -s localhost:8080/api/health     # {"ok":true,"mongo":"connected"}
   ```

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

   `FRONTEND_URL` in `.env` must match this public URL exactly (no trailing
   slash) or the API's CORS check will reject the browser.

---

## Every deploy after a `git push`

```bash
cd /opt/doc-tool
git pull
docker compose up -d --build
docker compose ps
```

`up -d --build` rebuilds only what changed and replaces those containers;
volumes and the database are untouched. Typical shortcuts:

```bash
# Server-only change (no frontend rebuild)
docker compose up -d --build server

# Frontend-only change
docker compose up -d --build client

# Changed .env — restart to pick it up (rebuild client if VITE_* changed)
docker compose up -d --force-recreate server
```

### Verify

```bash
curl -s localhost:8080/api/health
docker compose logs -f --tail=100 server
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

(The volume is prefixed with the compose project name — the directory name.
Confirm with `docker volume ls`.)

---

## Notes and gotchas

- **Using MongoDB Atlas instead of the bundled container:** put the SRV string
  in `MONGODB_URI`, then drop the `mongo` service and the `depends_on` block
  from `docker-compose.yml`. If the host can't resolve SRV records, set
  `MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1`.
- **`VITE_*` values are compile-time.** Changing them requires
  `docker compose up -d --build client`, not a restart.
- **Client build needs outbound network** — `xlsx` is installed from
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

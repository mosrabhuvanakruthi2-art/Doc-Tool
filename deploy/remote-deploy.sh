#!/usr/bin/env bash
# Runs ON THE SERVER over SSH (bitbucket-pipelines.yml pipes it into `bash -s`).
#
#   remote-deploy.sh <commit-sha> <repo-path>
#
# Deploys exactly <commit-sha>: checks out that commit in the existing clone,
# rebuilds the images, restarts the containers and waits until the API is
# healthy and connected to MongoDB. If anything fails after the checkout, it
# puts the previous commit back, rebuilds and restarts it, and exits non-zero.
#
# Never touches: server/.env, client/.env (gitignored), the MongoDB database
# (on the host) or the uploads volume. Only tracked code and the containers.
set -euo pipefail

SHA="${1:?usage: remote-deploy.sh <commit-sha> <repo-path>}"
REPO="${2:?usage: remote-deploy.sh <commit-sha> <repo-path>}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"   # seconds to wait for a healthy API

log() { printf '\n[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { printf '\n[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

cd "$REPO" || fail "repo path not found: $REPO"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$REPO is not a git clone"
docker compose version >/dev/null 2>&1 || fail "'docker compose' (v2) is not available for $(whoami)"
docker info >/dev/null 2>&1 || fail "$(whoami) cannot talk to Docker (add it to the 'docker' group)"
[ -f server/.env ] || fail "server/.env is missing in $REPO"
[ -f client/.env ] || log "WARNING: client/.env is missing — Microsoft sign-in will not work in the built app"

# Local edits to tracked files would be lost or block the checkout: stop, change nothing.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  fail "tracked files are modified on the server (listed above). Commit them to the repo or run 'git checkout -- <file>', then re-run the pipeline."
fi

PREV="$(git rev-parse HEAD)"
BRANCH="$(git symbolic-ref --quiet --short HEAD || echo '(detached)')"
log "Running commit: ${PREV:0:12} on branch $BRANCH"
log "Target commit:  ${SHA:0:12}"

log "Fetching from every remote"
git fetch --all --prune --quiet
git cat-file -e "${SHA}^{commit}" 2>/dev/null \
  || fail "commit $SHA is not on the server's remotes ($(git remote | tr '\n' ' ')). Push it to the remote the server pulls from."
SHA="$(git rev-parse "${SHA}^{commit}")"   # a short SHA (rollback input) -> the full one

# health_ok: server container reports healthy AND the API (through the client
# nginx, like real traffic) answers with MongoDB connected.
health_ok() {
  local cid status body
  cid="$(docker compose ps -q server 2>/dev/null || true)"
  [ -n "$cid" ] || return 1
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
  [ "$status" = "healthy" ] || return 1
  if command -v curl >/dev/null 2>&1; then
    body="$(curl -fsS --max-time 5 http://127.0.0.1:8131/api/health 2>/dev/null || true)"
  elif command -v wget >/dev/null 2>&1; then
    body="$(wget -qO- --timeout=5 http://127.0.0.1:8131/api/health 2>/dev/null || true)"
  else
    body="$(docker compose exec -T server node -e "require('http').get('http://127.0.0.1:5000/api/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>process.stdout.write(d))}).on('error',()=>process.exit(1))" 2>/dev/null || true)"
  fi
  printf '%s' "$body" | grep -q '"mongo":"connected"'
}

wait_healthy() {
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if health_ok; then return 0; fi
    sleep 5; waited=$((waited + 5))
  done
  return 1
}

build_and_start() {
  docker compose build && docker compose up -d --remove-orphans && wait_healthy
}

rollback() {
  log "Deploy failed — rolling back to ${PREV:0:12}"
  git reset --keep "$PREV" || { log "could not restore the previous code automatically"; return 1; }
  if build_and_start; then
    log "Rolled back: ${PREV:0:12} is running and healthy"
  else
    log "ROLLBACK ALSO FAILED — the site may be down. Check: docker compose ps; docker compose logs --tail=100 server"
    docker compose ps || true
  fi
}

if [ "$SHA" = "$PREV" ]; then
  log "Commit already checked out — rebuilding and restarting it"
else
  # --keep: moves the current branch to the commit; refuses if it would lose local changes.
  git reset --keep "$SHA" || fail "could not check out $SHA (nothing was changed)"
fi

log "Building images and restarting containers"
if ! build_and_start; then
  log "New version did not become healthy. Last server logs:"
  docker compose logs --tail=60 server || true
  if [ "$SHA" != "$PREV" ]; then rollback; fi
  fail "deploy of ${SHA:0:12} failed"
fi

docker image prune -f >/dev/null 2>&1 || true   # only dangling (untagged) images
log "Deployed ${SHA:0:12} — containers:"
docker compose ps
log "Done"

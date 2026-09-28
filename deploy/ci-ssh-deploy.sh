#!/usr/bin/env bash
# Runs IN BITBUCKET PIPELINES. Connects to the production server over SSH and
# runs deploy/remote-deploy.sh there for one commit.
#
#   bash deploy/ci-ssh-deploy.sh <commit-sha>
#
# Repository variables (Repository settings -> Pipelines -> Repository variables):
#   DEPLOY_HOST      server hostname or IP
#   DEPLOY_USER      SSH user on the server (must be able to run docker)
#   SSH_PRIVATE_KEY  (Secured) the private key, BASE64-ENCODED on one line —
#                    Bitbucket's variable box mangles multi-line PEM keys
#   DEPLOY_PORT      optional, default 22
#   DEPLOY_PATH      optional, default /home/raviteja/Doc-Tool
#   SSH_KNOWN_HOSTS  optional, base64 of the server's known_hosts line(s). If not
#                    set, the host key added under Repository settings ->
#                    Pipelines -> SSH keys -> Known hosts is used instead.
set -euo pipefail

SHA="${1:?usage: ci-ssh-deploy.sh <commit-sha>}"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-fA-F]{7,40}$ ]] || fail "'$SHA' is not a commit SHA (7-40 hex characters)"
[ -n "${DEPLOY_HOST:-}" ] || fail "repository variable DEPLOY_HOST is not set"
[ -n "${DEPLOY_USER:-}" ] || fail "repository variable DEPLOY_USER is not set"
[ -n "${SSH_PRIVATE_KEY:-}" ] || fail "repository variable SSH_PRIVATE_KEY is not set"
PORT="${DEPLOY_PORT:-22}"
REPO_PATH="${DEPLOY_PATH:-/home/raviteja/Doc-Tool}"

SSH_DIR="$(mktemp -d)"
trap 'rm -rf "$SSH_DIR"' EXIT
chmod 700 "$SSH_DIR"

# The key is stored base64-encoded; decode it back to the real PEM file.
printf '%s' "$SSH_PRIVATE_KEY" | tr -d ' \r\n' | base64 -d > "$SSH_DIR/deploy_key" 2>/dev/null \
  || fail "SSH_PRIVATE_KEY is not valid base64 (store the output of: base64 -w0 <keyfile>)"
chmod 600 "$SSH_DIR/deploy_key"
ssh-keygen -y -f "$SSH_DIR/deploy_key" >/dev/null 2>&1 \
  || fail "SSH_PRIVATE_KEY decoded, but is not a usable private key (it must have no passphrase)"

# Host key verification stays ON: never connect to a server we can't verify.
BB_KNOWN_HOSTS=/opt/atlassian/pipelines/agent/ssh/known_hosts
if [ -n "${SSH_KNOWN_HOSTS:-}" ]; then
  printf '%s' "$SSH_KNOWN_HOSTS" | tr -d ' \r\n' | base64 -d > "$SSH_DIR/known_hosts" 2>/dev/null \
    || fail "SSH_KNOWN_HOSTS is not valid base64"
elif [ -s "$BB_KNOWN_HOSTS" ]; then
  cp "$BB_KNOWN_HOSTS" "$SSH_DIR/known_hosts"
else
  fail "no host key for $DEPLOY_HOST: add it under Repository settings -> Pipelines -> SSH keys -> Known hosts (Fetch, then Add host), or set SSH_KNOWN_HOSTS"
fi

echo "Deploying ${SHA:0:12} to ${DEPLOY_USER}@${DEPLOY_HOST}:${REPO_PATH} (port ${PORT})"
ssh -i "$SSH_DIR/deploy_key" -p "$PORT" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$SSH_DIR/known_hosts" \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=10 \
    -o ConnectTimeout=20 \
    "${DEPLOY_USER}@${DEPLOY_HOST}" \
    "bash -s -- $(printf '%q' "$SHA") $(printf '%q' "$REPO_PATH")" < deploy/remote-deploy.sh

# ---- Doc-Tool API ----
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first so code edits don't invalidate the npm layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# server/.env is NOT copied in (see .dockerignore) — compose injects it at
# runtime with env_file, so one file serves both local dev and the container.
COPY . .

# Uploads live on a volume mounted here (ASSETS_DIR).
RUN mkdir -p /app/data/public/screenshots /app/data/documents \
 && chown -R node:node /app/data
ENV ASSETS_DIR=/app/data
# Lets the startup check give container-specific advice (e.g. localhost vs mongo).
ENV RUNNING_IN_DOCKER=1

USER node
EXPOSE 5000
CMD ["node", "index.js"]

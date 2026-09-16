# ---- Doc-Tool API ----
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first so code edits don't invalidate the npm layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Uploads live on a volume mounted here (see ASSETS_DIR / compose).
RUN mkdir -p /app/data/public/screenshots /app/data/documents \
 && chown -R node:node /app/data
ENV ASSETS_DIR=/app/data

USER node
EXPOSE 5000
CMD ["node", "index.js"]

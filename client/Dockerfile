# ---- build the Vite bundle ----
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Includes client/.env — Vite loads it automatically and inlines VITE_* into
# the bundle. These are build-time values: change .env => rebuild this image.
COPY . .

RUN test -f .env || echo "WARNING: client/.env missing — VITE_* will be empty (Microsoft login will not work)"
RUN npm run build

# ---- serve it, and proxy the API to the server container ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

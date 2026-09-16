# ---- build the Vite bundle ----
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines these at build time, so they must be present now, not at runtime.
ARG VITE_AZURE_CLIENT_ID=""
ARG VITE_AZURE_TENANT_ID=""
ENV VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID
ENV VITE_AZURE_TENANT_ID=$VITE_AZURE_TENANT_ID
RUN npm run build

# ---- serve it, and proxy the API to the server container ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# syntax=docker/dockerfile:1

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    ORYN_DATA_DIR=/app/data

COPY --from=build /app/package.json ./
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/db/migrations ./db/migrations
# Agents' workstations are built from this folder, through the host's Docker
COPY --from=build /app/workstation ./workstation
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:29-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 6796

# Inside the container Oryn listens on all interfaces; publish the port to
# 127.0.0.1 on the host (see docker-compose.yml) to keep it private.
# Workstations are sibling containers: mount the host's Docker socket.
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "6796"]

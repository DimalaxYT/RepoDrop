# syntax=docker/dockerfile:1

# --------------------------------------------------------------- build
FROM node:22-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run lint && npm run typecheck && npm run test \
  && npm run build \
  && npm prune --omit=dev

# --------------------------------------------------------------- runtime
FROM node:22-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    JOBS_DIR=/tmp/repodrop-jobs \
    DB_PATH=/app/data/repodrop.db

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public

RUN mkdir -p /app/data /tmp/repodrop-jobs && chown -R node:node /app /tmp/repodrop-jobs
USER node

EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0"]

# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable \
 && corepack prepare npm@10.9.8 --activate

FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/agent-bridge/package.json ./packages/agent-bridge/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --include=dev

FROM deps AS builder
COPY . .
RUN DATABASE_URL=:memory: \
    BETTER_AUTH_SECRET=container-build-secret-123456789012345 \
    BETTER_AUTH_URL=http://localhost:4717 \
    NEXT_TELEMETRY_DISABLED=1 \
    npm run build -w apps/web

FROM base AS runner
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --create-home --home-dir /home/nextjs --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/drizzle ./apps/web/drizzle

RUN mkdir -p /app/data /app/npm-cache \
 && chown -R nextjs:nodejs /app/data /app/npm-cache

USER nextjs
ENV HOSTNAME=0.0.0.0 PORT=4717 DATABASE_URL=/app/data/chat.db MIGRATIONS_FOLDER=/app/apps/web/drizzle NPM_CONFIG_CACHE=/app/npm-cache
EXPOSE 4717

CMD ["node", "apps/web/server.js"]

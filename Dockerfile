# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM deps AS builder
COPY . .
RUN npm run build

FROM base AS runner
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./
COPY --from=builder --chown=nextjs:nodejs /app/lib/db/schema.ts ./lib/db/schema.ts

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data \
 && npm install --no-save --prefix /app drizzle-kit

USER nextjs
ENV HOSTNAME=0.0.0.0 PORT=4717 DATABASE_URL=/app/data/chat.db
EXPOSE 4717

CMD ["sh", "-c", "npx drizzle-kit migrate && node server.js"]

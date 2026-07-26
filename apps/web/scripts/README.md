# Database Seeding

This directory contains scripts for seeding the database with initial data (such as the admin user and model configurations).

The `seed.ts` script interacts directly with the Drizzle ORM and Better Auth client to programmatically insert data without relying on the UI.

## How to Reset and Seed

To perform a full reset, you need to delete the SQLite database files, run the schema migrations to recreate the tables, and then run the seed script.

### For Local Development (Dev)

Run the following command from the root of the project to wipe the local database, run migrations, and seed the data:

```bash
# 1. Delete the local SQLite database files
rm -f data/chat.db data/chat.db-wal data/chat.db-shm

# 2. Re-run migrations to create the schema
npm run db:migrate

# 3. Run the seed script
npx tsx --env-file=.env scripts/seed.ts
```

### For Production (Docker)

The Docker image intentionally ships only what the Next.js standalone runtime
needs, so `scripts/`, the `@/` source-path alias, and the full `lib/` tree
aren't inside the container. Copy them in before running the seed.

```bash
# 1. Delete the database files inside the running container
docker exec overtchat-app rm -f /app/data/chat.db /app/data/chat.db-wal /app/data/chat.db-shm

# 2. Restart the container so it runs migrations on boot
docker restart overtchat-app

# 3. Wait a few seconds for migrations, then copy the seed prerequisites in.
#    `docker cp lib` nests as /app/lib/lib on existing dirs, so merge and flatten.
docker cp scripts overtchat-app:/app/scripts
docker cp tsconfig.json overtchat-app:/app/tsconfig.json
docker cp lib overtchat-app:/app/lib
docker exec -u root overtchat-app sh -c 'cp -r /app/lib/lib/. /app/lib/ && rm -rf /app/lib/lib'

# 4. Run the seed script
docker exec overtchat-app npx tsx scripts/seed.ts
```

The copied files vanish on the next `docker compose up -d --build`, which is
what we want — seed credentials and the homelab IP in `seed.ts` have no
business being baked into the image.

## Provider cache smoke test

`provider-cache-smoke.ts` is an opt-in live integration test. It sends the
same stable tool registry through the app's actual AI SDK transports in one
append-only conversation. The sequence is Cold Auto → Warm Auto → Forced
Search → Forced Direct URL → Auto After Force. Automatic turns must remain
tool-free for explicit tool-free prompts. Forced turns must require a web tool
only on their first step, return to automatic tool choice afterward, and choose
`web_search` for a query or `fetch_url` when the user supplied a URL.

The smoke test also fails if the system instructions or full tool registry
change, or if a provider's serialized conversation rewrites an earlier prefix
instead of appending to it. Cache counters are always included in the JSON
report, but hard cache hit/write assertions are limited to providers whose APIs
return dependable counters. llama.cpp LCP selection remains useful diagnostic
output, not a cross-provider correctness contract.

Run all configured targets from `apps/web/`:

```bash
npx tsx --env-file=../../.env scripts/provider-cache-smoke.ts
```

The full baseline run requires `GEMINI_API_KEY`, `AWS_BEARER_TOKEN`, and
llama.cpp on `127.0.0.1:9876`. Native OpenAI and Anthropic targets are also
included when `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are present. Select a
comma-separated subset with `CACHE_SMOKE_TARGETS`; unrelated credentials and
servers are then optional. `CACHE_SMOKE_CORPUS_WORDS` reduces or enlarges the
stable synthetic prefix. The llama.cpp target sends `id_slot: 0` by default so
multi-slot servers still produce an unambiguous cache signal; override it with
`CACHE_SMOKE_LLAMA_SLOT`.

```bash
CACHE_SMOKE_TARGETS='llama.cpp/local' \
CACHE_SMOKE_CORPUS_WORDS=120 \
npx tsx --env-file=../../.env scripts/provider-cache-smoke.ts
```

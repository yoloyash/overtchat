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

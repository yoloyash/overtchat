# Development

Use Node 22 and npm 10.9.8. From the repository root:

```sh
npm install
npm run dev
```

Open [localhost:4717](http://localhost:4717). This starts the web app, an isolated
Redis container, and a source Host Connector. Ctrl-C stops web and connector
processes; `npm run dev:down` stops the retained Redis container. Disposable
connector state lives in `.overtchat-dev/`, separate from production.

## Environment and commands

Defaults are in `apps/web/.env.development`; machine-specific values belong in
`apps/web/.env.local`. The root `.env` configures source development;
`apps/web/.env` must remain a symlink to `../../.env`. For another development
origin, configure `EXTRA_TRUSTED_ORIGINS` and Next.js `allowedDevOrigins`.

| Command or variable | Purpose |
| --- | --- |
| `npm run dev:web` | Web only |
| `npm run dev:mobile` | Expo client |
| `npm run dev:site` | Public site |
| `npm run dev:reset-connector` | Reset an incompatible disposable connector journal |
| `npm run dev:managed` | Exercise production provisioning from the worktree |
| `OVERTCHAT_DEV_PORT` | Override the web port |
| `OVERTCHAT_DEV_REDIS_PORT` | Override the development Redis port |

Chat generation runs on the server. SQLite persists its status and completed
messages; Redis buffers live events for reconnecting clients. Without Redis,
generations still complete and clients recover saved messages, but cannot
replay missed live deltas.

## Mobile validation

For Agent Connections changes:

```sh
npm run typecheck -w apps/mobile --
npm run test -w apps/mobile --
```

Run affected web and bridge checks when shared projections or replicas change.
To validate both native bundles without publishing, run from `apps/mobile`:

```sh
npx expo export --platform android --platform ios --output-dir /tmp/overtchat-mobile-export
```

On Android and iOS, check session creation/resume, web/mobile switching,
background and network recovery, model/permission controls, commands,
approvals/questions, image input, tool output, keyboard clearance, and back
gestures. Use an existing development client unless native modules change.

## Library benchmark

Run `npm run bench:library -w apps/web --` without competing builds or tests.
It uses a disposable database with production migrations and synthetic
histories, ignoring `DATABASE_URL`. Results cover 2,000–200,000 messages and
two message sizes, with median and maximum query times across seven warm runs.
HTTP, rendering, concurrent users, and cold caches are excluded.

## README assets

See [README media](readme-media.md) for capture commands, shared fixtures,
and image review.

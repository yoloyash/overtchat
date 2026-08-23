# Releases

Agent runbook. `apps/site/public/install-manifest.json` is the candidate stable
channel used by both `overtchat setup` and `overtchat update`.

## Rules

- Version the CLI, app, connector, and STT independently.
- Publish and verify all selected artifacts before deploying the manifest.
- Use strict `X.Y.Z` versions. Never reuse a published tag or artifact.
- Managed installs do not downgrade. Roll back with a higher patch version.
- App migrations are automatic and forward-only.
- Pin bundled third-party images by digest in the manifest.

## Version map

| Component | Change | Tag |
| --- | --- | --- |
| App | Manifest `appVersion`; `compose.yml` default | `vX.Y.Z` |
| CLI | `apps/cli/package.json`; lockfile; `CLI_VERSION`; site installer; manifest `cliVersion` | `cli-vX.Y.Z` |
| Connector | Package and lockfile; connector installer; site redirects; manifest `connectorVersion` | `connector-vX.Y.Z` |
| STT | Manifest `sttVersion`; `compose.yml` default | `stt-vX.Y.Z` |
| Bundled images | Manifest `redisImage`, `searxngImage`, or `kokoroImage` digest | None |
| Mobile | Mobile package and Expo native versions | `mobile-vX.Y.Z` |

Do not change unrelated manifest fields.

## Common flow

1. Make the version changes above and run validation.
2. Open the PR against `main` and squash-merge it.
3. Tag the released `main` commit with the component tag.
4. Wait for artifact publication and the serialized promotion workflow.
5. Verify `https://overtchat.com/install-manifest.json`.

## Component notes

- **App:** `.github/workflows/app-image.yml` publishes amd64 and arm64, creates
  the GitHub release, and dispatches promotion.
- **CLI:** The CLI workflow verifies both binaries, publishes the GitHub
  release, and dispatches promotion.
- **Connector:** The connector workflow verifies both binaries, publishes the
  GitHub release, and dispatches promotion.
- **STT:** The STT workflow publishes both images and dispatches promotion.
- **Bundled images:** Promotion verifies amd64 and arm64 for every selected
  digest. A digest-only change does not require a CLI release.
- **Combined:** Artifacts may publish in any order; promotion succeeds only
  after every selected component is public.
- **Mobile:** Follow `apps/mobile/AGENTS.md` and `docs/android.md`. Do not change
  the server manifest for a mobile-only release.

## Validation

```bash
npm run lint
npm run typecheck
npm run test
```

For CLI changes:

```bash
npm run build -w apps/cli --
node apps/cli/dist/overtchat.mjs version
```

`promote-release.yml` is the only CI production deploy path. It verifies CLI
and connector checksums plus the required app/STT platforms before atomically
deploying the site and manifest. Versioned container tags are immutable.

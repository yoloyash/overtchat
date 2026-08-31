# Management CLI guidance

This workspace is the Linux installer and updater for managed OvertChat
installations. It turns a validated release manifest, detected Docker state,
and operator choices into a managed Compose stack and optional Host Connector.

## Architecture

- `src/setup.ts` is the main provisioning flow: detect or adopt an installation,
  collect configuration, render managed files, start the stack, wait for the
  app, sync service capabilities, and install the connector.
- `src/update.ts` applies newer manifest versions through the same rendering,
  Compose, readiness, and connector paths.
- `src/config.ts`, `src/paths.ts`, and `src/compose.ts` own persisted
  installation state, managed locations, secrets/environment output, optional
  service profiles, and Compose rendering.
- `src/docker.ts` owns Docker discovery, existing-install detection, GPU
  support, and bundled-sidecar reconciliation.
- `src/release.ts` validates the published manifest and handles CLI
  self-updates; `src/connector.ts` installs and verifies the managed connector.

Preserve optional-service selections across updates. Realtime voice is a
separately versioned optional image selected by the release manifest; setup and
update must not couple its version to the app or expose its container port.
Release procedures remain in `docs/release.md`.

Setup and update can modify the host installation. Keep ordinary iteration in
unit tests and reserve end-to-end runs for a disposable installation. Run the
workspace test, typecheck, and build scripts before finishing.

# Shared package guidance

These workspaces are source-level libraries consumed directly by the apps.
Keep their public exports small and preserve the dependency direction:
`agent-runtime` may depend on `agent-bridge`, while `agent-bridge` and
`shared` remain independent of application and runtime implementations.

## Agent bridge

`agent-bridge` defines the Host Connector wire protocol and the shared agent
state model used by the web app, connector, and runtime.

- `src/index.ts` owns connector commands, event batches, acknowledgements,
  protocol validation, and release compatibility constants.
- `src/agents.ts` owns connection, workspace, session, command, catalog,
  snapshot, cursor, and synchronization contracts.
- `src/state.ts` owns the pure reducers that apply runtime envelopes and
  reconcile snapshots; `src/commands.ts` owns shared command normalization.
- Keep this package transport-neutral and free of filesystem, network, process,
  database, UI, or provider implementations.
- Wire types, Zod schemas, runtime guards, reducers, and tests must evolve
  together. The current protocol is exact; increment it only for a breaking
  web-to-connector contract change and coordinate the web and connector
  consumers rather than adding parallel protocol shapes.

## Agent runtime

`agent-runtime` adapts Codex, Pi, and Oh My Pi into the bridge contracts and
provides host-runtime primitives used by the connector.

- `src/providers/types.ts` defines the provider adapter and runtime-client
  interfaces; `src/providers/registry.ts` registers the provider adapters.
- Provider-specific clients, probes, protocol parsing, commands, and session
  discovery remain under their `src/codex`, `src/pi`, or `src/omp` directory.
- `src/runtime/registry.ts` owns live session orchestration, normalized state,
  event sequencing, queued submissions, and runtime shutdown.
- Local and SSH execution goes through the spawner configured in
  `src/runtime/process.ts`. Provider implementations do not create child
  processes directly.
- Normalize provider messages and behavior inside the provider adapter before
  emitting bridge events. Keep timeouts, output bounds, and deterministic
  process cleanup in the shared runtime path.

## Shared

`shared` contains cross-client chat, model, tool, citation, MCP-name, search,
and theme contracts used by web, mobile, and the static site.

- Keep exports platform-neutral and free of authorization, persistence,
  network clients, and application UI.
- `src/index.ts` is the public TypeScript surface. The export map in
  `package.json` additionally exposes the generated web and React Native theme
  representations.
- `src/theme/tokens.ts` is the theme source of truth. Do not edit
  `src/theme.css` or `src/theme.rn.ts` manually; regenerate and commit both with
  `npm run theme:generate -w packages/shared --`.
- Shared contracts must remain valid for every consumer. Put app-specific
  extensions in the consuming workspace rather than weakening a shared type.

## Validation

Run the changed package's typecheck and tests where available. Bridge changes
require its web, connector, and runtime consumers; runtime changes require the
connector; shared contract or theme changes require the affected web, mobile,
and site checks.

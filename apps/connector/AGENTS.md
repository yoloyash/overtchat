# Host Connector guidance

This workspace is the host-native bridge between an OvertChat server and local
or SSH-hosted coding agents. It maintains an authenticated outbound connection,
runs provider sessions through `@overtchat/agent-runtime`, and sends their state
back using contracts from `@overtchat/agent-bridge`.

## Architecture

- `src/cli.ts`, `src/config.ts`, and `src/service.ts` own pairing, persisted
  credentials, command routing, and systemd user-service installation.
- `src/client.ts` owns the server connection, reconnect behavior, command
  stream, event delivery, acknowledgements, and connector instance lock.
- `src/daemon.ts` dispatches bridge requests, manages live agent sessions, and
  coordinates command execution with durable state.
- `src/state.ts` persists command deduplication, durable outbound events,
  session descriptors, and queued messages across reconnects and restarts.
- `src/timeline.ts` is the canonical per-session event history used for replay
  and synchronization. Live session events are recoverable hints derived from
  this timeline.
- `src/runtime.ts` and `src/ssh.ts` adapt local or SSH process execution to the
  runtime package. SSH targets remain OpenSSH aliases; the connector does not
  manage private keys.

The connector is outbound-only and does not expose a shell or listening server.
Changes to command handling or event delivery must preserve journal-before-ack
ordering, command deduplication, and timeline recovery across restarts.

Run the workspace tests, typecheck, and build before finishing. Changes to
transport or persistence require the corresponding client, daemon, state, and
timeline tests.

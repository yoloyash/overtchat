import "server-only";
import { authenticateHostConnectorToken } from "@/lib/db/hostConnectors";
import { TerminalRelay } from "./relay";

const globalRelay = globalThis as typeof globalThis & { overtchatTerminalRelay?: TerminalRelay };
export const terminalRelay = globalRelay.overtchatTerminalRelay ??= new TerminalRelay((request) => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const connector = authenticateHostConnectorToken(token);
  if (!connector) return null;
  return { id: connector.id, authorize: () => authenticateHostConnectorToken(token)?.id === connector.id };
});

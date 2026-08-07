import "server-only";
import {
  authenticateHostConnectorToken,
  type HostConnectorRow,
} from "@/lib/db/hostConnectors";

export function authenticateHostConnector(
  request: Request,
): HostConnectorRow | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authenticateHostConnectorToken(authorization.slice(7));
}

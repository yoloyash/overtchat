import { z } from "zod";
import { auth } from "@/lib/auth/server";
import {
  connectionAccessError,
  connectionErrorMessage,
} from "@/lib/agents/access";
import { agentDiscoveryTargetSchema } from "@overtchat/agent-bridge";
import type { ConnectorShellMode } from "@overtchat/agent-bridge";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { getAvailableHostConnector } from "@/lib/db/hostConnectors";

export const maxDuration = 30;

const requestSchema = z.object({
  target: agentDiscoveryTargetSchema,
  path: z
    .string()
    .trim()
    .max(4_096)
    .refine((value) => !value || value.startsWith("/"), {
      message: "Enter an absolute directory path.",
    })
    .optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const accessError = connectionAccessError(session.user.role);
  if (accessError) {
    return Response.json({ error: accessError }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid host." },
      { status: 400 },
    );
  }
  const { target, path } = parsed.data;
  if (!getAvailableHostConnector(target.connectorId, session.user.id)) {
    return new Response("Host Connector not found", { status: 404 });
  }

  try {
    let firstError: unknown;
    for (const shellMode of [
      "interactive",
      "login",
    ] satisfies ConnectorShellMode[]) {
      try {
        const directory = await hostConnectorBroker.request(
          target.connectorId,
          {
            type: "list_directories",
            target:
              target.transport === "local"
                ? { transport: "local", shellMode }
                : { transport: "ssh", alias: target.sshAlias, shellMode },
            ...(path ? { path } : {}),
          },
        );
        return Response.json({ directory });
      } catch (error) {
        firstError ??= error;
      }
    }
    throw firstError ?? new Error("The directory could not be opened.");
  } catch (error) {
    return Response.json(
      { error: connectionErrorMessage(error) },
      { status: 400 },
    );
  }
}

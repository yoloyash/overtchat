import { consumeHostConnectorPairing } from "@/lib/db/hostConnectors";

const MAX_NAME_LENGTH = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    pairCode?: unknown;
    name?: unknown;
    version?: unknown;
  } | null;
  if (
    !body ||
    typeof body.pairCode !== "string" ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > MAX_NAME_LENGTH ||
    (body.version !== undefined && typeof body.version !== "string")
  ) {
    return Response.json({ error: "Invalid pairing request." }, { status: 400 });
  }
  const paired = consumeHostConnectorPairing({
    pairCode: body.pairCode,
    name: body.name.trim(),
    version: typeof body.version === "string" ? body.version : null,
  });
  if (!paired) {
    return Response.json(
      { error: "That pairing code is invalid or expired." },
      { status: 401 },
    );
  }
  return Response.json({
    connectorId: paired.connector.id,
    token: paired.token,
  });
}

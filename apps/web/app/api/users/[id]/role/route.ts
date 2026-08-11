import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { hostConnectorBroker } from "@/lib/agents/connector/broker";
import { listHostConnectors } from "@/lib/db/hostConnectors";
import { changeUserRole } from "@/lib/db/users";

const bodySchema = z.object({
  role: z.enum(["user", "admin"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Choose a valid role." }, { status: 400 });
  }

  const { id } = await params;
  const result = changeUserRole(session.user.id, id, parsed.data.role);
  if (result.status === "not_found") {
    return new Response("Not found", { status: 404 });
  }
  if (result.status === "self") {
    return Response.json(
      { error: "You cannot change your own role." },
      { status: 400 },
    );
  }
  if (result.status === "last_admin") {
    return Response.json(
      { error: "At least one administrator is required." },
      { status: 409 },
    );
  }

  if (result.status === "updated" && parsed.data.role === "user") {
    await Promise.allSettled(
      listHostConnectors(id).map((connector) =>
        hostConnectorBroker.request(connector.id, { type: "stop_all" }),
      ),
    );
  }
  return Response.json({ user: result.user });
}

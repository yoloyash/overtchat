import { z } from "zod";
import { auth } from "@/lib/auth/server";
import {
  registerPushDevice,
  unregisterPushDevice,
} from "@/lib/db/pushNotifications";
import { pushDeviceSchema } from "@/lib/notifications/schema";

export async function POST(req: Request) {
  const login = await auth.api.getSession({ headers: req.headers });
  if (!login) return new Response("Unauthorized", { status: 401 });
  const parsed = pushDeviceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Invalid notification settings." },
      { status: 400 },
    );
  if (!registerPushDevice(login.user.id, login.session.id, parsed.data)) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json({ registered: true });
}

export async function DELETE(req: Request) {
  const login = await auth.api.getSession({ headers: req.headers });
  if (!login) return new Response("Unauthorized", { status: 401 });
  const parsed = z
    .object({ id: z.uuid() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid registration." }, { status: 400 });
  unregisterPushDevice(login.user.id, parsed.data.id);
  return new Response(null, { status: 204 });
}

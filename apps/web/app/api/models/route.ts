import { auth } from "@/lib/auth/server";
import { ProviderConnectionSchema } from "@/lib/model-config/schema";
import { preflight, withCors } from "@/lib/cors";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import { listProviderModels } from "@/lib/providers/server/registry";

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return withCors(req, new Response("Unauthorized", { status: 401 }));
  if (session.user.role !== "admin") {
    return withCors(req, new Response("Forbidden", { status: 403 }));
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCors(
      req,
      Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    );
  }

  const parsed = ProviderConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return withCors(
      req,
      Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      ),
    );
  }

  try {
    const models = await listProviderModels(parsed.data);
    return withCors(req, Response.json({ models }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return withCors(
      req,
      Response.json(
        { error: msg },
        { status: isProviderConfigurationError(err) ? 400 : 502 },
      ),
    );
  }
}

import { auth } from "@/lib/auth/server";
import { ProviderConnectionSchema } from "@/lib/model-config/schema";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import {
  catalogCapabilitiesFor,
  catalogContextWindowFor,
  catalogPricingFor,
} from "@/lib/providers/server/model-catalog";
import { listProviderModels } from "@/lib/providers/server/registry";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ProviderConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    const models = (await listProviderModels(parsed.data)).map((model) => {
      const catalogContextWindow = catalogContextWindowFor(
        parsed.data.providerId,
        model.id,
      );
      const catalogCapabilities = catalogCapabilitiesFor(
        parsed.data.providerId,
        model.id,
      );
      const catalogPricing = catalogPricingFor(
        parsed.data.providerId,
        model.id,
      );
      return {
        ...model,
        ...(catalogContextWindow === undefined
          ? {}
          : { catalogContextWindow }),
        ...(catalogCapabilities === undefined
          ? {}
          : { catalogCapabilities }),
        ...(catalogPricing === undefined ? {} : { catalogPricing }),
      };
    });
    return Response.json({ models });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: msg },
      { status: isProviderConfigurationError(err) ? 400 : 502 },
    );
  }
}

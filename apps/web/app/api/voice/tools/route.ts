import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import { fetchReadable } from "@/lib/web";

const requestSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("web_search"),
    input: z.object({
      query: z.string().min(1).max(2_000),
      limit: z.number().int().min(1).max(10).default(5),
    }),
  }),
  z.object({
    name: z.literal("fetch_url"),
    input: z.object({
      url: z.string().url(),
      startIndex: z.number().int().min(0).optional(),
    }),
  }),
]);

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (getServerCapability("search").provider === "disabled") {
    return Response.json({ error: "Web search is unavailable." }, { status: 503 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid voice tool request." }, { status: 400 });
  }

  try {
    if (parsed.data.name === "web_search") {
      const { searchWeb } = await import("@/lib/web");
      const output = await searchWeb(
        parsed.data.input.query,
        parsed.data.input.limit,
        request.signal,
      );
      return Response.json({ output });
    }
    const output = await fetchReadable(parsed.data.input.url, {
      startIndex: parsed.data.input.startIndex,
      signal: request.signal,
    });
    if (output.kind === "image") {
      return Response.json({
        output: {
          kind: "text",
          url: output.url,
          title: "Image",
          content: "This voice session cannot inspect image-only content.",
          wordCount: 8,
        },
      });
    }
    return Response.json({ output });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}

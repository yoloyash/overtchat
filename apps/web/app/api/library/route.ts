import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { listLibrary } from "@/lib/db/library";

const cursorSchema = z.object({
  createdAt: z.number().int().min(0).max(8_640_000_000_000_000),
  id: z.string().min(1).max(200),
});

const paramsSchema = z.object({
  q: z.string().trim().max(200).default(""),
  cursor: z.string().max(1000).transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid library cursor." });
      return z.NEVER;
    }
  }).pipe(cursorSchema).optional(),
});

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const params = paramsSchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!params.success) {
    return Response.json({ error: "Invalid library search parameters." }, { status: 400 });
  }
  const { q, cursor } = params.data;
  return Response.json(await listLibrary(session.user.id, q, cursor), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

import { auth } from "@/lib/auth/server";
import { ImportError, importChats } from "@/lib/import";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return new Response("Missing file", { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await importChats(session.user.id, bytes);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ImportError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("[import]", err);
    return Response.json({ error: "Import failed." }, { status: 500 });
  }
}

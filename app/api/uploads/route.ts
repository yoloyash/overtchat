import fs from "node:fs/promises";
import { auth } from "@/lib/auth/server";
import { createUpload, uploadPath } from "@/lib/db/uploads";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response("Missing file", { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json(
      { error: `Unsupported type: ${file.type || "unknown"}` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `File exceeds ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 413 },
    );
  }

  const id = crypto.randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(uploadPath(id), bytes);
  await createUpload({
    id,
    userId,
    filename: file.name || "upload",
    mediaType: file.type,
  });

  return Response.json({
    url: `/api/uploads/${id}`,
    mediaType: file.type,
    filename: file.name || "upload",
  });
}

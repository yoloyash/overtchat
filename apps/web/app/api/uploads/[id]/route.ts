import fs from "node:fs/promises";
import { auth } from "@/lib/auth/server";
import { getUpload, uploadPath } from "@/lib/db/uploads";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const row = await getUpload(id, session.user.id);
  if (!row) return new Response("Not found", { status: 404 });

  try {
    const bytes = await fs.readFile(uploadPath(id));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.mediaType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": contentDisposition(row),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function contentDisposition(row: {
  category: string;
  filename: string;
}): string {
  const mode = row.category === "image" ? "inline" : "attachment";
  const encoded = encodeURIComponent(row.filename).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${mode}; filename*=UTF-8''${encoded}`;
}

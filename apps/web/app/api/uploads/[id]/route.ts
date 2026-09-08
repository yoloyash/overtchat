import fs from "node:fs/promises";
import { auth } from "@/lib/auth/server";
import { getUpload, uploadPath } from "@/lib/db/uploads";

const INLINE_MEDIA_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/pdf", "text/plain",
]);

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
    // Active documents such as HTML must download instead of executing on the
    // authenticated app origin. Apply this on read to cover existing uploads.
    const disposition = INLINE_MEDIA_TYPES.has(row.mediaType) ? "inline" : "attachment";
    const filename = encodeURIComponent(row.filename).replace(
      /['()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.mediaType,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${filename}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

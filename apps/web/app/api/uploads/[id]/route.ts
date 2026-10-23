import fs from "node:fs/promises";
import { auth } from "@/lib/auth/server";
import { getUpload, uploadPath } from "@/lib/db/uploads";
import { uploadHeaders } from "@/lib/upload-response";

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
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...uploadHeaders(row),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

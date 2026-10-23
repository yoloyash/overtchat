import fs from "node:fs/promises";
import { readSharedUpload } from "@/lib/db/chatShares";
import { uploadPath } from "@/lib/db/uploads";
import { shareHeaders } from "@/lib/sharing-response";
import { uploadHeaders } from "@/lib/upload-response";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const upload = readSharedUpload(id, fileId);
  if (!upload)
    return new Response("Not found", { status: 404, headers: shareHeaders });
  try {
    const bytes = await fs.readFile(uploadPath(upload.id));
    return new Response(new Uint8Array(bytes), {
      headers: { ...uploadHeaders(upload), ...shareHeaders },
    });
  } catch {
    return new Response("Not found", { status: 404, headers: shareHeaders });
  }
}

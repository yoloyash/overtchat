import { Readable } from "node:stream";
import { limitShareRead } from "@/lib/share-rate-limit";
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
  const limited = limitShareRead(id, "file");
  if (limited) return limited;
  const upload = readSharedUpload(id, fileId);
  if (!upload)
    return new Response("Not found", { status: 404, headers: shareHeaders });
  try {
    const handle = await fs.open(uploadPath(upload.id), "r");
    const stream = Readable.toWeb(
      handle.createReadStream(),
    ) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: { ...uploadHeaders(upload), ...shareHeaders },
    });
  } catch {
    return new Response("Not found", { status: 404, headers: shareHeaders });
  }
}

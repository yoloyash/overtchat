import fs from "node:fs/promises";
import { authenticateHostConnector } from "@/lib/agents/connector/auth";
import { getUpload, uploadPath } from "@/lib/db/uploads";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const connector = authenticateHostConnector(request);
  if (!connector) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const upload = await getUpload(id, connector.userId);
  if (!upload || upload.category !== "image") {
    return new Response("Not found", { status: 404 });
  }
  try {
    const bytes = await fs.readFile(uploadPath(id));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": upload.mediaType,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

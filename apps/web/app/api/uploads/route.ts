import fs from "node:fs/promises";
import { auth } from "@/lib/auth/server";
import { createUpload, uploadPath } from "@/lib/db/uploads";
import {
  extractFile,
  ExtractionError,
  MAX_BYTES_DOC,
  MAX_BYTES_IMAGE,
  MAX_BYTES_TEXT,
} from "@/lib/extract";

function sizeCap(mediaType: string, filename: string): number {
  if (mediaType.startsWith("image/")) return MAX_BYTES_IMAGE;
  if (/\.(pdf|docx|xlsx|xls)$/i.test(filename)) return MAX_BYTES_DOC;
  if (mediaType === "application/pdf" || mediaType.includes("officedocument")) return MAX_BYTES_DOC;
  return MAX_BYTES_TEXT;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return new Response("Missing file", { status: 400 });

  const filename = file.name || "upload";
  const mediaType = file.type || "application/octet-stream";
  const cap = sizeCap(mediaType, filename);
  if (file.size > cap) {
    return Response.json(
      { error: `File exceeds ${Math.round(cap / 1024 / 1024)}MB` },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  let result;
  try {
    result = await extractFile({ buffer: bytes, filename, mediaType });
  } catch (err) {
    if (err instanceof ExtractionError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("[extract]", err);
    return Response.json({ error: "Failed to read file." }, { status: 422 });
  }

  const id = crypto.randomUUID();
  await fs.writeFile(uploadPath(id), bytes);
  await createUpload({
    id,
    userId: session.user.id,
    filename,
    mediaType: result.mediaType,
    category: result.category,
    size: file.size,
    pageCount: result.pageCount,
    extractedText: result.text,
    truncated: result.truncated,
  });

  return Response.json({
    url: `/api/uploads/${id}`,
    mediaType: result.mediaType,
    filename,
    category: result.category,
    size: file.size,
    pageCount: result.pageCount,
    truncated: result.truncated,
  });
}

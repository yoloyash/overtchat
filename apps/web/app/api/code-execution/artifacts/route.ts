import { auth } from "@/lib/auth/server";
import { storeCodeArtifacts } from "@/lib/db/uploads";
import { assertFetchedImageContent } from "@/lib/image-content";
import {
  MAX_CODE_EXECUTION_FILE_BYTES,
  MAX_CODE_EXECUTION_OUTPUTS,
  MAX_CODE_EXECUTION_TOTAL_OUTPUT_BYTES,
} from "@overtchat/shared";

const SAFE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const files = form.getAll("files");
  if (files.length === 0 || files.some((file) => !(file instanceof File))) {
    return Response.json({ error: "Missing generated files." }, { status: 400 });
  }
  if (files.length > MAX_CODE_EXECUTION_OUTPUTS) {
    return Response.json({ error: "Too many generated files." }, { status: 413 });
  }

  const validated: Array<{
    filename: string;
    mediaType: string;
    data: Uint8Array;
    image: boolean;
  }> = [];
  let totalBytes = 0;
  for (const entry of files) {
    const file = entry as File;
    if (file.size > MAX_CODE_EXECUTION_FILE_BYTES) {
      return Response.json(
        { error: `${file.name || "Output"} exceeds 20 MB.` },
        { status: 413 },
      );
    }
    totalBytes += file.size;
    if (totalBytes > MAX_CODE_EXECUTION_TOTAL_OUTPUT_BYTES) {
      return Response.json(
        { error: "Generated files exceed 50 MB total." },
        { status: 413 },
      );
    }

    const data = new Uint8Array(await file.arrayBuffer());
    const claimedType = file.type || "application/octet-stream";
    let image = SAFE_IMAGE_TYPES.has(claimedType);
    if (image) {
      try {
        assertFetchedImageContent(data, claimedType);
      } catch {
        image = false;
      }
    }
    validated.push({
      filename: file.name || "output",
      mediaType: image ? claimedType : safeDownloadMediaType(claimedType),
      data,
      image,
    });
  }

  const artifacts = await storeCodeArtifacts(
    validated.map((file) => ({ userId: session.user.id, ...file })),
  );
  return Response.json({ artifacts });
}

function safeDownloadMediaType(mediaType: string): string {
  if (/^[\w.+-]+\/[\w.+-]+$/u.test(mediaType)) return mediaType;
  return "application/octet-stream";
}

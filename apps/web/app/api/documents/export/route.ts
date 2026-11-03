import { z } from "zod";
import {
  documentFilename,
  MAX_DOCUMENT_LENGTH,
  WORD_MEDIA_TYPE,
} from "@overtchat/shared";
import { auth } from "@/lib/auth/server";
import { markdownToDocx } from "@/lib/documents/docx";
import { uploadHeaders } from "@/lib/upload-response";

const ExportRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.literal("markdown"),
  content: z.string().max(MAX_DOCUMENT_LENGTH),
  format: z.literal("docx"),
});

/**
 * Convert a document the client already has into a Word file. The request
 * carries the content, so temporary chats and every saved version export the
 * same way; nothing is stored.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid export request" },
      { status: 400 },
    );
  }
  const { title, type, content } = parsed.data;
  const bytes = await markdownToDocx(title, content);
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...uploadHeaders({
        mediaType: WORD_MEDIA_TYPE,
        filename: documentFilename({ title, type }, "docx"),
      }),
      "Cache-Control": "no-store",
    },
  });
}

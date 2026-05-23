import "server-only";

export const MAX_BYTES_IMAGE = 20 * 1024 * 1024;
export const MAX_BYTES_DOC = 15 * 1024 * 1024;
export const MAX_BYTES_TEXT = 5 * 1024 * 1024;

const MAX_EXTRACTED_CHARS = 400_000;

export type UploadCategory = "image" | "document" | "text" | "spreadsheet";

export interface ExtractResult {
  category: UploadCategory;
  mediaType: string;
  text: string | null;
  pageCount: number | null;
  truncated: boolean;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly status: 415 | 422 = 422,
  ) {
    super(message);
  }
}

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

// Extensions we accept as plain text, even when the browser ships an unknown
// or octet-stream MIME. Mirrors LibreChat's codeTypeMapping, trimmed.
const CODE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "rst", "log", "tsv",
  "json", "jsonc", "json5", "yaml", "yml", "toml", "xml", "ini", "env",
  "html", "htm", "css", "scss", "sass", "less",
  "js", "jsx", "mjs", "cjs", "ts", "tsx",
  "py", "pyw", "rb", "php", "go", "rs", "java", "kt", "kts", "scala",
  "c", "h", "cc", "cpp", "hpp", "cs", "m", "mm", "swift",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "sql", "graphql", "gql", "proto",
  "dockerfile", "makefile", "cmake", "gradle",
  "vue", "svelte", "astro", "tex", "bib",
  "dart", "lua", "r", "jl", "ex", "exs", "erl", "elm", "clj", "hs", "nim", "zig",
]);

export async function extractFile(input: {
  buffer: Buffer;
  filename: string;
  mediaType: string;
}): Promise<ExtractResult> {
  const { buffer, filename, mediaType } = input;
  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : lower;

  if (IMAGE_TYPES.has(mediaType)) {
    return { category: "image", mediaType, text: null, pageCount: null, truncated: false };
  }

  if (mediaType === "application/pdf") {
    const { text, pageCount } = await readPdf(buffer);
    return finalize("document", mediaType, text, pageCount);
  }

  if (mediaType === DOCX_TYPE || ext === "docx") {
    const text = await readDocx(buffer);
    return finalize("document", DOCX_TYPE, text, null);
  }

  if (mediaType === XLSX_TYPE || mediaType === "application/vnd.ms-excel" || ext === "xlsx" || ext === "xls") {
    const text = await readSpreadsheet(buffer);
    return finalize("spreadsheet", XLSX_TYPE, text, null);
  }

  if (mediaType === "text/csv" || ext === "csv") {
    return finalize("spreadsheet", "text/csv", readUtf8(buffer), null);
  }

  if (mediaType.startsWith("text/") || CODE_EXTENSIONS.has(ext) || ext === "dockerfile" || ext === "makefile") {
    return finalize("text", mediaType.startsWith("text/") ? mediaType : "text/plain", readUtf8(buffer), null);
  }

  throw new ExtractionError(`Unsupported file type: ${mediaType || filename}`, 415);
}

function finalize(
  category: UploadCategory,
  mediaType: string,
  text: string,
  pageCount: number | null,
): ExtractResult {
  if (text.length <= MAX_EXTRACTED_CHARS) {
    return { category, mediaType, text, pageCount, truncated: false };
  }
  const head = text.slice(0, MAX_EXTRACTED_CHARS);
  const omitted = text.length - MAX_EXTRACTED_CHARS;
  return {
    category,
    mediaType,
    text: `${head}\n\n[truncated: ${omitted} more characters omitted]`,
    pageCount,
    truncated: true,
  };
}

async function readPdf(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    if ((err as { name?: string })?.name === "PasswordException") {
      throw new ExtractionError("This PDF is password-protected.", 422);
    }
    throw new ExtractionError(`Failed to read PDF: ${(err as Error).message}`, 422);
  }
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const body = (Array.isArray(text) ? text.join("\n\n") : text).trim();
  if (!body) {
    throw new ExtractionError(
      "No text extracted — this looks like a scanned PDF. OCR is not supported.",
      422,
    );
  }
  return { text: body, pageCount: totalPages };
}

async function readDocx(buffer: Buffer): Promise<string> {
  assertSafeZipSize(buffer, 100 * 1024 * 1024);
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  const text = value.trim();
  if (!text) throw new ExtractionError("No text extracted from DOCX.", 422);
  return text;
}

// Guards against DOCX zip bombs: a 1MB zip can decompress to 1GB+ and blow
// the Node heap inside mammoth. Scans the ZIP central directory for declared
// uncompressed sizes without decompressing anything.
function assertSafeZipSize(buf: Buffer, maxBytes: number): void {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ExtractionError("Not a valid DOCX archive.", 422);

  const numEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  let pos = cdOffset;
  let total = 0;
  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(pos) !== CD_SIG) {
      throw new ExtractionError("Corrupt DOCX archive.", 422);
    }
    const uncompressed = buf.readUInt32LE(pos + 24);
    total += uncompressed;
    if (total > maxBytes) {
      throw new ExtractionError(
        "DOCX decompresses to an unsafe size.",
        422,
      );
    }
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    pos += 46 + nameLen + extraLen + commentLen;
  }
}

async function readSpreadsheet(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet).trim();
    if (csv) parts.push(`# Sheet: ${name}\n${csv}`);
  }
  const text = parts.join("\n\n").trim();
  if (!text) throw new ExtractionError("Spreadsheet has no readable cells.", 422);
  return text;
}

function readUtf8(buffer: Buffer): string {
  const text = buffer.toString("utf8").trim();
  if (!text) throw new ExtractionError("File is empty.", 422);
  return text;
}

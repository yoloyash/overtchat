const INLINE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

export function uploadHeaders(upload: { mediaType: string; filename: string }) {
  const disposition = INLINE_MEDIA_TYPES.has(upload.mediaType)
    ? "inline"
    : "attachment";
  const filename = encodeURIComponent(upload.filename).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return {
    "Content-Type": upload.mediaType,
    "Content-Disposition": `${disposition}; filename*=UTF-8''${filename}`,
    "X-Content-Type-Options": "nosniff",
  };
}

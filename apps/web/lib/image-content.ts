const IMAGE_SIGNATURES = {
  "image/gif": [
    Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),
    Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  ],
  "image/jpeg": [Uint8Array.from([0xff, 0xd8, 0xff])],
  "image/png": [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ],
  "image/webp": [Uint8Array.from([0x52, 0x49, 0x46, 0x46])],
} as const;

type SupportedImageMediaType = keyof typeof IMAGE_SIGNATURES;

export function assertFetchedImageContent(
  data: Uint8Array,
  mediaType: string,
): asserts mediaType is SupportedImageMediaType {
  if (!isSupportedImageMediaType(mediaType)) {
    throw new Error(`Unsupported fetched image type: ${mediaType || "unknown"}.`);
  }

  const matches = IMAGE_SIGNATURES[mediaType].some((signature) =>
    hasPrefix(data, signature),
  );
  const validWebp =
    mediaType !== "image/webp" ||
    (matches &&
      data.byteLength >= 12 &&
      String.fromCharCode(...data.slice(8, 12)) === "WEBP");
  if (!matches || !validWebp) {
    throw new Error(`Fetched image bytes do not match ${mediaType}.`);
  }
}

function isSupportedImageMediaType(
  mediaType: string,
): mediaType is SupportedImageMediaType {
  return Object.hasOwn(IMAGE_SIGNATURES, mediaType);
}

function hasPrefix(data: Uint8Array, prefix: Uint8Array): boolean {
  return (
    data.byteLength >= prefix.byteLength &&
    prefix.every((byte, index) => data[index] === byte)
  );
}

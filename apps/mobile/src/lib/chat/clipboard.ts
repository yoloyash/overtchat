import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import { EncodingType, File, Paths } from "expo-file-system";
import type { PickedFile } from "./useAttachments";

const BASE64_MARKER = ";base64,";

export async function readClipboardImage(): Promise<PickedFile | null> {
  const image = await Clipboard.getImageAsync({ format: "png" });
  if (!image) return null;

  const base64Start = image.data.indexOf(BASE64_MARKER);
  if (!image.data.startsWith("data:image/") || base64Start < 0) {
    throw new Error("The clipboard image could not be read.");
  }

  const name = `clipboard-${Crypto.randomUUID()}.png`;
  const file = new File(Paths.cache, name);
  file.create();
  file.write(image.data.slice(base64Start + BASE64_MARKER.length), {
    encoding: EncodingType.Base64,
  });

  return { uri: file.uri, name, type: "image/png" };
}

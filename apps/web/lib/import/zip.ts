import "server-only";
import { unzipSync, strFromU8 } from "fflate";
import { ImportError } from "./types";

// Magic bytes for a local file header: "PK\x03\x04".
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * Pull the first plausible conversations JSON out of a zip. ChatGPT's export
 * has `conversations.json` alongside unrelated files; Claude's has
 * `conversations.json` inside a ZIP too. We prefer that name, else fall back to
 * any .json entry.
 */
export function readJsonFromZip(bytes: Uint8Array): unknown {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  const preferred = names.find((n) => /(^|\/)conversations\.json$/i.test(n));
  const pick =
    preferred ?? names.find((n) => n.toLowerCase().endsWith(".json"));
  if (!pick) throw new ImportError("No JSON file found in zip.");
  try {
    return JSON.parse(strFromU8(files[pick]));
  } catch {
    throw new ImportError(`Could not parse ${pick} as JSON.`);
  }
}

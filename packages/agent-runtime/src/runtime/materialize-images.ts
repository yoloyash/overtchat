import type { ResolvedAgentImage } from "@overtchat/agent-runtime/providers/types";
import type { HostTarget } from "@overtchat/agent-runtime/runtime/process";
import { executeOnHost } from "@overtchat/agent-runtime/runtime/process";

const SCRIPT = `
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const dir = path.join(os.tmpdir(), "overtchat-agent-images");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
for (const name of fs.readdirSync(dir)) {
  const file = path.join(dir, name);
  try {
    if (Date.now() - fs.statSync(file).mtimeMs > 24 * 60 * 60 * 1000) {
      fs.rmSync(file, { force: true });
    }
  } catch {}
}
const extensions = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const paths = input.map((image) => {
  const file = path.join(
    dir,
    crypto.randomUUID() + (extensions[image.mediaType] || ".img"),
  );
  fs.writeFileSync(file, Buffer.from(image.data, "base64"), { mode: 0o600 });
  return file;
});
process.stdout.write(JSON.stringify(paths));
`.trim();

export async function materializeAgentImages(
  target: HostTarget,
  images: readonly ResolvedAgentImage[],
): Promise<string[]> {
  if (images.length === 0) return [];
  const result = await executeOnHost(
    target,
    { command: "node", args: ["-e", SCRIPT] },
    {
      timeoutMs: 60_000,
      stdin: JSON.stringify(
        images.map(({ data, mediaType }) => ({ data, mediaType })),
      ),
    },
  );
  const paths = JSON.parse(result.stdout) as unknown;
  if (
    !Array.isArray(paths) ||
    !paths.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new Error("The agent host returned invalid image paths.");
  }
  return paths;
}

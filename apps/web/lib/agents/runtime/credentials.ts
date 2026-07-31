import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const FORMAT_VERSION = "v1";

function encryptionKey(): Buffer {
  const secret =
    process.env.AGENT_CONNECTIONS_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AGENT_CONNECTIONS_SECRET or BETTER_AUTH_SECRET is required to store an SSH private key.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptAgentCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptAgentCredential(value: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] =
    value.split(".");
  if (
    version !== FORMAT_VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra !== undefined
  ) {
    throw new Error("Unsupported encrypted agent credential.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

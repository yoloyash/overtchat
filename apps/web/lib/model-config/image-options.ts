import { z } from "zod";

// Request identity and the single-image/storage contract are owned by OvertChat.
const reserved = new Set([
  "model",
  "prompt",
  "n",
  "size",
  "response_format",
  "image",
  "image[]",
  "images",
  "mask",
  "stream",
  "__proto__",
  "constructor",
  "prototype",
]);

export const CustomImageOptionsSchema = z
  .object({
    size: z.string().trim().min(1).max(64).default("auto"),
    responseFormat: z.enum(["b64_json", "url"]).default("b64_json"),
    supportsEditing: z.boolean().default(false),
    extraBody: z
      .record(z.string(), z.json())
      .default({})
      .superRefine((value, ctx) => {
        for (const key of Object.keys(value)) {
          if (reserved.has(key))
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: `${key} cannot be set in extra image parameters.`,
            });
        }
        if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384)
          ctx.addIssue({
            code: "custom",
            message: "Extra image parameters must be at most 16 KiB.",
          });
      }),
  })
  .strict();

export type CustomImageOptions = z.infer<typeof CustomImageOptionsSchema>;

export function customImageOptions(value: unknown): CustomImageOptions {
  return CustomImageOptionsSchema.parse(value ?? {});
}

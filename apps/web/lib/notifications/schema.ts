import { z } from "zod";

export const pushDeviceSchema = z.object({
  id: z.uuid(),
  token: z
    .string()
    .max(256)
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
  chats: z.boolean(),
  agents: z.boolean(),
  previews: z.boolean(),
  // Apps from before sign-in approvals don't send it.
  signIns: z.boolean().default(false),
});
export type PushDeviceInput = z.infer<typeof pushDeviceSchema>;

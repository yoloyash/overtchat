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
});
export type PushDeviceInput = z.infer<typeof pushDeviceSchema>;

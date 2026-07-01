import { z } from "zod";

export interface ToolSettings {
  webSearchEnabled: boolean;
}

export const ToolSettingsSchema = z.object({
  webSearchEnabled: z.boolean(),
});

export type ToolSettingsInput = z.infer<typeof ToolSettingsSchema>;

export interface AdminMcpServer {
  id: string;
  name: string;
  slug: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  enabled: boolean;
  sortOrder: number;
}

export interface McpServerPublicSummary {
  id: string;
  name: string;
  enabled: boolean;
}

export const McpServerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  transport: z.literal("stdio").default("stdio"),
  command: z.string().trim().min(1, "Command is required"),
  args: z
    .array(z.string())
    .nullish()
    .transform((values) =>
      (values ?? []).map((value) => value.trim()).filter(Boolean),
    ),
  env: z
    .record(z.string(), z.string())
    .nullish()
    .transform((value) => normalizeEnv(value ?? {})),
  cwd: z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    }),
  enabled: z.boolean().nullish().transform((value) => value ?? true),
  sortOrder: z.number().int().nullish().transform((value) => value ?? 0),
});

export type McpServerInput = z.infer<typeof McpServerSchema>;

export type McpServerTestResult =
  | {
      ok: true;
      elapsedMs: number;
      serverInfo?: {
        name?: string;
        title?: string;
        version?: string;
      };
      instructions?: string;
      tools: Array<{
        name: string;
        title?: string;
        description?: string;
      }>;
    }
  | {
      ok: false;
      elapsedMs: number;
      error: string;
    };

function normalizeEnv(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const key = rawKey.trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

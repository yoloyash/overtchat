import { z } from "zod";

const environmentNameSchema = z
  .string()
  .trim()
  .min(1, "Environment variable names cannot be empty")
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Environment variable names must contain only letters, numbers, and underscores",
  );

const stringMapSchema = z.record(z.string(), z.string());

function validateEnvironmentNames(
  value: Record<string, string>,
  ctx: z.RefinementCtx,
) {
  for (const key of Object.keys(value)) {
    const parsed = environmentNameSchema.safeParse(key);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: parsed.error.issues[0]?.message ?? "Invalid environment variable",
      });
    }
  }
}

function validateEnvironmentValues(
  value: Record<string, string>,
  ctx: z.RefinementCtx,
) {
  for (const [key, name] of Object.entries(value)) {
    const parsed = environmentNameSchema.safeParse(name);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message:
          parsed.error.issues[0]?.message ?? "Invalid environment variable",
      });
    }
  }
}

export const StdioMcpConfigSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().trim().min(1, "Command is required"),
  args: z.array(z.string()).default([]),
  env: stringMapSchema.superRefine(validateEnvironmentNames).default({}),
  envPassthrough: z.array(environmentNameSchema).default([]),
  cwd: z.string().trim().optional(),
});

export const StreamableHttpMcpConfigSchema = z.object({
  transport: z.literal("http"),
  url: z
    .url("Enter a valid Streamable HTTP URL")
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "Streamable HTTP URLs must use http or https",
    }),
  headers: stringMapSchema.default({}),
  envHeaders: stringMapSchema
    .superRefine(validateEnvironmentValues)
    .optional(),
  bearerTokenEnvVar: environmentNameSchema.optional(),
});

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
  StdioMcpConfigSchema,
  StreamableHttpMcpConfigSchema,
]);

export const MCP_SERVER_AVAILABILITIES = [
  "everyone",
  "admins",
  "disabled",
] as const;

export const McpServerAvailabilitySchema = z.enum(
  MCP_SERVER_AVAILABILITIES,
);

export const McpServerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  availability: McpServerAvailabilitySchema.default("everyone"),
  config: McpServerConfigSchema,
});

export const McpServerPreferenceInputSchema = z.object({
  enabled: z.boolean(),
});

export type StdioMcpConfig = z.infer<typeof StdioMcpConfigSchema>;
export type StreamableHttpMcpConfig = z.infer<
  typeof StreamableHttpMcpConfigSchema
>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpServerAvailability = z.infer<
  typeof McpServerAvailabilitySchema
>;
export type McpServerInput = z.infer<typeof McpServerInputSchema>;
export type McpServerPreferenceInput = z.infer<
  typeof McpServerPreferenceInputSchema
>;

export type McpServer = McpServerInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type AvailableMcpServer = {
  id: string;
  name: string;
  enabled: boolean;
};

export type McpServerHealth =
  | { ok: true; elapsedMs: number; toolCount: number }
  | { ok: false; elapsedMs: number; error: string };

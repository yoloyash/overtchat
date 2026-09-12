export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("@/lib/db/migrate");
  runMigrations();

  const { ensureServerCapabilityConfigs } = await import(
    "@/lib/db/serverCapabilities"
  );
  ensureServerCapabilityConfigs();

  const { sweepOrphanedUploads } = await import("@/lib/db/uploads");
  sweepOrphanedUploads().catch((err) =>
    console.error("[sweep-orphan-uploads]", err),
  );
}

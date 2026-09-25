import { APPLE_SPEECH_REVISION } from "./apple-speech.js";
import { CLI_VERSION } from "./constants.js";
import { components } from "./management.js";
import {
  applyReleaseManifest,
  compareVersions,
  type ReleaseManifest,
} from "./release.js";
import type { InstallationConfig } from "./types.js";

export function updatePlan(
  config: InstallationConfig,
  manifest: ReleaseManifest,
) {
  const next = applyReleaseManifest(config, manifest);
  const currentComponents = components(config);
  const nextComponents = components(next);
  const changes = currentComponents
    .filter((component) => component.id !== "speech")
    .map((component) => ({
      component: component.id,
      current: component.configured,
      available: nextComponents.find(
        (candidate) => candidate.id === component.id,
      )!.configured,
    }));
  changes.unshift({
    component: "cli",
    current: CLI_VERSION,
    available:
      compareVersions(manifest.cliVersion, CLI_VERSION) > 0
        ? manifest.cliVersion
        : CLI_VERSION,
  });
  return {
    changes,
    appleSpeech: currentComponents.some(
      (component) => component.id === "speech",
    )
      ? `Bundled with CLI (current revision ${APPLE_SPEECH_REVISION})`
      : undefined,
  };
}
export function printUpdatePlan(
  config: InstallationConfig,
  manifest: ReleaseManifest,
): void {
  const plan = updatePlan(config, manifest);
  for (const change of plan.changes)
    console.log(
      `${change.component}: ${change.current}${change.current === change.available ? " (current)" : ` → ${change.available}`}`,
    );
  if (plan.appleSpeech) console.log(`Apple speech: ${plan.appleSpeech}`);
}

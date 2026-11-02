import { readInstallationConfig, readInstallationSecrets } from "./config.js";
import { runtimePaths } from "./paths.js";
import { initialSetupLink } from "./initial-setup.js";
import { installationReport } from "./management.js";

export function providerStatus(provider: string): string {
  return provider === "disabled" ? "not configured" : provider;
}
export async function status(json = false): Promise<void> {
  const report = await installationReport();
  let setupUrl: string | null = null;
  if (report.managed) {
    const paths = runtimePaths();
    const config = await readInstallationConfig(paths);
    if (config) {
      try {
        const secrets = await readInstallationSecrets(paths);
        setupUrl = await initialSetupLink(config, secrets.managementSecret);
      } catch {
        report.problems.push("Could not retrieve account setup status. Check overtchat logs for the setup code if you have not created an account.");
      }
    }
  }
  if (json) {
    console.log(JSON.stringify({ ...report, setupUrl }, null, 2));
    return;
  }
  console.log(`OvertChat CLI ${report.cli}`);
  if (!report.managed) {
    console.log(
      "OvertChat is not managed on this machine. Run: overtchat setup",
    );
    return;
  }
  console.log(`URL: ${report.url}\nAccess: ${report.access ?? "custom"}`);
  if (setupUrl) console.log(`Create your administrator account: ${setupUrl}`);
  for (const component of report.components)
    console.log(
      `${component.id}: ${component.state} | running: ${component.running ?? "unknown"} | configured: ${component.configured}`,
    );
  for (const [name, provider] of Object.entries(report.providers ?? {}))
    console.log(`${name} provider: ${providerStatus(provider)}`);
  console.log(
    `Data: ${report.storage!.type} ${report.storage!.source}\nConfiguration: ${report.storage!.config}\nStack: ${report.storage!.stack}`,
  );
  for (const problem of report.problems) console.log(`Warning: ${problem}`);
  console.log("Troubleshoot: overtchat logs install --tail 100 | overtchat logs --follow");
}

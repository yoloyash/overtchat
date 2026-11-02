import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readInstallationConfig, readInstallationSecrets } from "./config.js";
import { initialSetupLink } from "./initial-setup.js";
import { installationReport } from "./management.js";
import { status } from "./status.js";

vi.mock("./config.js", () => ({ readInstallationConfig: vi.fn(), readInstallationSecrets: vi.fn() }));
vi.mock("./initial-setup.js", () => ({ initialSetupLink: vi.fn() }));
vi.mock("./management.js", () => ({ installationReport: vi.fn() }));
const link = "https://chat.example.com/signup#setup=ABCD-EFGH-JKMN";
let output: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(installationReport).mockResolvedValue({
    cli: "fixture", managed: true, url: "https://chat.example.com", access: "local",
    storage: { type: "volume", source: "data", config: "config", stack: "stack" },
    providers: { search: "disabled", tts: "disabled", stt: "disabled" }, components: [], problems: [],
  });
  vi.mocked(readInstallationConfig).mockResolvedValue({ publicUrl: "https://chat.example.com" } as NonNullable<Awaited<ReturnType<typeof readInstallationConfig>>>);
  vi.mocked(readInstallationSecrets).mockResolvedValue({ managementSecret: "test-secret" });
  vi.mocked(initialSetupLink).mockResolvedValue(link);
});
afterEach(() => vi.restoreAllMocks());
it("reprints the setup link in text and JSON status", async () => {
  await status();
  expect(output).toHaveBeenCalledWith(`Create your administrator account: ${link}`);
  output.mockClear();
  await status(true);
  expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ setupUrl: link });
});
it("stops printing a link once the server reports setup complete", async () => {
  vi.mocked(initialSetupLink).mockResolvedValue(null);
  await status();
  expect(output.mock.calls.flat().join("\n")).not.toContain("setup=");
});
it("still reports service status when setup retrieval is unavailable", async () => {
  vi.mocked(initialSetupLink).mockRejectedValue(new Error("offline"));
  await status();
  expect(output).toHaveBeenCalledWith(expect.stringContaining("Could not retrieve account setup status"));
});

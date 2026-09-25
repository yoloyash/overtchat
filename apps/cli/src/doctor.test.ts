import net from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { availablePort, doctor } from "./doctor.js";
import { installationReport, managedDocker } from "./management.js";
import { readInstallationConfig } from "./config.js";
import { dockerComposeAvailable } from "./docker.js";
vi.mock("./management.js", async (original) => ({
  ...(await original<typeof import("./management.js")>()),
  installationReport: vi.fn(),
  managedDocker: vi.fn(),
}));
vi.mock("./config.js", async (original) => ({
  ...(await original<typeof import("./config.js")>()),
  readInstallationConfig: vi.fn(),
}));
vi.mock("./docker.js", () => ({ dockerComposeAvailable: vi.fn() }));
afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
});
it("detects a port conflict before setup", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  try {
    expect(await availablePort(port, "127.0.0.1")).toBe(false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(await availablePort(port, "127.0.0.1")).toBe(true);
});
it("emits machine-readable failures and a failing exit status", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(installationReport).mockResolvedValue({
    cli: "0.3.2",
    managed: false,
    components: [],
    problems: [],
    url: undefined,
    access: undefined,
    storage: undefined,
    providers: undefined,
  });
  vi.mocked(managedDocker).mockRejectedValue(new Error("Start Docker Desktop"));
  vi.mocked(readInstallationConfig).mockResolvedValue(null);
  await doctor(true);
  const report = JSON.parse(vi.mocked(console.log).mock.calls[0]![0]);
  expect(report).toMatchObject({
    ok: false,
    checks: [
      { name: "Docker", ok: false, detail: "Start Docker Desktop" },
      { name: "Installation", ok: false },
    ],
  });
  expect(process.exitCode).toBe(1);
  expect(dockerComposeAvailable).not.toHaveBeenCalled();
});

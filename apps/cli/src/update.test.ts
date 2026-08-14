import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallationSecrets } from "./config.js";
import type { InstallationConfig, RuntimePaths } from "./types.js";

const mocks = vi.hoisted(() => ({
  detectDockerCommand: vi.fn(),
  dockerComposeAvailable: vi.fn(),
  installManagedConnector: vi.fn(),
  latestReleaseManifest: vi.fn(),
  outro: vi.fn(),
  prepareFiles: vi.fn(),
  readInstallationConfig: vi.fn(),
  readInstallationSecrets: vi.fn(),
  renderStackEnvironment: vi.fn(),
  requireDocker: vi.fn(),
  requireSuccessful: vi.fn(),
  spinnerMessage: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
  updateCliIfNeeded: vi.fn(),
  waitForApp: vi.fn(),
  writeInstallationConfig: vi.fn(),
  writeSecretsFile: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  outro: mocks.outro,
  spinner: () => ({
    message: mocks.spinnerMessage,
    start: mocks.spinnerStart,
    stop: mocks.spinnerStop,
  }),
}));

vi.mock("./config.js", () => ({
  readInstallationConfig: mocks.readInstallationConfig,
  readInstallationSecrets: mocks.readInstallationSecrets,
  writeInstallationConfig: mocks.writeInstallationConfig,
  writeSecretsFile: mocks.writeSecretsFile,
}));

vi.mock("./connector.js", () => ({
  installManagedConnector: mocks.installManagedConnector,
}));

vi.mock("./compose.js", () => ({
  renderStackEnvironment: mocks.renderStackEnvironment,
}));

vi.mock("./docker.js", () => ({
  detectDockerCommand: mocks.detectDockerCommand,
  dockerComposeAvailable: mocks.dockerComposeAvailable,
  requireDocker: mocks.requireDocker,
}));

const paths: RuntimePaths = {
  configDirectory: "/home/test/.config/overtchat",
  stateFile: "/home/test/.config/overtchat/config.json",
  secretsFile: "/home/test/.config/overtchat/secrets.env",
  stackDirectory: "/home/test/.local/share/overtchat",
  composeFile: "/home/test/.local/share/overtchat/compose.yml",
  searxngDirectory: "/home/test/.local/share/overtchat/searxng",
  searxngSettingsFile:
    "/home/test/.local/share/overtchat/searxng/settings.yml",
};

vi.mock("./paths.js", () => ({ runtimePaths: () => paths }));

vi.mock("./process.js", () => ({
  requireSuccessful: mocks.requireSuccessful,
}));

vi.mock("./release.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./release.js")>();
  return {
    ...original,
    latestReleaseManifest: mocks.latestReleaseManifest,
    updateCliIfNeeded: mocks.updateCliIfNeeded,
  };
});

vi.mock("./setup.js", () => ({
  prepareFiles: mocks.prepareFiles,
  waitForApp: mocks.waitForApp,
}));

import { update } from "./update.js";

function config(
  overrides: Partial<InstallationConfig> = {},
): InstallationConfig {
  return {
    format: 1,
    appVersion: "0.14.0",
    appImage: "ghcr.io/yoloyash/overtchat-app:0.14.0",
    connectorVersion: "0.4.0",
    sttVersion: "0.1.0",
    appPort: 4718,
    bindAddress: "127.0.0.1",
    publicUrl: "https://chat.example.com",
    extraTrustedOrigins: [],
    connectorServerUrl: "http://127.0.0.1:4718",
    composeProject: "overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat-data",
    search: { provider: "bundled", bundledInstalled: true },
    tts: { provider: "bundled", bundledInstalled: true },
    stt: { provider: "disabled", bundledInstalled: false },
    agents: { installed: false },
    ...overrides,
  };
}

const secrets: InstallationSecrets = {
  betterAuthSecret: "better-auth-secret",
  managementSecret: "management-secret",
  searxngSecret: "searxng-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readInstallationConfig.mockResolvedValue(config());
  mocks.detectDockerCommand.mockResolvedValue("docker");
  mocks.dockerComposeAvailable.mockResolvedValue(true);
  mocks.readInstallationSecrets.mockResolvedValue(secrets);
  mocks.latestReleaseManifest.mockResolvedValue({
    format: 1,
    cliVersion: "0.1.0",
    appVersion: "0.14.0",
    connectorVersion: "0.4.0",
    sttVersion: "0.1.0",
  });
  mocks.updateCliIfNeeded.mockResolvedValue(null);
  mocks.renderStackEnvironment.mockReturnValue("rendered environment\n");
  mocks.requireDocker.mockResolvedValue({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
  mocks.requireSuccessful.mockResolvedValue({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
});

describe("managed updates", () => {
  it("rejects installations that have not been managed by setup", async () => {
    mocks.readInstallationConfig.mockResolvedValue(null);

    await expect(update()).rejects.toThrow(
      "OvertChat is not managed yet. Run overtchat setup first.",
    );
    expect(mocks.detectDockerCommand).not.toHaveBeenCalled();
  });

  it("rejects incomplete managed secrets before changing files", async () => {
    mocks.readInstallationSecrets.mockResolvedValue({
      betterAuthSecret: "better-auth-secret",
    });

    await expect(update()).rejects.toThrow(
      "The managed installation secrets are incomplete",
    );
    expect(mocks.prepareFiles).not.toHaveBeenCalled();
    expect(mocks.requireDocker).not.toHaveBeenCalled();
  });

  it("refreshes a current installation without changing its versions", async () => {
    const current = config();
    mocks.readInstallationConfig.mockResolvedValue(current);

    await update();

    expect(mocks.prepareFiles).toHaveBeenCalledWith(current, undefined);
    expect(mocks.writeSecretsFile).toHaveBeenCalledWith(
      paths,
      "rendered environment\n",
    );
    expect(mocks.requireDocker).toHaveBeenNthCalledWith(
      1,
      "docker",
      [
        "compose",
        "--env-file",
        paths.secretsFile,
        "-f",
        paths.composeFile,
        "pull",
      ],
      { inherit: true },
    );
    expect(mocks.requireDocker).toHaveBeenNthCalledWith(
      2,
      "docker",
      [
        "compose",
        "--env-file",
        paths.secretsFile,
        "-f",
        paths.composeFile,
        "up",
        "-d",
      ],
      { inherit: true },
    );
    expect(mocks.waitForApp).toHaveBeenCalledWith("http://127.0.0.1:4718");
    expect(mocks.installManagedConnector).not.toHaveBeenCalled();
    expect(mocks.writeInstallationConfig).toHaveBeenCalledWith(paths, current);
    expect(mocks.outro).toHaveBeenCalledWith("Open: https://chat.example.com");
  });

  it("updates every component without downgrading newer local versions", async () => {
    const current = config({
      appVersion: "0.13.9",
      appImage: "ghcr.io/yoloyash/overtchat-app:0.13.9",
      connectorVersion: "0.5.0",
      sttVersion: "0.0.9",
      agents: { installed: true },
    });
    mocks.readInstallationConfig.mockResolvedValue(current);
    mocks.latestReleaseManifest.mockResolvedValue({
      format: 1,
      cliVersion: "0.1.0",
      appVersion: "0.14.0",
      connectorVersion: "0.4.0",
      sttVersion: "0.1.0",
    });

    await update();

    const expected = {
      ...current,
      appVersion: "0.14.0",
      appImage: "ghcr.io/yoloyash/overtchat-app:0.14.0",
      connectorVersion: "0.5.0",
      sttVersion: "0.1.0",
    };
    expect(mocks.prepareFiles).toHaveBeenCalledWith(expected, undefined);
    expect(mocks.installManagedConnector).toHaveBeenCalledWith(
      expected,
      "management-secret",
    );
    expect(mocks.writeInstallationConfig).toHaveBeenCalledWith(paths, expected);
    expect(
      mocks.waitForApp.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.installManagedConnector.mock.invocationCallOrder[0]!);
    expect(
      mocks.installManagedConnector.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.writeInstallationConfig.mock.invocationCallOrder[0]!);
  });

  it("hands control to an updated CLI before touching the stack", async () => {
    mocks.updateCliIfNeeded.mockResolvedValue("/home/test/.local/bin/overtchat");

    await update();

    expect(mocks.requireSuccessful).toHaveBeenCalledWith(
      "/home/test/.local/bin/overtchat",
      ["update"],
      { inherit: true },
    );
    expect(mocks.prepareFiles).not.toHaveBeenCalled();
    expect(mocks.requireDocker).not.toHaveBeenCalled();
    expect(mocks.writeInstallationConfig).not.toHaveBeenCalled();
  });

  it("does not commit state or replace the connector when pulling fails", async () => {
    mocks.readInstallationConfig.mockResolvedValue(
      config({
        appVersion: "0.13.9",
        appImage: "ghcr.io/yoloyash/overtchat-app:0.13.9",
        agents: { installed: true },
      }),
    );
    mocks.latestReleaseManifest.mockResolvedValue({
      format: 1,
      cliVersion: "0.1.0",
      appVersion: "0.14.0",
      connectorVersion: "0.4.0",
      sttVersion: "0.1.0",
    });
    mocks.requireDocker.mockRejectedValueOnce(new Error("pull failed"));

    await expect(update()).rejects.toThrow("pull failed");

    expect(mocks.requireDocker).toHaveBeenCalledTimes(1);
    expect(mocks.waitForApp).not.toHaveBeenCalled();
    expect(mocks.installManagedConnector).not.toHaveBeenCalled();
    expect(mocks.writeInstallationConfig).not.toHaveBeenCalled();
    expect(mocks.spinnerStop).toHaveBeenCalledWith(
      "OvertChat update failed",
      1,
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallationSecrets } from "./config.js";
import type { InstallationConfig, RuntimePaths } from "./types.js";

const mocks = vi.hoisted(() => ({
  detectDockerCommand: vi.fn(),
  dockerComposeAvailable: vi.fn(),
  installManagedConnector: vi.fn(),
  initialSecrets: vi.fn(),
  latestReleaseManifest: vi.fn(),
  outro: vi.fn(),
  prepareFiles: vi.fn(),
  readInstallationConfig: vi.fn(),
  readInstallationSecrets: vi.fn(),
  reconcileManagedSidecars: vi.fn(),
  renderStackEnvironment: vi.fn(),
  requireDocker: vi.fn(),
  requireSuccessful: vi.fn(),
  spinnerMessage: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
  showSidecarReconciliation: vi.fn(),
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

vi.mock("./config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./config.js")>();
  return {
    ...original,
    initialSecrets: mocks.initialSecrets,
    readInstallationConfig: mocks.readInstallationConfig,
    readInstallationSecrets: mocks.readInstallationSecrets,
    writeInstallationConfig: mocks.writeInstallationConfig,
    writeSecretsFile: mocks.writeSecretsFile,
  };
});

vi.mock("./connector.js", () => ({
  installManagedConnector: mocks.installManagedConnector,
}));

vi.mock("./compose.js", () => ({
  renderStackEnvironment: mocks.renderStackEnvironment,
}));

vi.mock("./docker.js", () => ({
  detectDockerCommand: mocks.detectDockerCommand,
  dockerComposeAvailable: mocks.dockerComposeAvailable,
  reconcileManagedSidecars: mocks.reconcileManagedSidecars,
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
  showSidecarReconciliation: mocks.showSidecarReconciliation,
  waitForApp: mocks.waitForApp,
}));

import { update } from "./update.js";

const releaseImages = {
  redisImage: `docker.io/library/redis@sha256:${"a".repeat(64)}`,
  searxngImage: `docker.io/searxng/searxng@sha256:${"b".repeat(64)}`,
  kokoroImage: `ghcr.io/remsky/kokoro-fastapi-cpu@sha256:${"c".repeat(64)}`,
  kokoroGpuImage: `ghcr.io/remsky/kokoro-fastapi-gpu@sha256:${"d".repeat(64)}`,
  kokoroGpuBlackwellImage: `ghcr.io/remsky/kokoro-fastapi-gpu@sha256:${"e".repeat(64)}`,
};

function config(
  overrides: Partial<InstallationConfig> = {},
): InstallationConfig {
  return {
    format: 1,
    appVersion: "0.14.0",
    appImage: "ghcr.io/yoloyash/overtchat-app:0.14.0",
    voiceVersion: "0.1.0",
    voiceImage: "ghcr.io/yoloyash/overtchat-voice:0.1.0",
    connectorVersion: "0.4.0",
    sttVersion: "0.1.0",
    ...releaseImages,
    appPort: 4718,
    bindAddress: "127.0.0.1",
    publicUrl: "https://chat.example.com",
    extraTrustedOrigins: [],
    connectorServerUrl: "http://127.0.0.1:4718",
    composeProject: "overtchat",
    dataMountType: "volume",
    dataVolume: "overtchat-data",
    search: { provider: "bundled", bundledInstalled: true },
    tts: {
      provider: "bundled",
      bundledInstalled: true,
      accelerator: "cpu",
    },
    stt: { provider: "disabled", bundledInstalled: false },
    voice: { installed: false },
    agents: { installed: false },
    ...overrides,
  };
}

const secrets: InstallationSecrets = {
  betterAuthSecret: "better-auth-secret",
  managementSecret: "management-secret",
  searxngSecret: "searxng-secret",
  voiceSharedSecret: "voice-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readInstallationConfig.mockResolvedValue(config());
  mocks.detectDockerCommand.mockResolvedValue("docker");
  mocks.dockerComposeAvailable.mockResolvedValue(true);
  mocks.readInstallationSecrets.mockResolvedValue(secrets);
  mocks.initialSecrets.mockImplementation(
    (_existing: null, previous: Partial<InstallationSecrets>) => ({
      ...previous,
      voiceSharedSecret: previous.voiceSharedSecret ?? "generated-voice-secret",
    }),
  );
  mocks.latestReleaseManifest.mockResolvedValue({
    format: 1,
    cliVersion: "0.1.1",
    appVersion: "0.14.0",
    voiceVersion: "0.1.0",
    connectorVersion: "0.4.0",
    sttVersion: "0.1.0",
    ...releaseImages,
  });
  mocks.updateCliIfNeeded.mockResolvedValue(null);
  mocks.renderStackEnvironment.mockReturnValue("rendered environment\n");
  mocks.reconcileManagedSidecars.mockResolvedValue({
    removed: [],
    warnings: [],
  });
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

  it("adds the voice secret when upgrading an older managed installation", async () => {
    const legacySecrets = {
      betterAuthSecret: secrets.betterAuthSecret,
      managementSecret: secrets.managementSecret,
      searxngSecret: secrets.searxngSecret,
    };
    mocks.readInstallationSecrets.mockResolvedValue(legacySecrets);

    await update();

    expect(mocks.initialSecrets).toHaveBeenCalledWith(null, legacySecrets);
    expect(mocks.renderStackEnvironment).toHaveBeenCalledWith(
      expect.anything(),
      { ...legacySecrets, voiceSharedSecret: "generated-voice-secret" },
      paths,
    );
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
    expect(mocks.reconcileManagedSidecars).toHaveBeenCalledWith(
      "docker",
      current,
    );
    expect(mocks.showSidecarReconciliation).toHaveBeenCalledWith({
      removed: [],
      warnings: [],
    });
    expect(
      mocks.waitForApp.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.reconcileManagedSidecars.mock.invocationCallOrder[0]!);
    expect(mocks.outro).toHaveBeenCalledWith("Open: https://chat.example.com");
  });

  it("repairs stale provider state before pulling update images", async () => {
    const stale = config({
      search: { provider: "brave", bundledInstalled: true },
      tts: {
        provider: "openai-compatible",
        bundledInstalled: true,
        baseUrl: "http://tts.example.com",
        accelerator: "gpu",
        gpuUuid: "GPU-tts",
        gpuVariant: "blackwell",
      },
      stt: {
        provider: "disabled",
        bundledInstalled: true,
        accelerator: "gpu",
        gpuUuid: "GPU-stt",
      },
      voice: { installed: true },
    });
    mocks.readInstallationConfig.mockResolvedValue(stale);

    await update();

    const repaired = {
      ...stale,
      search: { provider: "brave", bundledInstalled: false },
      tts: {
        provider: "openai-compatible",
        bundledInstalled: false,
        baseUrl: "http://tts.example.com",
      },
      stt: { provider: "disabled", bundledInstalled: false },
      voice: { installed: false },
    };
    expect(mocks.prepareFiles).toHaveBeenCalledWith(repaired, undefined);
    expect(mocks.renderStackEnvironment).toHaveBeenCalledWith(
      repaired,
      secrets,
      paths,
    );
    expect(mocks.writeInstallationConfig).toHaveBeenCalledWith(paths, repaired);
    expect(mocks.reconcileManagedSidecars).toHaveBeenCalledWith(
      "docker",
      repaired,
    );
  });

  it("updates every component without downgrading newer local versions", async () => {
    const current = config({
      appVersion: "0.13.9",
      appImage: "ghcr.io/yoloyash/overtchat-app:0.13.9",
      voiceVersion: "0.3.0",
      voiceImage: "ghcr.io/yoloyash/overtchat-voice:0.3.0",
      connectorVersion: "0.5.0",
      sttVersion: "0.0.9",
      agents: { installed: true },
    });
    mocks.readInstallationConfig.mockResolvedValue(current);
    mocks.latestReleaseManifest.mockResolvedValue({
      format: 1,
      cliVersion: "0.1.1",
      appVersion: "0.14.0",
      voiceVersion: "0.2.0",
      connectorVersion: "0.4.0",
      sttVersion: "0.1.0",
      ...releaseImages,
    });

    await update();

    const expected = {
      ...current,
      appVersion: "0.14.0",
      appImage: "ghcr.io/yoloyash/overtchat-app:0.14.0",
      voiceVersion: "0.3.0",
      voiceImage: "ghcr.io/yoloyash/overtchat-voice:0.3.0",
      connectorVersion: "0.5.0",
      sttVersion: "0.1.0",
      ...releaseImages,
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
    expect(
      mocks.writeInstallationConfig.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.reconcileManagedSidecars.mock.invocationCallOrder[0]!);
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
      cliVersion: "0.1.1",
      appVersion: "0.14.0",
      voiceVersion: "0.1.0",
      connectorVersion: "0.4.0",
      sttVersion: "0.1.0",
      ...releaseImages,
    });
    mocks.requireDocker.mockRejectedValueOnce(new Error("pull failed"));

    await expect(update()).rejects.toThrow("pull failed");

    expect(mocks.requireDocker).toHaveBeenCalledTimes(1);
    expect(mocks.waitForApp).not.toHaveBeenCalled();
    expect(mocks.installManagedConnector).not.toHaveBeenCalled();
    expect(mocks.reconcileManagedSidecars).not.toHaveBeenCalled();
    expect(mocks.writeInstallationConfig).not.toHaveBeenCalled();
    expect(mocks.spinnerStop).toHaveBeenCalledWith(
      "OvertChat update failed",
      1,
    );
  });

  it("does not remove old sidecars when the replacement app is unhealthy", async () => {
    mocks.waitForApp.mockRejectedValueOnce(new Error("app unhealthy"));

    await expect(update()).rejects.toThrow("app unhealthy");

    expect(mocks.writeInstallationConfig).not.toHaveBeenCalled();
    expect(mocks.reconcileManagedSidecars).not.toHaveBeenCalled();
    expect(mocks.spinnerStop).toHaveBeenCalledWith(
      "OvertChat update failed",
      1,
    );
  });
});

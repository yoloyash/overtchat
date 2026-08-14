import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function writeExecutable(filePath: string, contents: string) {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function createUpgradeFixture(
  newServiceBehavior: "stable" | "inactive" | "active-once",
  options: {
    binaryBackupExists?: boolean;
    effectiveExecStart?: "managed" | "custom";
    preflightFails?: boolean;
    signalAfterStop?: boolean;
    stopFails?: boolean;
    stateExists?: boolean;
  } = {},
) {
  const fixtureDirectory = mkdtempSync(
    path.join(os.tmpdir(), "overtchat-installer-test-"),
  );
  temporaryDirectories.push(fixtureDirectory);

  const homeDirectory = path.join(fixtureDirectory, "home");
  const mockBinDirectory = path.join(fixtureDirectory, "bin");
  const systemctlCalls = path.join(fixtureDirectory, "systemctl-calls");
  const systemctlStarts = path.join(fixtureDirectory, "systemctl-starts");
  const systemctlServiceState = path.join(
    fixtureDirectory,
    "systemctl-service-state",
  );
  const systemctlActiveChecks = path.join(
    fixtureDirectory,
    "systemctl-active-checks",
  );
  const installDirectory = path.join(homeDirectory, ".local/bin");
  const installPath = path.join(installDirectory, "overtchat-connector");
  const configPath = path.join(
    homeDirectory,
    ".config/overtchat/connector.json",
  );
  const statePath = path.join(
    homeDirectory,
    ".config/overtchat",
    "connector-connector-test.state.json",
  );
  const configContents = `${JSON.stringify(
    {
      serverUrl: "https://chat.example.com",
      connectorId: "connector-test",
      token: "pairing-token",
    },
    null,
    2,
  )}\n`;
  const legacyState = '{"format":1,"connectorEpoch":"legacy-state"}\n';
  mkdirSync(path.join(homeDirectory, ".config/overtchat"), { recursive: true });
  mkdirSync(installDirectory, { recursive: true });
  mkdirSync(mockBinDirectory);
  writeFileSync(configPath, configContents, { mode: 0o600 });
  writeFileSync(systemctlServiceState, "active\n");
  if (options.stateExists !== false) {
    writeFileSync(statePath, legacyState, { mode: 0o640 });
    chmodSync(statePath, 0o640);
  }
  writeFileSync(installPath, "old connector\n", { mode: 0o755 });
  if (options.binaryBackupExists === true) {
    writeFileSync(`${installPath}.previous`, "interrupted backup\n", {
      mode: 0o755,
    });
  }

  const newConnector = `#!/bin/sh
if [ "\${1:-}" = "preflight" ]; then
  printf '{"format":2,"migrated":true}\\n' > "$MOCK_CONNECTOR_STATE"
  chmod 600 "$MOCK_CONNECTOR_STATE"
  [ "$MOCK_PREFLIGHT_FAILS" != "true" ] || exit 1
fi
exit 0
`;
  const checksum = createHash("sha256").update(newConnector).digest("hex");

  writeExecutable(
    path.join(mockBinDirectory, "uname"),
    `#!/bin/sh
if [ "\${1:-}" = "-s" ]; then
  echo Linux
else
  echo x86_64
fi
`,
  );
  writeExecutable(
    path.join(mockBinDirectory, "curl"),
    `#!/bin/sh
set -eu
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -fsSLo)
      output=$2
      shift 2
      ;;
    *)
      url=$1
      shift
      ;;
  esac
done
case "$url" in
  */connector-checksums.txt)
    printf '%s  overtchat-connector-linux-amd64\\n' "$MOCK_ASSET_SHA256" > "$output"
    ;;
  *)
    cat > "$output" <<'MOCK_CONNECTOR'
${newConnector}MOCK_CONNECTOR
    ;;
esac
`,
  );
  writeExecutable(
    path.join(mockBinDirectory, "systemctl"),
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$MOCK_SYSTEMCTL_CALLS"
case "\${2:-}" in
  cat)
    printf '%s\\n' 'ExecStart="'"$HOME"'/.local/bin/overtchat-connector" "run"'
    exit 0
    ;;
  show)
    if [ "$MOCK_EFFECTIVE_EXEC_START" = "managed" ]; then
      printf '{ path=%s/.local/bin/overtchat-connector ; argv[]=%s/.local/bin/overtchat-connector run ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n' "$HOME" "$HOME"
    else
      printf '{ path=/tmp/custom-connector ; argv[]=/tmp/custom-connector run ; }\\n'
    fi
    exit 0
    ;;
  show-environment)
    exit 0
    ;;
  stop)
    [ "$MOCK_STOP_FAILS" != "true" ] || exit 1
    printf 'inactive\\n' > "$MOCK_SYSTEMCTL_SERVICE_STATE"
    if [ "$(cat "$MOCK_SIGNAL_AFTER_STOP_FILE")" = "true" ]; then
      printf 'false\\n' > "$MOCK_SIGNAL_AFTER_STOP_FILE"
      kill -TERM "$PPID"
    fi
    exit 0
    ;;
  start)
    printf 'active\\n' > "$MOCK_SYSTEMCTL_SERVICE_STATE"
    printf '0\\n' > "$MOCK_SYSTEMCTL_ACTIVE_CHECKS"
    printf 'start\\n' >> "$MOCK_SYSTEMCTL_STARTS"
    start_count=$(wc -l < "$MOCK_SYSTEMCTL_STARTS")
    exit 0
    ;;
  is-active)
    [ "$(cat "$MOCK_SYSTEMCTL_SERVICE_STATE")" = "active" ] || exit 3
    if [ -f "$MOCK_SYSTEMCTL_STARTS" ]; then
      start_count=$(wc -l < "$MOCK_SYSTEMCTL_STARTS")
    else
      start_count=0
    fi
    active_checks=$(cat "$MOCK_SYSTEMCTL_ACTIVE_CHECKS")
    active_checks=$((active_checks + 1))
    printf '%s\\n' "$active_checks" > "$MOCK_SYSTEMCTL_ACTIVE_CHECKS"
    if [ "$start_count" -eq 1 ]; then
      case "$MOCK_NEW_SERVICE_BEHAVIOR" in
        inactive)
          exit 3
          ;;
        active-once)
          [ "$active_checks" -eq 1 ] && exit 0
          exit 3
          ;;
      esac
    fi
    exit 0
    ;;
esac
exit 1
`,
  );
  writeExecutable(path.join(mockBinDirectory, "sleep"), "#!/bin/sh\nexit 0\n");

  const installer = path.resolve(
    process.cwd(),
    "../../scripts/install-connector.sh",
  );
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDirectory,
    MOCK_ASSET_SHA256: checksum,
    MOCK_CONNECTOR_STATE: statePath,
    MOCK_EFFECTIVE_EXEC_START: options.effectiveExecStart ?? "managed",
    MOCK_NEW_SERVICE_BEHAVIOR: newServiceBehavior,
    MOCK_PREFLIGHT_FAILS: String(options.preflightFails === true),
    MOCK_SIGNAL_AFTER_STOP: String(options.signalAfterStop === true),
    MOCK_SIGNAL_AFTER_STOP_FILE: path.join(
      fixtureDirectory,
      "signal-after-stop",
    ),
    MOCK_SYSTEMCTL_ACTIVE_CHECKS: systemctlActiveChecks,
    MOCK_SYSTEMCTL_CALLS: systemctlCalls,
    MOCK_SYSTEMCTL_SERVICE_STATE: systemctlServiceState,
    MOCK_SYSTEMCTL_STARTS: systemctlStarts,
    MOCK_STOP_FAILS: String(options.stopFails === true),
    PATH: `${mockBinDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  };
  writeFileSync(
    environment.MOCK_SIGNAL_AFTER_STOP_FILE!,
    String(options.signalAfterStop === true),
  );
  delete environment.OVERTCHAT_CONNECTOR_CONFIG;
  delete environment.OVERTCHAT_CONNECTOR_STATE;
  const result = spawnSync("/bin/sh", [installer, "--upgrade"], {
    encoding: "utf8",
    env: environment,
    timeout: 5_000,
  });

  return {
    configContents,
    configPath,
    installPath,
    legacyState,
    newConnector,
    result,
    statePath,
    systemctlCalls,
    systemctlServiceState,
  };
}

describe("Host Connector installer redirect", () => {
  it("keeps generated commands pinned to an immutable connector release", () => {
    const redirects = readFileSync(
      path.join(process.cwd(), "public/_redirects"),
      "utf8",
    );
    const installer = readFileSync(
      path.resolve(process.cwd(), "../../scripts/install-connector.sh"),
      "utf8",
    );
    const packageMetadata = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), "../connector/package.json"),
        "utf8",
      ),
    ) as { version: string };

    expect(redirects).toContain(
      `/install/connector/${packageMetadata.version} https://github.com/yoloyash/overtchat/releases/download/connector-v${packageMetadata.version}/install-connector.sh 302`,
    );
    expect(redirects).toContain(
      `/install-connector.sh /install/connector/${packageMetadata.version} 302`,
    );
    expect(installer).toContain(
      `connector_version="${packageMetadata.version}"`,
    );
  });

  it("atomically upgrades and preserves the previous executable", () => {
    const packageMetadata = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), "../connector/package.json"),
        "utf8",
      ),
    ) as { version: string };
    const {
      configContents,
      configPath,
      installPath,
      newConnector,
      result,
      statePath,
      systemctlCalls,
    } = createUpgradeFixture("stable");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `Host Connector upgraded to ${packageMetadata.version}`,
    );
    expect(readFileSync(installPath, "utf8")).toBe(newConnector);
    expect(existsSync(`${installPath}.previous`)).toBe(false);
    expect(readFileSync(systemctlCalls, "utf8")).toContain(
      "--user is-active --quiet overtchat-connector.service",
    );
    expect(readFileSync(statePath, "utf8")).toBe(
      '{"format":2,"migrated":true}\n',
    );
    expect(existsSync(`${statePath}.previous`)).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(configContents);
  });

  it("restores and restarts the previous executable when startup fails", () => {
    const {
      configContents,
      configPath,
      installPath,
      legacyState,
      result,
      statePath,
      systemctlCalls,
    } = createUpgradeFixture("inactive");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("did not start");
    expect(result.stderr).toContain("state were restored and restarted");
    expect(readFileSync(installPath, "utf8")).toBe("old connector\n");
    expect(existsSync(`${installPath}.previous`)).toBe(false);
    expect(readFileSync(statePath, "utf8")).toBe(legacyState);
    expect(statSync(statePath).mode & 0o777).toBe(0o640);
    expect(existsSync(`${statePath}.previous`)).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(configContents);
    expect(
      readFileSync(systemctlCalls, "utf8")
        .split("\n")
        .filter((call) =>
          call.includes("--user start overtchat-connector.service"),
        ),
    ).toHaveLength(2);
  });

  it("rolls back when the upgraded service is active only once", () => {
    const {
      installPath,
      legacyState,
      result,
      statePath,
      systemctlCalls,
    } = createUpgradeFixture("active-once");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("did not start");
    expect(result.stderr).toContain("state were restored and restarted");
    expect(readFileSync(installPath, "utf8")).toBe("old connector\n");
    expect(readFileSync(statePath, "utf8")).toBe(legacyState);
    expect(statSync(statePath).mode & 0o777).toBe(0o640);
    expect(
      readFileSync(systemctlCalls, "utf8")
        .split("\n")
        .filter((call) =>
          call.includes("--user start overtchat-connector.service"),
        ),
    ).toHaveLength(2);
  });

  it("removes newly created state on rollback when no old state existed", () => {
    const { installPath, result, statePath } = createUpgradeFixture(
      "active-once",
      { stateExists: false },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("state were restored and restarted");
    expect(readFileSync(installPath, "utf8")).toBe("old connector\n");
    expect(existsSync(statePath)).toBe(false);
    expect(existsSync(`${statePath}.previous`)).toBe(false);
  });

  it("restores the old service when stopped preflight fails", () => {
    const {
      installPath,
      legacyState,
      result,
      statePath,
      systemctlCalls,
    } = createUpgradeFixture("stable", { preflightFails: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not safely open");
    expect(result.stderr).toContain("state were restored and restarted");
    expect(readFileSync(installPath, "utf8")).toBe("old connector\n");
    expect(readFileSync(statePath, "utf8")).toBe(legacyState);
    expect(statSync(statePath).mode & 0o777).toBe(0o640);
    expect(
      readFileSync(systemctlCalls, "utf8")
        .split("\n")
        .filter((call) =>
          call.includes("--user start overtchat-connector.service"),
        ),
    ).toHaveLength(1);
  });

  it("refuses to upgrade a service with a custom effective command", () => {
    const { installPath, legacyState, result, statePath, systemctlCalls } =
      createUpgradeFixture("stable", { effectiveExecStart: "custom" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("effective command is not installer-managed");
    expect(readFileSync(installPath, "utf8")).toBe("old connector\n");
    expect(readFileSync(statePath, "utf8")).toBe(legacyState);
    expect(readFileSync(systemctlCalls, "utf8")).not.toContain("--user stop");
  });

  it("keeps the old service running when the initial stop fails", () => {
    const {
      installPath,
      legacyState,
      result,
      statePath,
      systemctlCalls,
      systemctlServiceState,
    } = createUpgradeFixture("stable", { stopFails: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nothing was upgraded");
    expect(readFileSync(installPath, "utf8")).toBe("old connector\n");
    expect(readFileSync(statePath, "utf8")).toBe(legacyState);
    expect(readFileSync(systemctlServiceState, "utf8")).toBe("active\n");
    expect(
      readFileSync(systemctlCalls, "utf8")
        .split("\n")
        .filter((call) =>
          call.includes("--user start overtchat-connector.service"),
        ),
    ).toHaveLength(1);
  });

  it("restarts the old service when interrupted immediately after stop", () => {
    const {
      installPath,
      legacyState,
      result,
      statePath,
      systemctlCalls,
      systemctlServiceState,
    } = createUpgradeFixture("stable", { signalAfterStop: true });

    expect(result.status).not.toBe(0);
    expect(readFileSync(installPath, "utf8")).toBe("old connector\n");
    expect(readFileSync(statePath, "utf8")).toBe(legacyState);
    expect(readFileSync(systemctlServiceState, "utf8")).toBe("active\n");
    expect(
      readFileSync(systemctlCalls, "utf8")
        .split("\n")
        .filter((call) =>
          call.includes("--user start overtchat-connector.service"),
        ),
    ).toHaveLength(1);
  });

  it("preserves evidence from an interrupted earlier upgrade", () => {
    const { installPath, result, systemctlCalls } = createUpgradeFixture(
      "stable",
      { binaryBackupExists: true },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("binary rollback file already exists");
    expect(readFileSync(installPath, "utf8")).toBe("old connector\n");
    expect(readFileSync(`${installPath}.previous`, "utf8")).toBe(
      "interrupted backup\n",
    );
    expect(readFileSync(systemctlCalls, "utf8")).not.toContain("--user stop");
  });
});

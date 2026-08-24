import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

describe("Managed installer", () => {
  it("falls back cleanly when the process has no controlling terminal", () => {
    const fixtureDirectory = mkdtempSync(
      path.join(os.tmpdir(), "overtchat-managed-installer-test-"),
    );
    temporaryDirectories.push(fixtureDirectory);

    const homeDirectory = path.join(fixtureDirectory, "home");
    const mockBinDirectory = path.join(fixtureDirectory, "bin");
    mkdirSync(homeDirectory);
    mkdirSync(mockBinDirectory);

    const mockCli = `#!/bin/sh
if [ "\${1:-}" = "setup" ]; then
  echo "setup must not run without a controlling terminal" >&2
  exit 42
fi
exit 0
`;
    const checksum = createHash("sha256").update(mockCli).digest("hex");

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
  */overtchat-checksums.txt)
    printf '%s  overtchat-linux-amd64\\n' "$MOCK_ASSET_SHA256" > "$output"
    ;;
  *)
    cat > "$output" <<'MOCK_CLI'
${mockCli}MOCK_CLI
    ;;
esac
`,
    );

    const installer = path.join(process.cwd(), "public/install");
    const result = spawnSync("/bin/sh", [installer], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDirectory,
        MOCK_ASSET_SHA256: checksum,
        PATH: `${mockBinDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
      timeout: 5_000,
    });
    const installPath = path.join(homeDirectory, ".local/bin/overtchat");

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("/dev/tty");
    expect(result.stdout).toContain(
      `Run ${installPath} setup in an interactive terminal to finish.`,
    );
    expect(existsSync(installPath)).toBe(true);
    expect(readFileSync(installPath, "utf8")).toBe(mockCli);
  });
});

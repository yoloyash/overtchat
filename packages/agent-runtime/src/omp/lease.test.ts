import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";
import { probeOmpSessionLease } from "./lease";

const target = { transport: "local" } as const;
let root: string;

function fakeOmp(name: string, script: string): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return file;
}

beforeAll(() => {
  configureLocalTestProcessSpawner();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "overtchat-omp-lease-"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("OMP session lease probe", () => {
  it("reports a session another OMP process owns", async () => {
    const omp = fakeOmp(
      "held",
      'test "$1 $2 $3 $4" = "session lease --json --" || exit 2\nprintf \'{"held":["%s"],"unknown":[]}\' "$5"',
    );
    await expect(probeOmpSessionLease(target, omp, root, "abc", { heldRecheckDelayMs: 0 })).resolves.toBe("held");
  });

  it("lets a lease that is released during the grace period through", async () => {
    const marker = path.join(root, "released");
    const omp = fakeOmp(
      "releasing",
      `if [ -e "${marker}" ]; then printf '{"held":[],"unknown":[]}'; else touch "${marker}"; printf '{"held":["abc"],"unknown":[]}'; fi`,
    );
    await expect(probeOmpSessionLease(target, omp, root, "abc", { heldRecheckDelayMs: 0 })).resolves.toBe("free");
  });

  it("reports a free session", async () => {
    const omp = fakeOmp("free", "printf '{\"held\":[],\"unknown\":[]}'");
    await expect(probeOmpSessionLease(target, omp, root, "abc")).resolves.toBe("free");
  });

  it("treats an OMP without the lease command as unknown", async () => {
    const omp = fakeOmp("old", "echo 'Unknown action: lease' >&2\nexit 1");
    await expect(probeOmpSessionLease(target, omp, root, "abc")).resolves.toBe("unknown");
  });

  it("treats malformed output as unknown", async () => {
    const omp = fakeOmp("garbled", "echo 'not json'");
    await expect(probeOmpSessionLease(target, omp, root, "abc")).resolves.toBe("unknown");
  });
});

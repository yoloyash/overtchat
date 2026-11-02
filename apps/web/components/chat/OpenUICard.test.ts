import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const FLAG = 'Symbol.for("openui.devtools.autoMount")';

it("still opts out of the upstream development overlay", () => {
  const require = createRequire(import.meta.url);
  const upstream = readFileSync(require.resolve("@openuidev/react-lang"), "utf8");
  // Upstream mounts its remote-asset overlay in development unless this flag is set.
  expect(upstream).toContain(FLAG);
  expect(upstream).toMatch(/if \(!flags\[AUTO_MOUNT_FLAG\]\)/);
  expect(readFileSync(new URL("./OpenUICard.tsx", import.meta.url), "utf8")).toContain(FLAG);
});

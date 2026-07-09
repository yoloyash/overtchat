import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function appShellClasses() {
  const source = await readFile(
    path.join(webRoot, "components/AppShell.tsx"),
    "utf8",
  );
  return Array.from(source.matchAll(/className="([^"]+)"/g), (match) => match[1]);
}

describe("iOS PWA safe areas", () => {
  it("reserves the top safe area before app headers render", async () => {
    const classes = await appShellClasses();
    const appFrame = classes.find(
      (className) =>
        className.includes("h-dvh") && className.includes("bg-background"),
    );

    expect(appFrame).toContain("box-border");
    expect(appFrame).toContain("pt-[env(safe-area-inset-top)]");
  });

  it("keeps the mobile drawer controls below the top safe area", async () => {
    const classes = await appShellClasses();
    const mobileDrawer = classes.find(
      (className) =>
        className.includes("fixed") &&
        className.includes("left-0") &&
        className.includes("md:hidden"),
    );

    expect(mobileDrawer).toContain("box-border");
    expect(mobileDrawer).toContain("bg-sidebar");
    expect(mobileDrawer).toContain("pt-[env(safe-area-inset-top)]");
  });
});

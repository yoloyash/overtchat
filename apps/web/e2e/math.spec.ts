import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

test("styles inline and block math, fractions, and superscripts after reload", async ({
  page,
}, testInfo) => {
  resetE2eDatabase();
  await page.goto("/signup");
  await page.locator("#name").fill("Math Tester");
  await page.locator("#email").fill("math@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");

  const db = openE2eDatabase();
  try {
    const user = db.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
    db.prepare(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ('math-chat', ?, 'Math rendering', 1, 1)`,
    ).run(user.id);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, parts, created_at)
       VALUES ('math-message', 'math-chat', 'assistant', ?, 1)`,
    ).run(JSON.stringify([
      {
        type: "text",
        text: [
          "Inline $$x^2$$ stays beside this text.",
          "",
          "$$",
          "\\frac{1}{2} + x^2",
          "$$",
          "",
          "Invalid $$\\frac{1}$$ remains readable.",
          "",
          "```mermaid",
          "flowchart LR",
          'A["$$x^2 + \\frac{1}{2}$$"] --> B["Result"]',
          "```",
        ].join("\n"),
      },
    ]));
  } finally {
    db.close();
  }

  await page.goto("/chat/math-chat");
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await expect(page.locator(".katex")).toHaveCount(2);
      await expect(page.locator(".katex-display")).toHaveCount(1);
      await expect(page.locator(".katex-error")).toContainText("\\frac{1}");

      const inline = page.locator(".katex").first();
      const block = page.locator(".katex-display");
      await expect(inline).toBeVisible();
      await expect(block).toBeVisible();
      // Inspect applied layout, rather than merely checking for KaTeX markup.
      await expect(inline.locator(".katex-base")).toHaveCSS("position", "relative");
      await expect(inline.locator(".katex-strut")).toHaveCSS("display", "inline-block");
      await expect(block).toHaveCSS("display", "block");
      await expect(block.locator(".frac-line")).toHaveCSS("border-bottom-style", "solid");
      expect(
        await inline.locator(".msupsub .katex-sizing").evaluate((element) => {
          const base = element.closest(".katex")!;
          return (
            parseFloat(getComputedStyle(element).fontSize) <
            parseFloat(getComputedStyle(base).fontSize)
          );
        }),
      ).toBe(true);

      const fraction = block.locator(".mfrac");
      const numerator = await fraction.getByText("1", { exact: true }).boundingBox();
      const denominator = await fraction.getByText("2", { exact: true }).boundingBox();
      expect(numerator).not.toBeNull();
      expect(denominator).not.toBeNull();
      expect(numerator!.y + numerator!.height / 2).toBeLessThan(
        denominator!.y + denominator!.height / 2,
      );

      // Mermaid also consumes the override, and uses KaTeX's MathML output.
      const diagram = page.getByRole("img", { name: "Mermaid chart" });
      await expect(diagram).toBeVisible();
      await expect.poll(() => diagram.evaluate(async (element) => {
        const svg = await fetch((element as HTMLImageElement).src).then(
          (response) => response.text(),
        );
        return new DOMParser().parseFromString(svg, "image/svg+xml")
          .querySelectorAll("math").length;
      })).toBe(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`math-${viewport.width}.png`), fullPage: true });
  }
});

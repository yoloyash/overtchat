import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import { STREAMDOWN_PLUGINS } from "./markdown";

const require = createRequire(import.meta.url);
const stylesheet = readFileSync(
  require.resolve("katex/dist/katex.min.css"),
  "utf8",
);

function renderMath(markdown: string) {
  return parseHTML(
    renderToStaticMarkup(
      <Streamdown plugins={STREAMDOWN_PLUGINS} mode="static">
        {markdown}
      </Streamdown>,
    ),
  ).document;
}

describe("chat math rendering", () => {
  it("emits layout classes supported by the imported KaTeX stylesheet", () => {
    const document = renderMath("Inline $$x^2$$.\n\n$$\n\\frac{1}{2}\n$$");
    expect(document.querySelectorAll(".katex")).toHaveLength(2);
    expect(document.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(document.querySelector(".katex-error")).toBeNull();

    // These layout classes changed in KaTeX 0.18. A successful build does not
    // catch old renderer markup paired with a newer stylesheet.
    for (const selector of [
      ".katex-html > span",
      ".katex-html > span > span",
      ".msupsub .mtight",
    ]) {
      const element = document.querySelector(selector);
      expect(element).not.toBeNull();
      expect(
        [...element!.classList].some((name) =>
          stylesheet.includes(`.katex .${name}`),
        ),
      ).toBe(true);
    }
  });

  it("keeps invalid math source and the rest of the message readable", () => {
    const document = renderMath("$$\\frac{1}$$\n\nStill readable.");
    expect(document.querySelector(".katex-error")?.textContent).toContain(
      "\\frac{1}",
    );
    expect(document.querySelector("p:last-child")?.textContent).toContain("Still readable.");
  });

  it("uses the same patched KaTeX for the renderer and stylesheet", () => {
    const rendererRequire = createRequire(require.resolve("rehype-katex"));
    expect(rendererRequire.resolve("katex")).toBe(require.resolve("katex"));
    const katex = rendererRequire("katex");
    // GHSA-238p-pmpm-9mq7: inherited options must not enable trusted rendering.
    const html = katex.renderToString(
      "\\href{https://example.test}{untrusted link}",
      Object.create({ trust: true }),
    );
    expect(parseHTML(html).document.querySelector("a")).toBeNull();
  });
});

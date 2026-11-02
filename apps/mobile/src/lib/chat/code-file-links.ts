import { codeFileLinkName } from "@overtchat/shared";
import type { MarkdownItInstance, MarkdownItToken as Token } from "markdown-it";

function isFileLink(token: Token): boolean {
  return token.type === "link_open" && codeFileLinkName(token.attrGet("href") ?? "") !== null;
}

/**
 * Turns a paragraph of nothing but links to sandbox files into images, which
 * the renderer lays out as blocks: an image file shows in full and any other
 * file as a card. Links inside sentences stay inline.
 */
export function codeFileLinksPlugin(md: MarkdownItInstance) {
  md.core.ruler.after("inline", "code_file_links", (state) => {
    state.tokens.forEach((token, index) => {
      if (token.type !== "inline" || state.tokens[index - 1]?.type !== "paragraph_open") return;
      const children = token.children ?? [];
      const replaced: Token[] = [];
      let links = 0;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === "softbreak" || child.type === "hardbreak") continue;
        if (child.type === "text" && !child.content.trim()) continue;
        if (!isFileLink(child)) return;
        const close = children.findIndex((next, at) => at > i && next.type === "link_close");
        if (close < 0) return;
        const label = children.slice(i + 1, close);
        const image = new state.Token("image", "img", 0);
        image.attrs = [
          ["src", child.attrGet("href") ?? ""],
          ["alt", ""],
        ];
        image.children = label;
        image.content = label.map((part) => part.content).join("");
        replaced.push(image);
        links++;
        i = close;
      }
      if (links) token.children = replaced;
    });
  });
}

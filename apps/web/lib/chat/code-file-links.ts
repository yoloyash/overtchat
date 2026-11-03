import { codeFileLinkName } from "@overtchat/shared";
import type { Node } from "unist";
import type { Image, Link, Parent, PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";

/** Element a reply's link to a code run's file becomes. */
export const CODE_FILE_TAG = "code-file";

const CODE_FILE_NODE = "codeFile";

/** Lets the element and its attributes through Streamdown's sanitizer. */
export const CODE_FILE_ALLOWED_TAGS = { [CODE_FILE_TAG]: ["filename", "embed"] };

function isFileLink(node: Node): node is Link | Image {
  return (
    (node.type === "link" || node.type === "image") &&
    codeFileLinkName((node as Link | Image).url) !== null
  );
}

/** A paragraph of nothing but file links shows each file in full. */
function standsAlone(parent: Parent): boolean {
  return (
    parent.type === "paragraph" &&
    parent.children.every(
      (child) =>
        (child.type as string) === CODE_FILE_NODE ||
        isFileLink(child) ||
        child.type === "break" ||
        (child.type === "text" && !child.value.trim()),
    )
  );
}

/**
 * Turns the reply's links and images that name a sandbox file into
 * `code-file` elements; the renderer resolves the name against the files
 * the conversation's runs returned. Images and links on a line of their own
 * embed the file; a link inside a sentence stays a link.
 */
export function codeFileLinks() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (index === undefined || !parent || !isFileLink(node)) return;
      const filename = codeFileLinkName(node.url)!;
      const embed = node.type === "image" || standsAlone(parent);
      const children: PhrasingContent[] =
        node.type === "link" ? node.children : node.alt ? [{ type: "text", value: node.alt }] : [];
      const element = {
        type: CODE_FILE_NODE,
        data: {
          hName: CODE_FILE_TAG,
          hProperties: embed ? { filename, embed: "true" } : { filename },
        },
        children,
      };
      parent.children.splice(index, 1, element as unknown as PhrasingContent);
    });
  };
}

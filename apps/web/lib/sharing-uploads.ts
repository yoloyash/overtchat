import { remark } from "remark";
import { parseHTML } from "linkedom";
import type { Root, RootContent } from "mdast";
import {
  parseExpression,
  split,
  tokenize,
  walkAST,
  type ASTNode,
} from "@openuidev/lang-core";
import {
  isCodeExecutionPart,
  isImageToolPart,
  isOpenUIToolPart,
  normalizeOpenUILang,
  type FetchUrlPart,
} from "@overtchat/shared";
import type { UIMessage } from "ai";

const markdown = remark();
type Replace = (id: string) => string;

function uploadUrl(value: string, replace: Replace) {
  const match = /^\/api\/uploads\/([a-zA-Z0-9_-]+)([?#].*)?$/.exec(value);
  return match ? replace(match[1]) + (match[2] ?? "") : value;
}

/** Change actual link destinations, leaving prose, code, labels and formatting alone. */
function markdownUploads(source: string, replace: Replace) {
  const tree = markdown.parse(source);
  const edits: { start: number; end: number; value: string }[] = [];
  const references = new Set<string>();
  function visit(node: Root | RootContent, apply: boolean) {
    if (node.type === "linkReference" || node.type === "imageReference")
      references.add(node.identifier);
    if ("children" in node)
      for (const child of node.children) visit(child as RootContent, apply);
    let replacement: string | undefined;
    if (
      apply &&
      (node.type === "link" ||
        node.type === "image" ||
        (node.type === "definition" && references.has(node.identifier)))
    ) {
      const url = uploadUrl(node.url, replace);
      if (url !== node.url) {
        node.url = url;
        replacement = markdown
          .stringify({ type: "root", children: [node] })
          .trimEnd();
      }
    }
    if (apply && node.type === "html") {
      const { document } = parseHTML(`<html><body>${node.value}</body></html>`);
      let changed = false;
      for (const element of document.body.querySelectorAll(
        "img[src], a[href]",
      )) {
        if (element.closest("code, pre, script, style")) continue;
        const attribute = element.tagName === "IMG" ? "src" : "href";
        const original = element.getAttribute(attribute)!;
        const url = uploadUrl(original, replace);
        if (url !== original) {
          element.setAttribute(attribute, url);
          changed = true;
        }
      }
      if (changed) {
        // Remark splits an inline anchor into opening tag, text, and closing tag.
        // DOM serialization auto-closes the opening tag; retain the original boundary.
        const openingAnchor = /^<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>$/i.test(
          node.value,
        );
        node.value = openingAnchor
          ? document.body.innerHTML.replace(/<\/a>$/i, "")
          : document.body.innerHTML;
        replacement = node.value;
      }
    }
    if (replacement !== undefined && node.position) {
      const start = node.position.start.offset!;
      const end = node.position.end.offset!;
      // Parent serialization includes already-updated children (e.g. a linked image).
      for (let i = edits.length - 1; i >= 0; i--) {
        if (edits[i].start >= start && edits[i].end <= end) edits.splice(i, 1);
      }
      edits.push({ start, end, value: replacement });
    }
  }
  visit(tree, false);
  visit(tree, true);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  }
  return source;
}

/** Resolve static image arguments without evaluating actions or changing shared variables. */
function openuiUploads(source: string, replace: Replace) {
  const code = normalizeOpenUILang(source);
  try {
    const statements = new Map(
      split(tokenize(code)).map((s) => [s.id, parseExpression(s.tokens)]),
    );
    const reachable = new Set<string>();
    function include(id: string) {
      if (reachable.has(id) || !statements.has(id)) return;
      reachable.add(id);
      walkAST(statements.get(id)!, (node) => {
        if (node.k === "Ref" || node.k === "StateRef") include(node.n);
      });
    }
    include("root");
    function value(node: ASTNode, seen = new Set<string>()): unknown {
      switch (node.k) {
        case "Str":
        case "Num":
        case "Bool":
          return node.v;
        case "Null":
          return null;
        case "Arr": {
          const items = node.els.map((item) => value(item, seen));
          return items.includes(undefined) ? undefined : items;
        }
        case "Obj": {
          const entries = node.entries.map(([key, item]) => [
            key,
            value(item, seen),
          ]);
          return entries.some(([, item]) => item === undefined)
            ? undefined
            : Object.fromEntries(entries);
        }
        case "Member": {
          const object = value(node.obj, seen);
          return object &&
            typeof object === "object" &&
            Object.hasOwn(object, node.field)
            ? (object as Record<string, unknown>)[node.field]
            : undefined;
        }
        case "Index": {
          const object = value(node.obj, seen);
          const key = value(node.index, seen);
          return object &&
            typeof object === "object" &&
            (typeof key === "string" || typeof key === "number") &&
            Object.hasOwn(object, key)
            ? (object as Record<string, unknown>)[key]
            : undefined;
        }
        case "BinOp": {
          const left = value(node.left, seen);
          const right = value(node.right, seen);
          return node.op === "+" &&
            typeof left === "string" &&
            typeof right === "string"
            ? left + right
            : undefined;
        }
        case "Ternary": {
          const condition = value(node.cond, seen);
          return typeof condition === "boolean"
            ? value(condition ? node.then : node.else, seen)
            : undefined;
        }
        case "StateRef":
        case "Ref": {
          if (seen.has(node.n) || !statements.has(node.n)) return undefined;
          return value(statements.get(node.n)!, new Set([...seen, node.n]));
        }
        default:
          return undefined;
      }
    }
    // Strings/comments are single tokens, so examples inside Text/CodeBlock never match.
    const tokens = [
      ...code.matchAll(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_$][\w$]*|[^\s]/g,
      ),
    ].filter((t) => !t[0].startsWith("//") && !t[0].startsWith("/*"));
    const edits: { start: number; end: number; value: string }[] = [];
    let nesting = 0;
    let statement = "";
    for (let i = 0; i < tokens.length; i++) {
      const name = tokens[i][0];
      if (nesting === 0 && tokens[i + 1]?.[0] === "=") statement = name;
      if (["(", "[", "{"].includes(name)) nesting++;
      else if ([")", "]", "}"].includes(name)) nesting--;
      if (!reachable.has(statement)) continue;
      if (
        !["Image", "ImageBlock", "ImageGallery"].includes(name) ||
        tokens[i + 1]?.[0] !== "("
      )
        continue;
      const args: { start: number; end: number }[] = [];
      let depth = 0;
      let start = tokens[i + 1].index! + 1;
      for (let j = i + 2; j < tokens.length; j++) {
        const token = tokens[j][0];
        if ((token === "," || token === ")") && depth === 0) {
          args.push({ start, end: tokens[j].index! });
          start = tokens[j].index! + 1;
          if (token === ")") break;
        } else if (["(", "[", "{"].includes(token)) depth++;
        else if ([")", "]", "}"].includes(token)) depth--;
      }
      const arg = args[name === "Image" ? 1 : 0];
      if (!arg) continue;
      const original = value(
        parseExpression(tokenize(code.slice(arg.start, arg.end))),
      );
      let changed = original;
      if (typeof original === "string" && name !== "ImageGallery")
        changed = uploadUrl(original, replace);
      if (Array.isArray(original) && name === "ImageGallery") {
        changed = original.map((item) =>
          item && typeof item === "object" && typeof item.src === "string"
            ? { ...item, src: uploadUrl(item.src, replace) }
            : item,
        );
      }
      if (JSON.stringify(changed) !== JSON.stringify(original)) {
        edits.push({ ...arg, value: JSON.stringify(changed) });
      }
    }
    if (!edits.length) return source;
    let result = code;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      result =
        result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    }
    return result;
  } catch {
    // Invalid/unfinished artifacts already render their readable fallback.
    return source;
  }
}

/** Only fields that the renderer treats as attachments can grant public file access. */
export function mapUploadReferences(
  messages: UIMessage[],
  replace: Replace,
): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type === "file" || part.type === "source-url")
        return { ...part, url: uploadUrl(part.url, replace) };
      if (
        message.role === "assistant" &&
        (part.type === "text" || part.type === "reasoning")
      ) {
        return { ...part, text: markdownUploads(part.text, replace) };
      }
      if (part.type === "tool-fetch_url") {
        const fetched = part as unknown as FetchUrlPart;
        if (fetched.output?.kind === "image") {
          return {
            ...part,
            output: {
              ...fetched.output,
              uploadUrl: uploadUrl(fetched.output.uploadUrl, replace),
            },
          };
        }
      }
      if (
        isImageToolPart(part) &&
        part.output &&
        Array.isArray(part.output.images)
      ) {
        return {
          ...part,
          output: {
            ...part.output,
            images: part.output.images.map((image) => ({
              ...image,
              url: uploadUrl(image.url, replace),
            })),
          },
        };
      }
      if (
        isCodeExecutionPart(part) &&
        part.output &&
        Array.isArray(part.output.files)
      ) {
        return {
          ...part,
          output: {
            ...part.output,
            files: part.output.files.map((file) => ({
              ...file,
              url: typeof file?.url === "string" ? uploadUrl(file.url, replace) : file?.url,
            })),
          },
        };
      }
      if (isOpenUIToolPart(part)) {
        return {
          ...part,
          ...(part.input?.ui
            ? {
                input: {
                  ...part.input,
                  ui: openuiUploads(part.input.ui, replace),
                },
              }
            : {}),
          ...(part.rawInput?.ui
            ? {
                rawInput: {
                  ...part.rawInput,
                  ui: openuiUploads(part.rawInput.ui, replace),
                },
              }
            : {}),
        };
      }
      return part;
    }) as UIMessage["parts"],
  }));
}

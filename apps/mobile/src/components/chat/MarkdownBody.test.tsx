import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import type { CodeExecutionFile } from "@overtchat/shared";

const mocks = vi.hoisted(() => ({
  rules: undefined as unknown,
  listItem: vi.fn(() => "default list item"),
}));

vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn() },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: ({ children, style }: { children?: ReactNode; style?: unknown }) => (
    <span data-style={JSON.stringify(style)}>{children}</span>
  ),
}));
vi.mock("react-native-markdown-display", () => ({
  default: ({ rules }: { rules: unknown }) => {
    mocks.rules = rules;
    return null;
  },
  renderRules: { list_item: mocks.listItem },
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    colors: { foreground: "#fff", mutedForeground: "#999" },
    fonts: {},
    radii: {},
  }),
}));
vi.mock("./CodeBlock", () => ({ CodeBlock: () => null }));
vi.mock("./CodeExecutionFiles", () => ({
  CodeExecutionFiles: ({ files }: { files: CodeExecutionFile[] }) => <figure>{files[0].name}</figure>,
  CodeFileLinkText: () => null,
}));

import { MarkdownBody } from "./MarkdownBody";

const ruleStyles = { body: { color: "#fff" }, missingCodeFile: { width: "100%" } };
const chart = { id: "chart", url: "/chart", name: "Chart.png", mediaType: "image/png", size: 1 };

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  const { document, window } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
  container = document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
  mocks.listItem.mockClear();
});

afterEach(() => act(() => root.unmount()));

function render(element: ReactNode) {
  act(() => root.render(element));
}

function rules(codeFiles?: ReadonlyMap<string, CodeExecutionFile>) {
  render(<MarkdownBody text="" codeFiles={codeFiles} />);
  return mocks.rules as RenderRules;
}

function renderFileImage(codeFiles?: ReadonlyMap<string, CodeExecutionFile>, alt = "chart.png") {
  const node = {
    key: "image",
    attributes: { src: "sandbox:/mnt/data/chart.png", alt },
  } as unknown as ASTNode;
  const image = rules(codeFiles).image!(node, [], [], ruleStyles, [], "");
  render(<>{image}</>);
}

function listParents(...types: string[]) {
  return types.map((type) => ({ type })) as ASTNode[];
}

function parentsPassedForItemIn(...types: string[]) {
  const node = { key: "item" } as ASTNode;
  rules().list_item!(node, [], listParents(...types), ruleStyles, {});
  return (mocks.listItem.mock.calls.at(-1) as unknown[])[2] as ASTNode[];
}

it("numbers an item by its own list when a bullet list is further up", () => {
  expect(
    parentsPassedForItemIn("ordered_list", "list_item", "bullet_list", "body").map(({ type }) => type),
  ).toEqual(["ordered_list", "list_item", "body"]);
});

it("keeps bullets on bullet lists, including inside numbered lists", () => {
  const types = ["bullet_list", "list_item", "ordered_list", "body"];
  expect(parentsPassedForItemIn(...types).map(({ type }) => type)).toEqual(types);
});

it("shows a file no run returned as readable text on its own line", () => {
  renderFileImage();
  const text = container.querySelector("span")!;
  expect(text.textContent).toBe("chart.png");
  expect(JSON.parse(text.getAttribute("data-style")!)).toEqual([
    ruleStyles.body,
    ruleStyles.missingCodeFile,
  ]);
});

it("shows nothing for a missing file without a name to show", () => {
  renderFileImage(undefined, "");
  expect(container.textContent).toBe("");
});

it("still shows a file a run returned", () => {
  renderFileImage(new Map([["chart.png", chart]]));
  expect(container.querySelector("figure")?.textContent).toBe("Chart.png");
  expect(container.querySelector("span")).toBeNull();
});

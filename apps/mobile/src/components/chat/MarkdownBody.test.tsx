import React, { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EnrichedMarkdownTextProps } from "react-native-enriched-markdown";
import type { CodeExecutionFile } from "@overtchat/shared";

const mocks = vi.hoisted(() => ({
  props: undefined as unknown,
  openURL: vi.fn(() => Promise.resolve()),
  save: vi.fn(),
}));

vi.mock("react-native", () => ({
  Linking: { openURL: mocks.openURL },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native-enriched-markdown", () => ({
  EnrichedMarkdownText: (props: unknown) => {
    mocks.props = props;
    return null;
  },
}));
vi.mock("@/lib/theme", () => {
  // One object for every call, as the real hook returns while the theme is unchanged.
  const theme = {
    colors: { foreground: "#fff", mutedForeground: "#999" },
    fonts: {},
    radii: {},
    scheme: "dark",
  };
  return { useTheme: () => theme };
});
vi.mock("./CodeExecutionFiles", () => ({
  CodeExecutionFiles: ({ files }: { files: CodeExecutionFile[] }) => <figure>{files[0].name}</figure>,
  useSaveFile: () => ({ saving: null, save: mocks.save }),
}));

import { CodeBlock } from "./CodeBlock";
import { MarkdownBody } from "./MarkdownBody";

const chart = { id: "chart", url: "/api/uploads/chart", name: "Chart.png", mediaType: "image/png", size: 1 };
const files = new Map([["chart.png", chart]]);
const source = { link: "https://commonmark.org/help/", title: "Help", snippet: "" };

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  const { document, window } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
  container = document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
  mocks.openURL.mockClear();
  mocks.save.mockClear();
});

afterEach(() => act(() => root.unmount()));

function render(element: ReactNode) {
  act(() => root.render(element));
  return mocks.props as EnrichedMarkdownTextProps;
}

/** What the renderer shows in place of a block, drawn into the page. */
function show(element: ReactElement | undefined) {
  act(() => root.render(<>{element ?? null}</>));
}

const image = (url: string, altText: string) =>
  ({ kind: "image", id: "i", placement: "root", url, altText, title: "", occurrenceId: "o" }) as const;
const link = (url: string, label: string) =>
  ({ kind: "link", id: "l", placement: "root", url, label, title: "" }) as const;

it("turns a citation into a link that opens its source", () => {
  const props = render(
    <MarkdownBody text={"A claim \uE202turn0search0."} sourceLookup={() => ({ source, number: 1 })} />,
  );
  expect(props.markdown).toBe("A claim  [Commonmark](<cite:https://commonmark.org/help/>) .");
  expect(Object.keys(props.markdownStyle!.linkVariants!)).toEqual(["^cite:"]);

  props.onLinkPress!({ url: "cite:https://commonmark.org/help/" });
  expect(mocks.openURL).toHaveBeenCalledWith("https://commonmark.org/help/");
});

it("opens an ordinary link", () => {
  render(<MarkdownBody text="[site](https://example.org)" />).onLinkPress!({ url: "https://example.org" });
  expect(mocks.openURL).toHaveBeenCalledWith("https://example.org");
});

it("saves a run's file when its link is pressed, and ignores a name no run returned", () => {
  const props = render(<MarkdownBody text="[the chart](chart.png)" codeFiles={files} />);
  props.onLinkPress!({ url: "sandbox:/mnt/data/outputs/chart.png" });
  expect(mocks.save).toHaveBeenCalledWith(chart);

  props.onLinkPress!({ url: "missing.csv" });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.openURL).not.toHaveBeenCalled();
});

it("shows a run's file for an image or a line that is only its link", () => {
  const { renderers } = render(<MarkdownBody text="" codeFiles={files} />);
  show(renderers!.image!(image("sandbox:/mnt/data/chart.png", "Chart")));
  expect(container.querySelector("figure")?.textContent).toBe("Chart.png");
  show(renderers!.link!(link("chart.png", "chart.png")));
  expect(container.querySelector("figure")?.textContent).toBe("Chart.png");
});

it("gives each file link on a shared line a paragraph, so each shows its file", () => {
  const props = render(<MarkdownBody text="[a](chart.png) [b](report.csv)" codeFiles={files} />);
  expect(props.markdown).toBe("[a](chart.png)\n\n[b](report.csv)");
});

it("shows a file no run returned as its name, and nothing when it has none", () => {
  const { renderers } = render(<MarkdownBody text="" />);
  show(renderers!.image!(image("sandbox:/mnt/data/chart.png", "chart.png")));
  expect(container.querySelector("span")?.textContent).toBe("chart.png");
  expect(renderers!.image!(image("sandbox:/mnt/data/chart.png", ""))).toBeUndefined();
});

it("leaves web images and links to the native renderer", () => {
  const { renderers } = render(<MarkdownBody text="" codeFiles={files} />);
  expect(renderers!.image!(image("https://example.org/a.png", "A"))).toBeUndefined();
  expect(renderers!.link!(link("https://example.org", "site"))).toBeUndefined();
});

it("keeps its handlers when only the text grows, so earlier blocks are not redrawn", () => {
  const before = render(<MarkdownBody text="one" codeFiles={files} />);
  const after = render(<MarkdownBody text="one two" codeFiles={files} />);
  expect(after.onLinkPress).toBe(before.onLinkPress);
  expect(after.renderers).toBe(before.renderers);
  expect(after.markdownStyle).toBe(before.markdownStyle);
});

it("defers code highlighting only while the text is being written", () => {
  expect(render(<MarkdownBody text="one" />).streamingAnimation).toBe(false);
  const props = render(<MarkdownBody text="one" streaming />);
  expect(props.streamingAnimation).toBe(true);
  expect(props.streamingConfig).toMatchObject({ codeBlockMode: "progressive" });
});

it("draws reasoning smaller and muted", () => {
  const { markdownStyle } = render(<MarkdownBody text="thinking" variant="thinking" />);
  expect(markdownStyle!.paragraph).toMatchObject({ fontSize: 13, color: "#999" });
});

it("fences code with more backticks than the code contains", () => {
  const props = render(<CodeBlock code={"a ``` b ```` c"} language="ts {1}" />);
  expect(props.markdown).toBe("`````ts\na ``` b ```` c\n`````");
});

it("leaves the fence open while the code is being written", () => {
  const props = render(<CodeBlock code="let a" language="ts" streaming />);
  expect(props.markdown).toBe("```ts\nlet a");
  expect(props.streamingAnimation).toBe(true);
});

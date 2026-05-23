declare module "markdown-it" {
  interface MarkdownItOptions {
    html?: boolean;
    linkify?: boolean;
    breaks?: boolean;
    typographer?: boolean;
    [key: string]: unknown;
  }
  interface MarkdownItInstance {
    parse(src: string, env?: unknown): unknown[];
    render(src: string, env?: unknown): string;
    [key: string]: unknown;
  }
  function MarkdownIt(options?: MarkdownItOptions): MarkdownItInstance;
  export default MarkdownIt;
}

declare module "react-native-syntax-highlighter" {
  import type { ComponentType, ReactNode } from "react";
  import type { TextStyle } from "react-native";

  interface SyntaxHighlighterProps {
    language?: string;
    style?: Record<string, unknown>;
    highlighter?: "hljs" | "prism";
    fontFamily?: string;
    fontSize?: number;
    customStyle?: TextStyle;
    children?: ReactNode;
  }

  const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps>;
  export default SyntaxHighlighter;
}

declare module "react-syntax-highlighter/styles/prism" {
  const styles: Record<string, Record<string, unknown>>;
  export const atomDark: Record<string, unknown>;
  export const vs: Record<string, unknown>;
  export const tomorrow: Record<string, unknown>;
  export const prism: Record<string, unknown>;
  export default styles;
}

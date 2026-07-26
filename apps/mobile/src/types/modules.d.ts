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

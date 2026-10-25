declare module "markdown-it" {
  interface MarkdownItOptions {
    html?: boolean;
    linkify?: boolean;
    breaks?: boolean;
    typographer?: boolean;
    [key: string]: unknown;
  }
  interface MarkdownItToken {
    type: string;
    content: string;
    attrs: [string, string][] | null;
    children: MarkdownItToken[] | null;
    attrGet(name: string): string | null;
  }
  interface MarkdownItCoreState {
    tokens: MarkdownItToken[];
    Token: new (type: string, tag: string, nesting: number) => MarkdownItToken;
  }
  interface MarkdownItInstance {
    parse(src: string, env?: unknown): MarkdownItToken[];
    render(src: string, env?: unknown): string;
    linkify: { set(options: { fuzzyLink?: boolean; fuzzyEmail?: boolean; fuzzyIP?: boolean }): unknown };
    use(plugin: (md: MarkdownItInstance) => void): MarkdownItInstance;
    core: {
      ruler: {
        after(after: string, name: string, rule: (state: MarkdownItCoreState) => void): void;
      };
    };
    [key: string]: unknown;
  }
  function MarkdownIt(options?: MarkdownItOptions): MarkdownItInstance;
  export type { MarkdownItCoreState, MarkdownItInstance, MarkdownItToken };
  export default MarkdownIt;
}

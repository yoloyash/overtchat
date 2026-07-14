# Source Tokens

This is a token-count-only adaptation of NanoClaw's
[Repo Tokens](https://github.com/nanocoai/nanoclaw/tree/main/repo-tokens)
composite action. It keeps NanoClaw's `tiktoken` counting and SVG badge layout,
but deliberately omits the model-dependent “percentage of context window.”

The workflow counts production web, mobile, and shared source, including the
web runtime entry point and Next.js configuration. Tests, documentation,
maintenance scripts, infrastructure, generated output, dependencies, and
database migrations are excluded.

The tokenizer is pinned and the action lives in this repository so the metric
cannot change because an upstream branch moved. See [LICENSE](LICENSE) for the
upstream MIT license.

# Source Tokens

This is a token-count-only adaptation of NanoClaw's
[Repo Tokens](https://github.com/nanocoai/nanoclaw/tree/main/repo-tokens)
composite action. It keeps NanoClaw's `tiktoken` counting and SVG badge layout,
but deliberately omits the model-dependent “percentage of context window.”

The workflow counts the repository's system-understanding surface: production
web, mobile, and shared source; maintenance scripts; core runtime/build
configuration; and the agent guidance that documents the architecture. Tests,
generated output, dependencies, and database migrations are excluded.

The tokenizer is pinned and the action lives in this repository so the metric
cannot change because an upstream branch moved. See [LICENSE](LICENSE) for the
upstream MIT license.

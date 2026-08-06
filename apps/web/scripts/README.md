# Scripts

## Provider cache smoke test

`provider-cache-smoke.ts` is an opt-in live integration test. It sends the
same stable tool registry through the app's actual AI SDK transports in one
append-only conversation. The sequence is Cold Auto → Warm Auto → Forced
Search → Forced Direct URL → Auto After Force. Automatic turns must remain
tool-free for explicit tool-free prompts. Forced turns must require a web tool
only on their first step, return to automatic tool choice afterward, and choose
`web_search` for a query or `fetch_url` when the user supplied a URL.

The smoke test also fails if the system instructions or full tool registry
change, or if a provider's serialized conversation rewrites an earlier prefix
instead of appending to it. Cache counters are always included in the JSON
report, but hard cache hit/write assertions are limited to providers whose APIs
return dependable counters. llama.cpp LCP selection remains useful diagnostic
output, not a cross-provider correctness contract.

Run all configured targets from `apps/web/`:

```bash
npx tsx --env-file=../../.env scripts/provider-cache-smoke.ts
```

The full baseline run requires `GEMINI_API_KEY`, `AWS_BEARER_TOKEN`, and
llama.cpp on `127.0.0.1:9876`. Native OpenAI and Anthropic targets are also
included when `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are present. Select a
comma-separated subset with `CACHE_SMOKE_TARGETS`; unrelated credentials and
servers are then optional. `CACHE_SMOKE_CORPUS_WORDS` reduces or enlarges the
stable synthetic prefix. The llama.cpp target sends `id_slot: 0` by default so
multi-slot servers still produce an unambiguous cache signal; override it with
`CACHE_SMOKE_LLAMA_SLOT`.

```bash
CACHE_SMOKE_TARGETS='llama.cpp/local' \
CACHE_SMOKE_CORPUS_WORDS=120 \
npx tsx --env-file=../../.env scripts/provider-cache-smoke.ts
```

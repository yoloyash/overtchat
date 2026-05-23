"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PingArgs {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraBody: Record<string, unknown> | null;
}

type PingResult =
  | {
      ok: true;
      text: string;
      elapsedMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | { ok: false; error: string };

export interface ConnectionTesterProps {
  args: PingArgs;
  disabled?: boolean;
}

export function ConnectionTester({ args, disabled }: ConnectionTesterProps) {
  const [pinging, setPinging] = useState(false);
  const [result, setResult] = useState<PingResult | null>(null);

  async function ping() {
    setPinging(true);
    setResult(null);
    try {
      const res = await fetch("/api/model-configs/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const json = (await res.json()) as {
        text?: string;
        elapsedMs?: number;
        inputTokens?: number | null;
        outputTokens?: number | null;
        error?: string;
      };
      if (!res.ok || json.error) {
        setResult({ ok: false, error: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setResult({
        ok: true,
        text: json.text ?? "",
        elapsedMs: json.elapsedMs ?? 0,
        inputTokens: json.inputTokens ?? null,
        outputTokens: json.outputTokens ?? null,
      });
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPinging(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={disabled || pinging || !args.baseUrl || !args.model}
        onClick={ping}
      >
        {pinging ? (
          <>
            <Loader2 className="size-3 animate-spin" /> Testing…
          </>
        ) : (
          "Test connection"
        )}
      </Button>

      {result?.ok === true && (
        <div className="rounded-lg border border-ring/30 bg-ring/5 px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <CheckCircle2 className="size-3.5 text-ring" />
            Connected
            <span className="ml-auto font-normal text-muted-foreground">
              {result.elapsedMs}ms
              {result.inputTokens != null && result.outputTokens != null && (
                <> · {result.inputTokens} in / {result.outputTokens} out</>
              )}
            </span>
          </div>
          {result.text && (
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {result.text}
            </p>
          )}
        </div>
      )}
      {result?.ok === false && (
        <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <XCircle className="size-3.5 shrink-0 mt-0.5" />
          <span className="break-words">{result.error}</span>
        </div>
      )}
    </div>
  );
}

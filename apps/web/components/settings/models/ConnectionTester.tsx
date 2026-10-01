"use client";

import { ErrorNotice } from "@/components/ui/error-notice";
import { apiError, getErrorMessage } from "@overtchat/shared";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motionClasses } from "@/lib/motion";
import type { ApiFormat, ProviderId } from "@/lib/providers/catalog";
import { apiUrl } from "@/lib/api-url";

export interface PingArgs {
  providerId: ProviderId;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerOptions: Record<string, unknown> | null;
  toolCallingEnabled: boolean;
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
      const res = await fetch(apiUrl("/api/model-configs/ping"), {
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
        setResult({ ok: false, error: apiError(res.status, json, "Could not connect to the model provider.").message });
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
      setResult({ ok: false, error: getErrorMessage(e, "Could not connect to the model provider.") });
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
            <Loader2 className={`size-3 ${motionClasses.spinner}`} /> Testing…
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
        <ErrorNotice message={result.error} onDismiss={() => setResult(null)} />
      )}
    </div>
  );
}

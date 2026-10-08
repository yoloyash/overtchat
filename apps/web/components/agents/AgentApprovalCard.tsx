"use client";

import { ErrorNotice } from "@/components/ui/error-notice";
import { useId } from "react";
import { Loader2, ShieldQuestion } from "lucide-react";
import { approvalDetails } from "@overtchat/shared/agent-tool-details";
import type {
  AgentQuestionRequest,
  AgentQuestionResponse,
} from "@overtchat/shared/agent-interaction";
import { Button } from "@/components/ui/button";

// Inline approvals with bounded tool details use shared transcript and UI primitives.
export function AgentApprovalCard({
  request,
  pending,
  error,
  onRespond,
}: {
  request: AgentQuestionRequest;
  pending: boolean;
  error?: string;
  onRespond: (response: AgentQuestionResponse) => void;
}) {
  const id = useId();
  const approval = approvalDetails(request);
  return (
    <section
      data-testid="agent-approval-card"
      aria-labelledby={`${id}-title`}
      aria-busy={pending}
      className="min-w-0 space-y-3 rounded-lg border bg-card p-4 text-sm"
    >
      <div className="flex items-center gap-2">
        <ShieldQuestion
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <h3
          id={`${id}-title`}
          className="font-medium leading-5"
          aria-live="polite"
        >
          {approval.title}
        </h3>
        {pending && (
          <Loader2
            className="ml-auto size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-label="Sending response"
          />
        )}
      </div>
      {approval.message && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Approval reason"
          className="max-h-32 overflow-auto overscroll-contain whitespace-pre-wrap break-words text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {approval.message}
        </div>
      )}
      {approval.sections.length > 0 && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Requested action"
          className="max-h-[200px] space-y-3 overflow-auto overscroll-contain rounded-md border bg-muted/40 p-3 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {approval.sections.map((section, index) => (
            <div key={`${index}-${section.label}`} className="space-y-1">
              <p className="break-words text-xs font-medium text-muted-foreground">
                {section.label}
              </p>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
                {section.value}
              </pre>
            </div>
          ))}
        </div>
      )}
      {error && (
        <ErrorNotice message={error} />
      )}
      <div className="flex flex-wrap gap-2">
        {approval.choices.map((choice) => (
          <Button
            key={choice.value}
            type="button"
            size="sm"
            variant={
              choice.kind === "deny"
                ? "destructive"
                : choice.kind === "always"
                  ? "outline"
                  : "default"
            }
            disabled={pending}
            onClick={() => onRespond({ value: choice.value })}
          >
            {choice.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

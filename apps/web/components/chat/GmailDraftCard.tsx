"use client";

import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { describeGmailDraft, type GmailToolPart } from "@overtchat/shared";
import { GmailLogo } from "@/components/GmailLogo";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors";
import { useSendGmailDraft } from "@/lib/queries/integrations";
import { cn } from "@/lib/utils";

/** A body this long starts folded, so a draft does not push the reply away. */
const FOLDED_LINES = 4;
const FOLDED_CHARS = 320;

/**
 * A draft a model saved in the user's Gmail: what it says, who it goes to,
 * and the only way it gets sent, which is the user pressing Send.
 */
export function GmailDraftCard({
  part,
  canSend,
}: {
  part: GmailToolPart;
  /** False where the reader is not the mailbox's owner at their own chat. */
  canSend: boolean;
}) {
  const send = useSendGmailDraft();
  const [justSent, setJustSent] = useState<{
    at: string;
    threadId: string | null;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const draft = describeGmailDraft(
    justSent
      ? { ...part, output: { ...(part.output as object), sent: justSent } }
      : part,
  );
  const sent = draft.sentAt !== undefined;
  const long =
    draft.body.length > FOLDED_CHARS ||
    draft.body.split("\n").length > FOLDED_LINES;

  return (
    <div
      role="group"
      aria-label="Gmail draft"
      className="overflow-hidden rounded-lg border bg-background/40 text-sm"
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <GmailLogo className="size-4" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{draft.subject}</p>
          <p className="truncate text-xs text-muted-foreground">
            {sent ? "Sent" : "Draft, not sent"}
            {draft.recipients && ` · ${draft.recipients}`}
          </p>
        </div>
        <a
          href={draft.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={sent ? "Open in Gmail" : "Open drafts in Gmail"}
          title={sent ? "Open in Gmail" : "Edit in Gmail"}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none motion-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ExternalLink className="size-3.5" />
        </a>
        {sent ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
            <Check className="size-3.5" />
            Sent
          </span>
        ) : (
          canSend && (
            <Button
              type="button"
              size="sm"
              disabled={send.isPending}
              onClick={() => send.mutate(draft.draftId, { onSuccess: setJustSent })}
            >
              {send.isPending ? "Sending…" : "Send"}
            </Button>
          )
        )}
      </div>
      {draft.body && (
        <div className="border-t px-3 py-2.5">
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90",
              long && !expanded && "line-clamp-4",
            )}
          >
            {draft.body}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              className="mt-1.5 text-xs text-muted-foreground outline-none motion-colors hover:text-foreground focus-visible:underline"
            >
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
        </div>
      )}
      {send.isError && !sent && (
        <p className="border-t px-3 py-2 text-xs text-destructive">
          {getErrorMessage(send.error, "Could not send the draft.")}
        </p>
      )}
    </div>
  );
}

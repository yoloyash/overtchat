"use client";

import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import {
  GMAIL_EMAIL_STATUS_LABELS,
  describeGmailEmail,
  type GmailToolPart,
} from "@overtchat/shared";
import { GmailLogo } from "@/components/GmailLogo";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors";
import { useSaveGmailEmail, useSendGmailEmail } from "@/lib/queries/integrations";
import { cn } from "@/lib/utils";

/** A body this long starts folded, so an email does not push the reply away. */
const FOLDED_LINES = 4;
const FOLDED_CHARS = 320;

/**
 * An email a model wrote: what it says, who it goes to, and the only way it
 * gets sent, which is the user pressing Send. Until then it is only in the
 * chat, unless the user saves it in Gmail to edit it there.
 */
export function GmailEmailCard({
  part,
  replaced,
  canSend,
}: {
  part: GmailToolPart;
  /** Emails a later version in the conversation took the place of. */
  replaced?: ReadonlySet<string>;
  /** False where the reader is not the mailbox's owner at their own chat. */
  canSend: boolean;
}) {
  const send = useSendGmailEmail();
  const save = useSaveGmailEmail();
  // What this page did, until the chat is loaded again and says so itself.
  const [sent, setSent] = useState<{ at: string; threadId: string | null }>();
  const [saved, setSaved] = useState<{ draftId: string }>();
  const [expanded, setExpanded] = useState(false);
  const email = describeGmailEmail(
    sent || saved
      ? {
          ...part,
          output: {
            ...(part.output as object),
            ...(saved ? { saved } : {}),
            ...(sent ? { sent } : {}),
          },
        }
      : part,
    replaced,
  );
  const long =
    email.body.length > FOLDED_CHARS ||
    email.body.split("\n").length > FOLDED_LINES;
  const busy = send.isPending || save.isPending;
  const failure = send.isError
    ? getErrorMessage(send.error, "Could not send the email.")
    : save.isError
      ? getErrorMessage(save.error, "Could not save the email in Gmail.")
      : null;

  return (
    <div
      role="group"
      aria-label="Gmail email"
      className="overflow-hidden rounded-lg border bg-background/40 text-sm"
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <GmailLogo className="size-4" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{email.subject}</p>
          <p className="truncate text-xs text-muted-foreground">
            {GMAIL_EMAIL_STATUS_LABELS[email.status]}
            {email.recipients && ` · ${email.recipients}`}
          </p>
        </div>
        {email.href && (
          <a
            href={email.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={
              email.status === "sent" ? "Open in Gmail" : "Open drafts in Gmail"
            }
            title={email.status === "sent" ? "Open in Gmail" : "Edit in Gmail"}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none motion-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
        {email.status === "sent" ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
            <Check className="size-3.5" />
            Sent
          </span>
        ) : (
          canSend &&
          email.status !== "replaced" && (
            <>
              {email.status === "unsent" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    send.reset();
                    save.mutate(email, { onSuccess: setSaved });
                  }}
                >
                  {save.isPending ? "Saving…" : "Save to Gmail"}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  save.reset();
                  send.mutate(email, { onSuccess: setSent });
                }}
              >
                {send.isPending ? "Sending…" : "Send"}
              </Button>
            </>
          )
        )}
      </div>
      {email.body && (
        <div className="border-t px-3 py-2.5">
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90",
              long && !expanded && "line-clamp-4",
            )}
          >
            {email.body}
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
      {failure && email.status !== "sent" && (
        <p className="border-t px-3 py-2 text-xs text-destructive">{failure}</p>
      )}
    </div>
  );
}

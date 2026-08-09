"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { AgentRuntimeSnapshot } from "@/lib/agents/types";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

type AgentInteraction = NonNullable<
  AgentRuntimeSnapshot["pendingInteraction"]
>;

const dialogBackdrop = cn(
  "fixed inset-0 z-40 bg-black/40",
  motionClasses.overlay,
);
const dialogPopup = cn(
  "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
  motionClasses.dialog,
);

export function RenameAgentSessionDialog({
  providerLabel,
  open,
  initialName,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  providerLabel: string;
  open: boolean;
  initialName: string;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  return open ? (
    <RenameAgentSessionDialogContent
      initialName={initialName}
      providerLabel={providerLabel}
      pending={pending}
      error={error}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />
  ) : null;
}

function RenameAgentSessionDialogContent({
  providerLabel,
  initialName,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  providerLabel: string;
  initialName: string;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Rename session
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            This updates the native {providerLabel} session name.
          </Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const value = name.trim();
              if (value) onSubmit(value);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="agent-session-name">Name</Label>
              <Input
                id="agent-session-name"
                value={name}
                maxLength={120}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {error && <DialogError>{error}</DialogError>}
            <DialogActions>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pending || !name.trim()}
              >
                {pending && <PendingIcon />}
                Save
              </Button>
            </DialogActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CompactAgentSessionDialog({
  providerLabel,
  supportsCustomInstructions,
  open,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  providerLabel: string;
  supportsCustomInstructions: boolean;
  open: boolean;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (instructions?: string) => void;
}) {
  return open ? (
    <CompactAgentSessionDialogContent
      pending={pending}
      providerLabel={providerLabel}
      supportsCustomInstructions={supportsCustomInstructions}
      error={error}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />
  ) : null;
}

function CompactAgentSessionDialogContent({
  providerLabel,
  supportsCustomInstructions,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  providerLabel: string;
  supportsCustomInstructions: boolean;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (instructions?: string) => void;
}) {
  const [instructions, setInstructions] = useState("");

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Compact context?
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {providerLabel} will summarize older context in this native
            session.
          </Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(instructions.trim() || undefined);
            }}
          >
            {supportsCustomInstructions && (
              <div className="space-y-1.5">
                <Label htmlFor="agent-compact-instructions">
                  Instructions{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="agent-compact-instructions"
                  value={instructions}
                  maxLength={20_000}
                  className="min-h-24 resize-y"
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </div>
            )}
            {error && <DialogError>{error}</DialogError>}
            <DialogActions>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <PendingIcon />}
                Compact
              </Button>
            </DialogActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AgentInteractionDialog({
  providerLabel,
  request,
  pending,
  error,
  onRespond,
}: {
  providerLabel: string;
  request?: AgentInteraction;
  pending: boolean;
  error?: string;
  onRespond: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
}) {
  return request ? (
    <InteractionDialogContent
      key={request.id}
      providerLabel={providerLabel}
      request={request}
      pending={pending}
      error={error}
      onRespond={onRespond}
    />
  ) : null;
}

function InteractionDialogContent({
  providerLabel,
  request,
  pending,
  error,
  onRespond,
}: {
  providerLabel: string;
  request: AgentInteraction;
  pending: boolean;
  error?: string;
  onRespond: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
}) {
  const options = Array.isArray(request.options)
    ? request.options.filter(
        (option): option is string => typeof option === "string",
      )
    : [];
  const [value, setValue] = useState(
    request.method === "editor" && typeof request.prefill === "string"
      ? request.prefill
      : "",
  );
  const title =
    typeof request.title === "string" && request.title.trim()
      ? request.title
      : `${providerLabel} needs your input`;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (request.method === "confirm") {
      onRespond({ confirmed: true });
    } else if (request.method === "select" && value) {
      onRespond({ value });
    } else if (request.method === "input" || request.method === "editor") {
      onRespond({ value });
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next && !pending) onRespond({ cancelled: true });
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {title}
          </Dialog.Title>
          {typeof request.message === "string" && request.message && (
            <Dialog.Description className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {request.message}
            </Dialog.Description>
          )}
          <form onSubmit={submit} className="mt-5 space-y-4">
            {request.method === "select" && (
              <RadioGroup
                value={value}
                onValueChange={setValue}
                aria-label={title}
                className="gap-2"
              >
                {options.map((option) => (
                  <Label
                    key={option}
                    className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-data-[checked]:border-ring has-data-[checked]:bg-accent/40"
                  >
                    <RadioGroupItem value={option} />
                    <span className="min-w-0 wrap-anywhere">{option}</span>
                  </Label>
                ))}
              </RadioGroup>
            )}
            {request.method === "input" && (
              <Input
                type={request.secret === true ? "password" : "text"}
                value={value}
                autoFocus
                placeholder={
                  typeof request.placeholder === "string"
                    ? request.placeholder
                    : undefined
                }
                onChange={(event) => setValue(event.target.value)}
              />
            )}
            {request.method === "editor" && (
              <Textarea
                value={value}
                autoFocus
                className="min-h-48 resize-y font-mono text-xs"
                onChange={(event) => setValue(event.target.value)}
              />
            )}
            {error && <DialogError>{error}</DialogError>}
            <DialogActions>
              {request.method === "confirm" ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onRespond({ confirmed: false })}
                  >
                    No
                  </Button>
                  <Button type="submit" size="sm" disabled={pending}>
                    {pending && <PendingIcon />}
                    Yes
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onRespond({ cancelled: true })}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      pending ||
                      (request.method === "select" && !value)
                    }
                  >
                    {pending && <PendingIcon />}
                    Continue
                  </Button>
                </>
              )}
            </DialogActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-2">{children}</div>;
}

function DialogError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

function PendingIcon() {
  return (
    <Loader2 className="animate-spin motion-reduce:animate-none" />
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddUserDialog } from "@/app/(app)/settings/users/AddUserDialog";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { cn } from "@/lib/utils";

export function AdminOnboardingCard({
  modelCount,
  onDismiss,
}: {
  modelCount: number;
  onDismiss: () => void;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const [userAdded, setUserAdded] = useLocalStorage<boolean>(
    "overtchat_onboarding_user_added",
    false,
  );

  const modelDone = modelCount > 0;

  return (
    <>
      <div className="mx-auto w-full max-w-md">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Welcome to overtchat
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A couple of quick steps to get your workspace running.
          </p>
        </div>

        <ol className="mt-10 space-y-6">
          <Step
            done={modelDone}
            title="Add your first model"
            description="Anthropic, Google Gemini, or any OpenAI-compatible endpoint."
            action={
              <Button render={<Link href="/settings/models/new" />} size="sm">
                <Plus /> {modelDone ? "Add another" : "Add model"}
              </Button>
            }
          />
          <Step
            done={userAdded}
            optional
            title="Invite a teammate"
            description="Skip this if you're the only one using overtchat."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUserOpen(true)}
              >
                <Plus /> Add user
              </Button>
            }
          />
        </ol>

        <div className="mt-10 flex items-center justify-center">
          <Button
            variant={modelDone ? "default" : "ghost"}
            size="sm"
            onClick={onDismiss}
          >
            {modelDone ? "Continue to chat" : "Skip for now"}
          </Button>
        </div>
      </div>

      <AddUserDialog
        open={userOpen}
        onOpenChange={setUserOpen}
        onCreated={() => setUserAdded(true)}
      />
    </>
  );
}

function Step({
  done,
  optional,
  title,
  description,
  action,
}: {
  done: boolean;
  optional?: boolean;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-4">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
          done
            ? "border-transparent bg-primary text-primary-foreground"
            : "border-border bg-background text-transparent",
        )}
        aria-hidden="true"
      >
        <Check className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className={cn(done && "text-muted-foreground")}>{title}</span>
          {optional && !done && (
            <span className="text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        <div className="mt-3">{action}</div>
      </div>
    </li>
  );
}

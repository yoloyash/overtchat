"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModelConfigDialog } from "@/app/(app)/settings/models/ModelConfigDialog";
import { AddUserDialog } from "@/app/(app)/settings/users/AddUserDialog";
import { useCreateModelConfig } from "@/lib/queries/modelConfigs";
import type { ModelConfigInput } from "@/lib/config";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { cn } from "@/lib/utils";

export function AdminOnboardingCard({
  modelCount,
  onDismiss,
}: {
  modelCount: number;
  onDismiss: () => void;
}) {
  const [modelMode, setModelMode] = useState<"new" | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [userAdded, setUserAdded] = useLocalStorage<boolean>(
    "overtchat_onboarding_user_added",
    false,
  );
  const createMut = useCreateModelConfig();

  const modelDone = modelCount > 0;

  async function saveModel(input: ModelConfigInput) {
    await createMut.mutateAsync(input);
    setModelMode(null);
  }

  return (
    <>
      <div className="mx-auto w-full max-w-md">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
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
            description="Connect an OpenAI-compatible endpoint."
            action={
              <Button size="sm" onClick={() => setModelMode("new")}>
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

      <ModelConfigDialog
        mode={modelMode}
        onClose={() => setModelMode(null)}
        onSave={saveModel}
      />
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

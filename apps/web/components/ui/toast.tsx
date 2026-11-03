"use client";

import type { ReactNode } from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { AlertTriangle, Bell, CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";

type ToastInput =
  | string
  | {
      title: ReactNode;
      description?: ReactNode;
      timeout?: number;
      /** Replaces the icon the type implies. */
      icon?: ReactNode;
      /** A button under the text. */
      action?: { label: string; onClick: () => void };
    };
type ToastOptions = Exclude<ToastInput, string>;
type ToastData = { icon?: ReactNode };

const toastManager = ToastPrimitive.createToastManager();

export const toast = {
  success(input: ToastInput) {
    const options = normalizeInput(input);
    toastManager.add({
      ...options,
      type: "success",
      timeout: options.timeout ?? 4500,
    });
  },
  error(input: ToastInput) {
    const options = normalizeInput(input);
    toastManager.add({
      ...options,
      type: "error",
      priority: "high",
      timeout: options.timeout ?? 7000,
    });
  },
  warning(input: ToastInput) {
    const options = normalizeInput(input);
    toastManager.add({
      ...options,
      type: "warning",
      timeout: options.timeout ?? 6000,
    });
  },
  /** Something to know about, with a way to get there. */
  notice(input: ToastInput) {
    const options = normalizeInput(input);
    toastManager.add({
      ...options,
      type: "notice",
      timeout: options.timeout ?? 8000,
    });
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} limit={4}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 outline-none max-sm:right-4 max-sm:left-4">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((item) => (
    <ToastPrimitive.Root
      key={item.id}
      toast={item}
      swipeDirection="right"
      className={cn(
        "pointer-events-auto w-full rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none",
        motionClasses.toast,
        item.type === "success" && "border-ring/30",
        item.type === "error" && "border-destructive/35",
        item.type === "warning" && "border-amber-500/35",
      )}
    >
      <ToastPrimitive.Content className="flex gap-3 p-3">
        {(item.data as ToastData | undefined)?.icon ?? <ToastIcon type={item.type} />}
        <div className="min-w-0 flex-1">
          <ToastPrimitive.Title className="text-sm font-medium text-foreground" />
          {item.description != null && (
            <ToastPrimitive.Description className="mt-0.5 text-xs leading-relaxed text-muted-foreground" />
          )}
          {item.actionProps && (
            <ToastPrimitive.Action className="mt-2 inline-flex h-7 items-center rounded-md border bg-background px-2.5 text-xs font-medium text-foreground outline-none motion-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50" />
          )}
        </div>
        <ToastPrimitive.Close
          aria-label="Dismiss notification"
          className="rounded-md p-1 text-muted-foreground outline-none motion-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ));
}

function ToastIcon({ type }: { type?: string }) {
  if (type === "error") {
    return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
  }
  if (type === "warning") {
    return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />;
  }
  if (type === "notice") {
    return <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  }

  return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ring" />;
}

function normalizeInput(input: ToastInput) {
  const { icon, action, ...options }: ToastOptions =
    typeof input === "string" ? { title: input } : input;
  return {
    ...options,
    ...(icon ? { data: { icon } satisfies ToastData } : {}),
    ...(action
      ? { actionProps: { children: action.label, onClick: action.onClick } }
      : {}),
  };
}

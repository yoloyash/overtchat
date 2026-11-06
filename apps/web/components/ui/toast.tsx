"use client";

import type { ReactNode } from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { AlertTriangle, Bell, CheckCircle2, X, XCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";

type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  timeout?: number;
  /** A later toast with the same id takes this one's place. */
  id?: string;
  /** Replaces the icon the type implies. */
  icon?: ReactNode;
  /** A button beside the text; using it closes the toast. */
  action?: { label: string; onClick: () => void };
};
type ToastInput = string | ToastOptions;
type ToastData = { icon?: ReactNode };

const toastManager = ToastPrimitive.createToastManager();

function show(
  type: "success" | "error" | "warning" | "notice",
  input: ToastInput,
  timeout: number,
): string {
  const { icon, action, ...options }: ToastOptions =
    typeof input === "string" ? { title: input } : input;
  const id: string = toastManager.add({
    ...options,
    type,
    timeout: options.timeout ?? timeout,
    ...(type === "error" ? { priority: "high" as const } : {}),
    ...(icon ? { data: { icon } satisfies ToastData } : {}),
    ...(action
      ? {
          actionProps: {
            children: action.label,
            onClick: () => {
              toastManager.close(id);
              action.onClick();
            },
          },
        }
      : {}),
  });
  return id;
}

export const toast = {
  success: (input: ToastInput) => show("success", input, 4500),
  error: (input: ToastInput) => show("error", input, 7000),
  warning: (input: ToastInput) => show("warning", input, 6000),
  /** Something to know about, with a way to get there. */
  notice: (input: ToastInput) => show("notice", input, 5000),
  dismiss: (id: string) => toastManager.close(id),
};

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} limit={4}>
      {children}
      <ToastPrimitive.Portal>
        {/* Under the header row, clear of its controls and of the composer. */}
        <ToastPrimitive.Viewport className="fixed top-[calc(3.5rem+env(safe-area-inset-top))] right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 outline-none">
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
      swipeDirection={["right", "up"]}
      className={cn(
        "group/toast pointer-events-auto relative w-full rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none",
        motionClasses.toast,
        item.type === "success" && "border-ring/30",
        item.type === "error" && "border-destructive/35",
        item.type === "warning" && "border-amber-500/35",
      )}
    >
      <ToastPrimitive.Content className="flex items-center gap-3 px-3.5 py-3">
        <div className="flex min-w-0 flex-1 gap-2.5">
          {/* As tall as the title's line, so the icon sits on it. */}
          <span className="flex h-5 w-4 shrink-0 items-center justify-center">
            {(item.data as ToastData | undefined)?.icon ?? (
              <ToastIcon type={item.type} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <ToastPrimitive.Title className="text-sm leading-5 font-medium text-foreground" />
            {item.description != null && (
              <ToastPrimitive.Description className="mt-0.5 text-xs leading-relaxed break-words text-muted-foreground" />
            )}
          </div>
        </div>
        {item.actionProps && (
          <ToastPrimitive.Action
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          />
        )}
      </ToastPrimitive.Content>
      <ToastPrimitive.Close
        aria-label="Dismiss notification"
        className={cn(
          "absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border bg-popover text-muted-foreground shadow-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          "opacity-0 motion-opacity group-hover/toast:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <X className="size-3" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  ));
}

function ToastIcon({ type }: { type?: string }) {
  if (type === "error") {
    return <XCircle className="size-4 text-destructive" />;
  }
  if (type === "warning") {
    return <AlertTriangle className="size-4 text-amber-500" />;
  }
  if (type === "notice") {
    return <Bell className="size-4 text-muted-foreground" />;
  }

  return <CheckCircle2 className="size-4 text-ring" />;
}

"use client";

import type { ReactNode } from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastInput =
  | string
  | {
      title: ReactNode;
      description?: ReactNode;
      timeout?: number;
    };
type ToastOptions = Exclude<ToastInput, string>;

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
        "pointer-events-auto w-full rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none transition-all duration-200",
        "data-[swiping]:transition-none data-[starting-style]:translate-x-6 data-[starting-style]:opacity-0 data-[ending-style]:translate-x-6 data-[ending-style]:opacity-0",
        item.type === "success" && "border-ring/30",
        item.type === "error" && "border-destructive/35",
      )}
    >
      <ToastPrimitive.Content className="flex gap-3 p-3">
        <ToastIcon type={item.type} />
        <div className="min-w-0 flex-1">
          <ToastPrimitive.Title className="text-sm font-medium text-foreground" />
          {item.description != null && (
            <ToastPrimitive.Description className="mt-0.5 text-xs leading-relaxed text-muted-foreground" />
          )}
        </div>
        <ToastPrimitive.Close
          aria-label="Dismiss notification"
          className="rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
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

  return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ring" />;
}

function normalizeInput(input: ToastInput): ToastOptions {
  if (typeof input === "string") return { title: input };
  return input;
}

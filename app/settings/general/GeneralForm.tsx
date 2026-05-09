"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Theme, useTheme } from "@/lib/theme";

const OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function GeneralForm() {
  const [theme, setTheme] = useTheme();

  return (
    <div className="max-w-xl space-y-8">
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">General</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personal preferences for this browser.
        </p>
      </header>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Appearance</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose how overtchat looks to you.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-3 gap-2"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border bg-card px-3 py-4 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "border-ring ring-1 ring-ring"
                    : "hover:bg-accent/50",
                )}
              >
                <Icon className="size-4 text-muted-foreground" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

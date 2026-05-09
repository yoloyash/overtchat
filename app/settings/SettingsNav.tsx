"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plug, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  {
    label: "Admin settings",
    items: [{ href: "/settings/api-endpoint", label: "API endpoint", icon: Plug }],
  },
  {
    label: "User settings",
    items: [{ href: "/settings/general", label: "General", icon: Settings2 }],
  },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="space-y-5">
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="mb-1.5 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {section.label}
          </p>
          <div className="space-y-1">
            {section.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

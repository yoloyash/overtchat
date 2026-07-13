"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu, Database, Settings2, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth/client";

type Item = {
  href: string;
  label: string;
  icon: typeof Cpu;
};

const USER_ITEMS: Item[] = [
  { href: "/settings/general", label: "General", icon: Settings2 },
  { href: "/settings/account", label: "Account", icon: User },
  { href: "/settings/data", label: "Data", icon: Database },
];

const ADMIN_ITEMS: Item[] = [
  { href: "/settings/models", label: "Models", icon: Cpu },
  { href: "/settings/users", label: "Users", icon: Users },
];

export function SettingsNav() {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";

  const items = isAdmin ? [...USER_ITEMS, ...ADMIN_ITEMS] : USER_ITEMS;

  return (
    <nav
      aria-label="Settings"
      className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col md:gap-0 md:space-y-5 md:overflow-visible"
    >
      <Section
        label="Personal settings"
        items={USER_ITEMS}
        pathname={pathname}
        className="hidden md:block"
      />
      {isAdmin && (
        <Section
          label="Admin settings"
          items={ADMIN_ITEMS}
          pathname={pathname}
          className="hidden md:block"
        />
      )}
      <div className="flex shrink-0 gap-1 md:hidden">
        {items.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
    </nav>
  );
}

function Section({
  label,
  items,
  pathname,
  className,
}: {
  label: string;
  items: Item[];
  pathname: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1.5 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}

function NavLink({ item, pathname }: { item: Item; pathname: string }) {
  const active = pathname === item.href;
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

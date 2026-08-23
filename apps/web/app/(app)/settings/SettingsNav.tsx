"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Cable,
  Cpu,
  Database,
  KeyRound,
  ServerCog,
  Settings2,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { BetaBadge } from "@/components/BetaBadge";
import { LinkPendingIndicator } from "@/components/ui/link-pending-indicator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth/client";

type Item = {
  href: string;
  label: string;
  icon: typeof Cpu;
  beta?: boolean;
};

type Group = {
  label: string;
  items: Item[];
};

const PREFERENCE_ITEMS: Item[] = [
  { href: "/settings/general", label: "General", icon: Settings2 },
  { href: "/settings/tools", label: "Tools", icon: Wrench },
];

const ACCOUNT_ITEMS: Item[] = [
  { href: "/settings/profile", label: "Profile", icon: UserRound },
  { href: "/settings/account", label: "Security", icon: KeyRound },
  { href: "/settings/data", label: "Data", icon: Database },
];

const ADMIN_ITEMS: Item[] = [
  { href: "/settings/models", label: "Models", icon: Cpu },
  {
    href: "/settings/services",
    label: "Services",
    icon: ServerCog,
  },
  {
    href: "/settings/connections",
    label: "Connections",
    icon: Cable,
    beta: true,
  },
  { href: "/settings/users", label: "Users", icon: Users },
];

const USER_GROUPS: Group[] = [
  { label: "Preferences", items: PREFERENCE_ITEMS },
  { label: "Account", items: ACCOUNT_ITEMS },
];

const ADMIN_GROUP: Group = {
  label: "Administration",
  items: ADMIN_ITEMS,
};

export function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";

  const groups = isAdmin ? [...USER_GROUPS, ADMIN_GROUP] : USER_GROUPS;
  const currentItem =
    groups
      .flatMap((group) => group.items)
      .find((item) => isActive(item, pathname)) ?? PREFERENCE_ITEMS[0];
  const CurrentIcon = currentItem.icon;

  return (
    <nav aria-label="Settings" className="w-full md:space-y-4">
      <div className="md:hidden">
        <Select
          value={currentItem.href}
          onValueChange={(href) => {
            if (href && href !== currentItem.href) router.push(href);
          }}
        >
          <SelectTrigger aria-label="Settings page" className="w-full">
            <SelectValue>
              <CurrentIcon className="size-3.5" />
              <span>{currentItem.label}</span>
              {currentItem.beta && <BetaBadge />}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SelectItem key={item.href} value={item.href}>
                      <Icon className="size-3.5" />
                      <span>{item.label}</span>
                      {item.beta && <BetaBadge />}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      {groups.map((group) => (
        <Section
          key={group.label}
          label={group.label}
          items={group.items}
          pathname={pathname}
          className="hidden md:block"
        />
      ))}
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
  const active = isActive(item, pathname);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm motion-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span>{item.label}</span>
      {item.beta && <BetaBadge />}
      <LinkPendingIndicator />
    </Link>
  );
}

function isActive(item: Item, pathname: string) {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

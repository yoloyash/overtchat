"use client";

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Brain,
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

type SettingsPath =
  | "/settings/general"
  | "/settings/personalization"
  | "/settings/tools"
  | "/settings/profile"
  | "/settings/account"
  | "/settings/data"
  | "/settings/models"
  | "/settings/services"
  | "/settings/connections"
  | "/settings/users";

type NavItemId =
  | "general"
  | "personalization"
  | "tools"
  | "profile"
  | "security"
  | "data"
  | "models"
  | "services"
  | "agents"
  | "users";

type NavGroupId = "preferences" | "account" | "administration";

type Item = {
  id: NavItemId;
  href: SettingsPath;
  icon: typeof Cpu;
  beta?: boolean;
};

type Group = {
  id: NavGroupId;
  items: Item[];
};

const PREFERENCE_ITEMS: Item[] = [
  { id: "general", href: "/settings/general", icon: Settings2 },
  { id: "personalization", href: "/settings/personalization", icon: Brain },
  { id: "tools", href: "/settings/tools", icon: Wrench },
];

const ACCOUNT_ITEMS: Item[] = [
  { id: "profile", href: "/settings/profile", icon: UserRound },
  { id: "security", href: "/settings/account", icon: KeyRound },
  { id: "data", href: "/settings/data", icon: Database },
];

const ADMIN_ITEMS: Item[] = [
  { id: "models", href: "/settings/models", icon: Cpu },
  {
    id: "services",
    href: "/settings/services",
    icon: ServerCog,
  },
  {
    id: "agents",
    href: "/settings/connections",
    icon: Bot,
    beta: true,
  },
  { id: "users", href: "/settings/users", icon: Users },
];

const USER_GROUPS: Group[] = [
  { id: "preferences", items: PREFERENCE_ITEMS },
  { id: "account", items: ACCOUNT_ITEMS },
];

const ADMIN_GROUP: Group = {
  id: "administration",
  items: ADMIN_ITEMS,
};

export function SettingsNav() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user?.role === "admin";

  const groups = isAdmin ? [...USER_GROUPS, ADMIN_GROUP] : USER_GROUPS;
  const currentItem =
    groups
      .flatMap((group) => group.items)
      .find((item) => isActive(item, pathname)) ?? PREFERENCE_ITEMS[0];
  const CurrentIcon = currentItem.icon;

  return (
    <nav aria-label={t("settings.nav.ariaLabel")} className="w-full md:space-y-4">
      <div className="md:hidden">
        <Select
          value={currentItem.href}
          onValueChange={(href) => {
            if (href && href !== currentItem.href) void navigate({ to: href });
          }}
        >
          <SelectTrigger aria-label={t("settings.nav.pageSelectLabel")} className="w-full">
            <SelectValue>
              <CurrentIcon className="size-3.5" />
              <span>{t(`settings.nav.items.${currentItem.id}`)}</span>
              {currentItem.beta && <BetaBadge />}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {groups.map((group) => (
              <SelectGroup key={group.id}>
                <SelectLabel>{t(`settings.nav.groups.${group.id}`)}</SelectLabel>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SelectItem key={item.href} value={item.href}>
                      <Icon className="size-3.5" />
                      <span>{t(`settings.nav.items.${item.id}`)}</span>
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
          key={group.id}
          label={t(`settings.nav.groups.${group.id}`)}
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
  const { t } = useTranslation();
  const active = isActive(item, pathname);
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm motion-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span>{t(`settings.nav.items.${item.id}`)}</span>
      {item.beta && <BetaBadge />}
      <LinkPendingIndicator to={item.href} />
    </Link>
  );
}

function isActive(item: Item, pathname: string) {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

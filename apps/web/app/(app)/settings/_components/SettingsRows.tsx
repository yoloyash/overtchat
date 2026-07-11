import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SettingsSectionProps) {
  return (
    <section className={cn("@container space-y-3", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children ? (
        <div className={cn("divide-y divide-border/70 border-y", contentClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

interface SettingsPageHeaderProps {
  title: string;
  description?: React.ReactNode;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function SettingsPageHeader({
  title,
  description,
  leading,
  action,
  className,
}: SettingsPageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

interface SettingsRowProps {
  title: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
  align?: "start" | "center";
  className?: string;
}

export function SettingsRow({
  title,
  description,
  htmlFor,
  children,
  align = "start",
  className,
}: SettingsRowProps) {
  const titleClass = "text-sm font-medium leading-5 text-foreground";
  const titleNode = htmlFor ? (
    <Label htmlFor={htmlFor} className={titleClass}>
      {title}
    </Label>
  ) : (
    <div className={titleClass}>{title}</div>
  );

  return (
    <div
      className={cn(
        "grid gap-3 py-4 @2xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] @2xl:gap-6",
        align === "center" && "@2xl:items-center",
        className,
      )}
    >
      <div className="min-w-0">
        {titleNode}
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface SettingsActionsProps {
  children: React.ReactNode;
  className?: string;
  bordered?: boolean;
}

export function SettingsActions({
  children,
  className,
  bordered = true,
}: SettingsActionsProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2",
        bordered && "border-t pt-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SettingsNoticeProps {
  children: React.ReactNode;
  tone?: "muted" | "success" | "error";
  className?: string;
}

export function SettingsNotice({
  children,
  tone = "muted",
  className,
}: SettingsNoticeProps) {
  return (
    <p
      className={cn(
        "text-sm leading-5",
        tone === "muted" && "text-muted-foreground",
        tone === "success" && "text-ring",
        tone === "error" && "text-destructive",
        className,
      )}
    >
      {children}
    </p>
  );
}

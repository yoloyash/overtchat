import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function SettingsPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "@container/settings w-full max-w-4xl space-y-8 [&_[data-slot=input]]:h-10 [&_[data-slot=select-trigger]]:h-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsEmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      )}
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </div>
  );
}

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
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-6 tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children ? (
        <div
          className={cn("divide-y divide-border/70 border-y", contentClassName)}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

interface SettingsPageHeaderProps {
  title: React.ReactNode;
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
    <header className={cn("@container", className)}>
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start @2xl:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}

interface SettingsRowProps {
  title: string;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  align?: "start" | "center";
  controlAlign?: "start" | "end" | "stretch";
  controlClassName?: string;
  layout?: "field" | "toggle";
  className?: string;
}

export function SettingsRow({
  title,
  description,
  htmlFor,
  children,
  align = "center",
  controlAlign = "stretch",
  controlClassName,
  layout = "field",
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
        "grid gap-3 py-4 @2xl:gap-8",
        layout === "toggle"
          ? "grid-cols-[minmax(0,1fr)_auto] items-center"
          : "@2xl:grid-cols-2",
        align === "center" && "items-center",
        className,
      )}
    >
      <div className="min-w-0 break-words">
        {titleNode}
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div
        className={cn(
          "min-w-0",
          controlAlign === "start" && "flex justify-start",
          controlAlign === "end" && "flex justify-end",
          controlClassName,
        )}
      >
        {children}
      </div>
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
        "flex flex-wrap items-center justify-end gap-2",
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
      role={
        tone === "error" ? "alert" : tone === "success" ? "status" : undefined
      }
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

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
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
        <div className="divide-y divide-border/70 border-y">{children}</div>
      ) : null}
    </section>
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
        "grid gap-3 py-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-6",
        align === "center" && "lg:items-center",
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

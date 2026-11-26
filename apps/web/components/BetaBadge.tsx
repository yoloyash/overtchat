import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function BetaBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border bg-muted/50 px-1.5 py-0.5 text-[9px] font-medium leading-none tracking-normal text-muted-foreground normal-case",
        className,
      )}
    >
      {t("app.shell.beta")}
    </span>
  );
}

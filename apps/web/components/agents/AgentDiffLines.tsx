import { cn } from "@/lib/utils";

/** The lines of a unified diff, coloured by what each one adds or removes. */
export function AgentDiffLines({
  value,
  wrap = false,
}: {
  value: string;
  wrap?: boolean;
}) {
  return value.split("\n").map((line, index) => (
    <span
      key={index}
      className={cn(
        "block px-3",
        wrap
          ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
          : "min-w-max whitespace-pre",
        line.startsWith("+") &&
          !line.startsWith("+++") &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        line.startsWith("-") &&
          !line.startsWith("---") &&
          "bg-red-500/10 text-red-700 dark:text-red-300",
        (line.startsWith("@@") || line.startsWith("\\")) &&
          "text-muted-foreground",
      )}
    >
      {line || " "}
    </span>
  ));
}

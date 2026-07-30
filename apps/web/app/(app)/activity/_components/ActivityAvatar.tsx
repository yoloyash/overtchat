import { cn } from "@/lib/utils";
import { initials } from "./activity-format";

const AVATAR_STYLES = [
  "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
];

function avatarStyle(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return AVATAR_STYLES[hash % AVATAR_STYLES.length];
}

export function ActivityAvatar({
  id,
  name,
  image,
  size = "md",
}: {
  id: string;
  name: string;
  image: string | null;
  size?: "md" | "lg";
}) {
  return (
    <span
      role="img"
      aria-label={`${name} avatar`}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        avatarStyle(id),
        size === "lg" ? "size-16 text-lg md:size-20 md:text-xl" : "size-9 text-xs",
      )}
      style={
        image
          ? {
              backgroundImage: `url(${image})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      {!image && initials(name)}
    </span>
  );
}

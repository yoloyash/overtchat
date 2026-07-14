export const routeTransitionTypes = {
  chat: "route-chat",
  project: "route-project",
  settings: "route-settings",
  auth: "route-auth",
  home: "route-home",
  samePane: "route-same-pane",
} as const;

export type RouteTransitionType =
  (typeof routeTransitionTypes)[keyof typeof routeTransitionTypes];

export type MotionNavigateOptions = {
  scroll?: boolean;
  transitionTypes?: string[];
};

export const motionClasses = {
  interactive: "motion-colors",
  opacity: "motion-opacity",
  transform: "motion-transform",
  hoverReveal:
    "opacity-0 motion-opacity group-hover:opacity-100 focus-within:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100",
  overlay:
    "motion-overlay data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
  dialog:
    "motion-surface data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0",
  palette:
    "motion-surface data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0",
  drawer:
    "motion-transform data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full",
  popup:
    "origin-(--transform-origin) motion-surface data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
  selectPopup:
    "origin-(--transform-origin) duration-(--motion-duration-fast) data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
  toast:
    "motion-surface data-[swiping]:transition-none data-[starting-style]:translate-x-6 data-[starting-style]:opacity-0 data-[ending-style]:translate-x-6 data-[ending-style]:opacity-0",
  collapse: "motion-collapse",
  spinner: "animate-spin motion-reduce:animate-none",
  shimmer: "animate-text-shimmer motion-reduce:animate-none",
  pendingDot: "animate-bounce motion-reduce:animate-none",
  dropIcon: "animate-in zoom-in-95 motion-reduce:animate-none",
  linkPending: "animate-pulse motion-reduce:animate-none",
} as const;

export function transitionTypesForHref(href: string): RouteTransitionType[] {
  if (href === "/" || href.startsWith("/?")) return [routeTransitionTypes.home];
  if (href.startsWith("/chat/")) return [routeTransitionTypes.chat];
  if (href.startsWith("/projects/")) return [routeTransitionTypes.project];
  if (href === "/settings" || href.startsWith("/settings/")) {
    return [routeTransitionTypes.settings];
  }
  if (href === "/login" || href === "/signup") {
    return [routeTransitionTypes.auth];
  }
  return [routeTransitionTypes.samePane];
}

type UrlLike = {
  pathname?: string | null;
  query?:
    | string
    | Record<
        string,
        string | string[] | number | boolean | null | undefined
      >
    | null;
  hash?: string | null;
};

export function transitionTypesForUrl(
  href: unknown,
): RouteTransitionType[] {
  if (typeof href === "string") return transitionTypesForHref(href);
  if (href instanceof URL) {
    return transitionTypesForHref(`${href.pathname}${href.search}${href.hash}`);
  }

  const url = (href ?? {}) as UrlLike;
  const pathname = url.pathname ?? "/";
  const hash = url.hash ? `#${url.hash.replace(/^#/, "")}` : "";
  if (typeof url.query === "string") {
    const query = url.query ? `?${url.query.replace(/^\?/, "")}` : "";
    return transitionTypesForHref(`${pathname}${query}${hash}`);
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(url.query ?? {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, String(value));
    }
  }

  const query = params.size ? `?${params.toString()}` : "";
  return transitionTypesForHref(`${pathname}${query}${hash}`);
}

export function motionNavigateOptions(
  href: string,
  options?: MotionNavigateOptions,
): MotionNavigateOptions {
  return {
    ...options,
    transitionTypes: options?.transitionTypes ?? transitionTypesForHref(href),
  };
}

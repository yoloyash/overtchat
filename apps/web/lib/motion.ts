export const motionClasses = {
  hoverReveal:
    "opacity-0 motion-opacity group-hover:opacity-100 focus-within:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100",
  overlay:
    "motion-overlay data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
  dialog:
    "motion-surface data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0",
  palette:
    "motion-surface data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0",
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
} as const;

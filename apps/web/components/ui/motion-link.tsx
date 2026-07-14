"use client";

import Link, { useLinkStatus } from "next/link";
import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { motionClasses, transitionTypesForUrl } from "@/lib/motion";

type MotionLinkProps = ComponentProps<typeof Link> & {
  pendingHint?: boolean;
  pendingHintClassName?: string;
};

export const MotionLink = forwardRef<HTMLAnchorElement, MotionLinkProps>(
  function MotionLink(
    {
      href,
      transitionTypes,
      pendingHint = false,
      pendingHintClassName,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <Link
        ref={ref}
        href={href}
        transitionTypes={transitionTypes ?? transitionTypesForUrl(href)}
        {...props}
      >
        {children}
        {pendingHint && <LinkPendingHint className={pendingHintClassName} />}
      </Link>
    );
  },
);

function LinkPendingHint({ className }: { className?: string }) {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden
      className={cn(
        "ml-auto size-1.5 shrink-0 rounded-full bg-current opacity-0 motion-opacity",
        pending && `opacity-60 ${motionClasses.linkPending}`,
        className,
      )}
    />
  );
}

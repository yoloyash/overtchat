"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motionNavigateOptions, type MotionNavigateOptions } from "@/lib/motion";

export function useMotionRouter() {
  const router = useRouter();

  const push = useCallback(
    (href: string, options?: MotionNavigateOptions) => {
      router.push(href, motionNavigateOptions(href, options));
    },
    [router],
  );

  const replace = useCallback(
    (href: string, options?: MotionNavigateOptions) => {
      router.replace(href, motionNavigateOptions(href, options));
    },
    [router],
  );

  return useMemo(
    () => ({
      ...router,
      push,
      replace,
    }),
    [push, replace, router],
  );
}

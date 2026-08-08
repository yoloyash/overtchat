"use client";

import { useSyncExternalStore } from "react";
import { MOBILE_SIDEBAR_QUERY } from "@/lib/sidebar";

let mediaQuery: MediaQueryList | undefined;

function getMediaQuery() {
  mediaQuery ??= window.matchMedia(MOBILE_SIDEBAR_QUERY);
  return mediaQuery;
}

function subscribe(onStoreChange: () => void) {
  const query = getMediaQuery();
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  return getMediaQuery().matches;
}

function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

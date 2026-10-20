import {
  type ChatReasoningLevel,
  REASONING_EFFORTS,
} from "@overtchat/shared";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

const KEY = "overtchat.reasoningLevels";

type ReasoningLevels = Record<string, ChatReasoningLevel>;

function isReasoningLevel(value: unknown): value is ChatReasoningLevel {
  return (
    value === "default" ||
    value === "off" ||
    value === "on" ||
    REASONING_EFFORTS.includes(value as (typeof REASONING_EFFORTS)[number])
  );
}

function read(): ReasoningLevels {
  const raw = SecureStore.getItem(KEY);
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([modelId, level]) => modelId.length > 0 && isReasoningLevel(level),
      ),
    );
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
let cached = read();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return cached;
}

export function useReasoningLevels(): ReasoningLevels {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setReasoningLevel(
  modelId: string,
  level: ChatReasoningLevel,
) {
  if (cached[modelId] === level) return;
  cached = { ...cached, [modelId]: level };
  SecureStore.setItem(KEY, JSON.stringify(cached));
  listeners.forEach((callback) => callback());
}

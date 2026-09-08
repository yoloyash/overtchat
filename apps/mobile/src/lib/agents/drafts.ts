import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type {
  AgentPromptImage,
  AgentSessionCommand,
} from "@overtchat/agent-bridge";
import { getApiBase } from "@/lib/api";
import { getAuthClient } from "@/lib/auth/client";

export type DraftImage = AgentPromptImage & { size: number; uri: string };
export type AgentDraft = {
  message: string;
  images: DraftImage[];
  pending?: { fingerprint: string; command: AgentSessionCommand };
};
const empty: AgentDraft = { message: "", images: [] };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const directory = new Directory(Paths.document, "agent-drafts");
const file = new File(directory, "drafts.json");
let drafts: Record<string, AgentDraft> | undefined;

function read() {
  if (!drafts) {
    try {
      drafts = file.exists ? JSON.parse(file.textSync()) : {};
    } catch {
      drafts = {};
    }
  }
  return drafts!;
}

export function useAgentDraft(id: string) {
  const session = getAuthClient().useSession();
  const server = getApiBase();
  const key = JSON.stringify([server, session.data?.user.id, id]);
  const draft = useSyncExternalStore(
    subscribe,
    () => read()[key] ?? empty,
    () => empty,
  );
  const [storageError, setStorageError] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function flush() {
    clearTimeout(timer.current);
    try {
      directory.create({ intermediates: true, idempotent: true });
      file.write(JSON.stringify(read()));
      setStorageError(undefined);
    } catch {
      setStorageError("Couldn't save this draft on your device.");
    }
  }
  function setDraft(
    next: AgentDraft | ((draft: AgentDraft) => AgentDraft),
    immediate = false,
  ) {
    const value =
      typeof next === "function" ? next(read()[key] ?? empty) : next;
    if (!value.message && !value.images.length && !value.pending)
      delete read()[key];
    else read()[key] = value;
    listeners.forEach((listener) => listener());
    clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = setTimeout(flush, 300);
  }
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      listener.remove();
      flush();
    };
    // Drafts are scoped to both the selected server and the signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  function saveDraftToSession(
    sessionId: string,
    next: AgentDraft | ((draft: AgentDraft) => AgentDraft),
  ) {
    const targetKey = JSON.stringify([
      server,
      session.data?.user.id,
      sessionId,
    ]);
    const value =
      typeof next === "function" ? next(read()[targetKey] ?? empty) : next;
    if (!value.message && !value.images.length && !value.pending)
      delete read()[targetKey];
    else read()[targetKey] = value;
    listeners.forEach((listener) => listener());
    flush();
  }
  return { draft, setDraft, storageError, saveDraftToSession };
}

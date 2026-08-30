"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from "./composer-drafts";

const SAVE_DELAY_MS = 400;

interface DraftIdentity {
  userId: string;
  scope: string;
}

export function useComposerDraft({
  userId,
  scope,
  enabled,
  onRestore,
}: {
  userId?: string;
  scope: string | null;
  enabled: boolean;
  onRestore?: (text: string) => void;
}) {
  const [value, setStoredValue] = useState("");
  const valueRef = useRef(value);
  const identityRef = useRef<DraftIdentity | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduledSave = useCallback(() => {
    if (saveTimerRef.current === null) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  const persist = useCallback(
    (identity: DraftIdentity, text: string) =>
      writeComposerDraft(identity.userId, identity.scope, text),
    [],
  );

  const setValue = useCallback(
    (nextValue: SetStateAction<string>) => {
      const next =
        typeof nextValue === "function"
          ? nextValue(valueRef.current)
          : nextValue;
      valueRef.current = next;
      dirtyRef.current = true;
      setStoredValue(next);

      const identity = identityRef.current;
      if (!identity) return;
      cancelScheduledSave();
      if (next === "") {
        clearComposerDraft(identity.userId, identity.scope);
        dirtyRef.current = false;
        return;
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        if (persist(identity, valueRef.current)) dirtyRef.current = false;
      }, SAVE_DELAY_MS);
    },
    [cancelScheduledSave, persist],
  );

  const clear = useCallback(() => {
    cancelScheduledSave();
    valueRef.current = "";
    dirtyRef.current = false;
    setStoredValue("");
    const identity = identityRef.current;
    if (identity) clearComposerDraft(identity.userId, identity.scope);
  }, [cancelScheduledSave]);

  useEffect(() => {
    const nextIdentity = enabled && userId && scope ? { userId, scope } : null;
    const previousIdentity = identityRef.current;
    if (
      previousIdentity?.userId === nextIdentity?.userId &&
      previousIdentity?.scope === nextIdentity?.scope
    ) {
      return;
    }

    cancelScheduledSave();

    if (previousIdentity) {
      if (nextIdentity) {
        if (dirtyRef.current) persist(previousIdentity, valueRef.current);
      } else {
        // Disabling persistence means temporary/private mode or loss of the
        // authenticated owner. Keep the visible text, but remove its disk copy.
        clearComposerDraft(previousIdentity.userId, previousIdentity.scope);
      }
      dirtyRef.current = false;
    }

    identityRef.current = nextIdentity;
    if (!nextIdentity) return;

    // The session can resolve after the user has started typing. Their live
    // input wins over an older stored value and becomes the new draft.
    if (!previousIdentity && valueRef.current !== "") {
      persist(nextIdentity, valueRef.current);
      dirtyRef.current = false;
      return;
    }

    const restored = readComposerDraft(nextIdentity.userId, nextIdentity.scope);
    valueRef.current = restored;
    dirtyRef.current = false;
    const restoreFrame = requestAnimationFrame(() => {
      if (
        identityRef.current?.userId !== nextIdentity.userId ||
        identityRef.current.scope !== nextIdentity.scope ||
        valueRef.current !== restored
      ) {
        return;
      }
      setStoredValue(restored);
      if (restored !== "") onRestore?.(restored);
    });
    return () => cancelAnimationFrame(restoreFrame);
  }, [cancelScheduledSave, enabled, onRestore, persist, scope, userId]);

  useEffect(() => {
    const flush = () => {
      cancelScheduledSave();
      const identity = identityRef.current;
      if (identity && dirtyRef.current) {
        if (persist(identity, valueRef.current)) dirtyRef.current = false;
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [cancelScheduledSave, persist]);

  return { value, setValue, clear };
}

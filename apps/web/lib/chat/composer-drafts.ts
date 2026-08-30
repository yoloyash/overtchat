const STORAGE_PREFIX = "overtchat_composer_draft:v1:";

export const MAX_COMPOSER_DRAFTS_PER_USER = 100;

export interface ComposerDraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredComposerDraft {
  version: 1;
  text: string;
  updatedAt: number;
}

interface DraftEntry {
  key: string;
  updatedAt: number;
}

export function chatComposerDraftScope(chatId: string): string {
  return `chat:${chatId}`;
}

export function newChatComposerDraftScope(projectId?: string | null): string {
  return projectId ? `new:project:${projectId}` : "new:root";
}

export function readComposerDraft(
  userId: string,
  scope: string,
  storage: ComposerDraftStorage | null = browserStorage(),
): string {
  if (!storage) return "";
  const key = draftKey(userId, scope);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return "";
    const parsed = parseDraft(raw);
    if (!parsed) {
      storage.removeItem(key);
      return "";
    }
    return parsed.text;
  } catch {
    return "";
  }
}

export function writeComposerDraft(
  userId: string,
  scope: string,
  text: string,
  options: {
    storage?: ComposerDraftStorage | null;
    now?: number;
  } = {},
): boolean {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  if (!storage) return false;
  if (text === "") {
    clearComposerDraft(userId, scope, storage);
    return true;
  }

  const key = draftKey(userId, scope);
  const value = JSON.stringify({
    version: 1,
    text,
    updatedAt: options.now ?? Date.now(),
  } satisfies StoredComposerDraft);

  try {
    storage.setItem(key, value);
  } catch (error) {
    if (!isQuotaExceeded(error)) return false;
    if (!makeRoomForDraft(storage, userId, key, value)) return false;
  }

  pruneUserDrafts(storage, userId, MAX_COMPOSER_DRAFTS_PER_USER);
  return true;
}

export function clearComposerDraft(
  userId: string,
  scope: string,
  storage: ComposerDraftStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(userId, scope));
  } catch {
    // Browser privacy settings can make storage unavailable. Draft cleanup
    // must never interfere with sending a message.
  }
}

export function clearComposerDraftScope(
  scope: string,
  storage: ComposerDraftStorage | null = browserStorage(),
): void {
  if (!storage) return;
  const suffix = `:${encodeURIComponent(scope)}`;
  for (const key of storageKeys(storage)) {
    if (!key.startsWith(STORAGE_PREFIX) || !key.endsWith(suffix)) continue;
    try {
      storage.removeItem(key);
    } catch {
      return;
    }
  }
}

export function clearComposerDraftsForUser(
  userId: string,
  storage: ComposerDraftStorage | null = browserStorage(),
): void {
  if (!storage) return;
  const prefix = userPrefix(userId);
  for (const key of storageKeys(storage)) {
    if (!key.startsWith(prefix)) continue;
    try {
      storage.removeItem(key);
    } catch {
      return;
    }
  }
}

function browserStorage(): ComposerDraftStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function draftKey(userId: string, scope: string): string {
  return `${userPrefix(userId)}${encodeURIComponent(scope)}`;
}

function userPrefix(userId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:`;
}

function parseDraft(raw: string): StoredComposerDraft | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredComposerDraft> | null;
    if (
      value?.version !== 1 ||
      typeof value.text !== "string" ||
      typeof value.updatedAt !== "number" ||
      !Number.isFinite(value.updatedAt)
    ) {
      return null;
    }
    return value as StoredComposerDraft;
  } catch {
    return null;
  }
}

function storageKeys(storage: ComposerDraftStorage): string[] {
  try {
    return Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    ).filter((key): key is string => key !== null);
  } catch {
    return [];
  }
}

function userDraftEntries(
  storage: ComposerDraftStorage,
  userId: string,
): DraftEntry[] {
  const prefix = userPrefix(userId);
  const entries: DraftEntry[] = [];
  for (const key of storageKeys(storage)) {
    if (!key.startsWith(prefix)) continue;
    try {
      const raw = storage.getItem(key);
      const draft = raw === null ? null : parseDraft(raw);
      if (!draft) {
        storage.removeItem(key);
        continue;
      }
      entries.push({ key, updatedAt: draft.updatedAt });
    } catch {
      // A single unreadable entry should not prevent other drafts from saving.
    }
  }
  return entries.sort((left, right) => left.updatedAt - right.updatedAt);
}

function pruneUserDrafts(
  storage: ComposerDraftStorage,
  userId: string,
  limit: number,
): void {
  const prefix = userPrefix(userId);
  const keys = storageKeys(storage).filter((key) => key.startsWith(prefix));
  if (keys.length <= limit) return;
  const entries = userDraftEntries(storage, userId);
  for (const { key } of entries.slice(0, Math.max(0, entries.length - limit))) {
    try {
      storage.removeItem(key);
    } catch {
      return;
    }
  }
}

function makeRoomForDraft(
  storage: ComposerDraftStorage,
  userId: string,
  targetKey: string,
  value: string,
): boolean {
  const candidates = userDraftEntries(storage, userId).filter(
    ({ key }) => key !== targetKey,
  );
  for (const { key } of candidates) {
    try {
      storage.removeItem(key);
      storage.setItem(targetKey, value);
      return true;
    } catch (error) {
      if (!isQuotaExceeded(error)) return false;
    }
  }
  return false;
}

function isQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "QuotaExceededError" || candidate.code === 22;
}

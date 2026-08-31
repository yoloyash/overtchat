const STORAGE_PREFIX = "overtchat_composer_draft:v1:";

export type ComposerDraftStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

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
  try {
    return storage.getItem(draftKey(userId, scope)) ?? "";
  } catch {
    return "";
  }
}

export function writeComposerDraft(
  userId: string,
  scope: string,
  text: string,
  storage: ComposerDraftStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const key = draftKey(userId, scope);
    if (text === "") storage.removeItem(key);
    else storage.setItem(key, text);
    return true;
  } catch {
    // Draft persistence is best-effort and must not interrupt composing.
    return false;
  }
}

export function clearComposerDraft(
  userId: string,
  scope: string,
  storage: ComposerDraftStorage | null = browserStorage(),
): void {
  writeComposerDraft(userId, scope, "", storage);
}

export function clearComposerDraftsForUser(
  userId: string,
  storage: ComposerDraftStorage | null = browserStorage(),
): void {
  if (!storage) return;
  const prefix = userPrefix(userId);
  try {
    const keys = Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    );
    for (const key of keys) {
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable under browser privacy restrictions.
  }
}

function browserStorage(): Storage | null {
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

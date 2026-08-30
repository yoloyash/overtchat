import { describe, expect, it } from "vitest";
import {
  MAX_COMPOSER_DRAFTS_PER_USER,
  chatComposerDraftScope,
  clearComposerDraft,
  clearComposerDraftScope,
  clearComposerDraftsForUser,
  newChatComposerDraftScope,
  readComposerDraft,
  writeComposerDraft,
  type ComposerDraftStorage,
} from "./composer-drafts";

class MemoryStorage implements ComposerDraftStorage {
  protected readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class QuotaStorage extends MemoryStorage {
  constructor(private readonly maximumEntries: number) {
    super();
  }

  override setItem(key: string, value: string) {
    if (!this.values.has(key) && this.values.size >= this.maximumEntries) {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    }
    super.setItem(key, value);
  }
}

describe("composer drafts", () => {
  it("builds stable scopes for saved, root, and project chats", () => {
    expect(chatComposerDraftScope("chat-1")).toBe("chat:chat-1");
    expect(newChatComposerDraftScope()).toBe("new:root");
    expect(newChatComposerDraftScope("project-1")).toBe(
      "new:project:project-1",
    );
  });

  it("round-trips exact text while isolating users and conversations", () => {
    const storage = new MemoryStorage();
    const text = "  hello 🌲\n\n  indented  ";
    writeComposerDraft("user-a", "chat:a", text, { storage, now: 1 });

    expect(readComposerDraft("user-a", "chat:a", storage)).toBe(text);
    expect(readComposerDraft("user-a", "chat:b", storage)).toBe("");
    expect(readComposerDraft("user-b", "chat:a", storage)).toBe("");
  });

  it("clears only the requested draft when the input becomes empty", () => {
    const storage = new MemoryStorage();
    writeComposerDraft("user", "chat:a", "draft a", { storage, now: 1 });
    writeComposerDraft("user", "chat:b", "draft b", { storage, now: 2 });

    expect(writeComposerDraft("user", "chat:a", "", { storage })).toBe(true);
    expect(readComposerDraft("user", "chat:a", storage)).toBe("");
    expect(readComposerDraft("user", "chat:b", storage)).toBe("draft b");

    clearComposerDraft("user", "chat:b", storage);
    expect(readComposerDraft("user", "chat:b", storage)).toBe("");
  });

  it("drops malformed records without affecting valid drafts", () => {
    const storage = new MemoryStorage();
    storage.setItem("overtchat_composer_draft:v1:user:chat%3Abad", "not json");
    writeComposerDraft("user", "chat:good", "kept", { storage, now: 1 });

    expect(readComposerDraft("user", "chat:bad", storage)).toBe("");
    expect(readComposerDraft("user", "chat:good", storage)).toBe("kept");
    expect(storage.length).toBe(1);
  });

  it("keeps only the most recently updated bounded set", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index <= MAX_COMPOSER_DRAFTS_PER_USER; index += 1) {
      writeComposerDraft("user", `chat:${index}`, `draft ${index}`, {
        storage,
        now: index,
      });
    }

    expect(storage.length).toBe(MAX_COMPOSER_DRAFTS_PER_USER);
    expect(readComposerDraft("user", "chat:0", storage)).toBe("");
    expect(
      readComposerDraft(
        "user",
        `chat:${MAX_COMPOSER_DRAFTS_PER_USER}`,
        storage,
      ),
    ).toBe(`draft ${MAX_COMPOSER_DRAFTS_PER_USER}`);
  });

  it("evicts the oldest user draft and retries a quota-limited write", () => {
    const storage = new QuotaStorage(2);
    writeComposerDraft("user", "chat:old", "old", { storage, now: 1 });
    writeComposerDraft("other", "chat:other", "other", { storage, now: 1 });

    expect(
      writeComposerDraft("user", "chat:new", "new", { storage, now: 2 }),
    ).toBe(true);
    expect(readComposerDraft("user", "chat:old", storage)).toBe("");
    expect(readComposerDraft("user", "chat:new", storage)).toBe("new");
    expect(readComposerDraft("other", "chat:other", storage)).toBe("other");
  });

  it("can clear a chat across users and all drafts for one user", () => {
    const storage = new MemoryStorage();
    writeComposerDraft("user-a", "chat:shared", "a", { storage, now: 1 });
    writeComposerDraft("user-b", "chat:shared", "b", { storage, now: 2 });
    writeComposerDraft("user-b", "chat:kept", "kept", { storage, now: 3 });

    clearComposerDraftScope("chat:shared", storage);
    expect(readComposerDraft("user-a", "chat:shared", storage)).toBe("");
    expect(readComposerDraft("user-b", "chat:shared", storage)).toBe("");
    expect(readComposerDraft("user-b", "chat:kept", storage)).toBe("kept");

    clearComposerDraftsForUser("user-b", storage);
    expect(readComposerDraft("user-b", "chat:kept", storage)).toBe("");
  });

  it("treats unavailable storage as a non-fatal best-effort failure", () => {
    const storage: ComposerDraftStorage = {
      get length(): number {
        throw new DOMException("Denied", "SecurityError");
      },
      key: () => null,
      getItem: () => {
        throw new DOMException("Denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Denied", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("Denied", "SecurityError");
      },
    };

    expect(readComposerDraft("user", "chat", storage)).toBe("");
    expect(writeComposerDraft("user", "chat", "text", { storage })).toBe(false);
    expect(() => clearComposerDraft("user", "chat", storage)).not.toThrow();
  });
});

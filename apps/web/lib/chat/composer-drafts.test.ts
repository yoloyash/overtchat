import { describe, expect, it } from "vitest";
import {
  chatComposerDraftScope,
  clearComposerDraft,
  clearComposerDraftsForUser,
  newChatComposerDraftScope,
  readComposerDraft,
  writeComposerDraft,
  type ComposerDraftStorage,
} from "./composer-drafts";

class MemoryStorage implements ComposerDraftStorage {
  private readonly values = new Map<string, string>();

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
    writeComposerDraft("user-a", "chat:a", text, storage);

    expect(readComposerDraft("user-a", "chat:a", storage)).toBe(text);
    expect(readComposerDraft("user-a", "chat:b", storage)).toBe("");
    expect(readComposerDraft("user-b", "chat:a", storage)).toBe("");
  });

  it("clears one draft or all drafts for a user", () => {
    const storage = new MemoryStorage();
    writeComposerDraft("user-a", "chat:a", "draft a", storage);
    writeComposerDraft("user-a", "chat:b", "draft b", storage);
    writeComposerDraft("user-b", "chat:a", "kept", storage);

    clearComposerDraft("user-a", "chat:a", storage);
    expect(readComposerDraft("user-a", "chat:a", storage)).toBe("");
    expect(readComposerDraft("user-a", "chat:b", storage)).toBe("draft b");

    clearComposerDraftsForUser("user-a", storage);
    expect(readComposerDraft("user-a", "chat:b", storage)).toBe("");
    expect(readComposerDraft("user-b", "chat:a", storage)).toBe("kept");
  });

  it("treats unavailable storage as a best-effort failure", () => {
    const storage = new MemoryStorage();
    storage.getItem = () => {
      throw new DOMException("Denied", "SecurityError");
    };
    storage.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };

    expect(readComposerDraft("user", "chat", storage)).toBe("");
    expect(writeComposerDraft("user", "chat", "text", storage)).toBe(false);
  });
});

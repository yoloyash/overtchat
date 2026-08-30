import type { UIMessagePart, UIDataTypes, UITools } from "ai";
import type { ChatKind } from "@overtchat/shared";

export type ImportedPart = UIMessagePart<UIDataTypes, UITools>;

export type ImportedMessage = {
  role: "user" | "assistant" | "system";
  parts: ImportedPart[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export type ImportedChat = {
  title: string;
  kind?: ChatKind;
  createdAt: Date;
  messages: ImportedMessage[];
};

export type ImportFormat = "ours" | "chatgpt" | "claude" | "openwebui";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

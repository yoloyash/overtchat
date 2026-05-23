import type { UIMessagePart, UIDataTypes, UITools } from "ai";

export type ImportedPart = UIMessagePart<UIDataTypes, UITools>;

export type ImportedMessage = {
  role: "user" | "assistant" | "system";
  parts: ImportedPart[];
  createdAt: Date;
};

export type ImportedChat = {
  title: string;
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

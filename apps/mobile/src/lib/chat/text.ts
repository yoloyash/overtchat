import type { UIMessage } from "ai";
import { readableMessageText } from "@overtchat/shared";

export function textOf(message: UIMessage): string {
  return readableMessageText(message);
}

import {
  AGENT_TERMINAL_MAX_INPUT_CHARS,
  AGENT_TERMINAL_MAX_OUTPUT_CHARS,
  AGENT_TERMINAL_MAX_SNAPSHOT_CHARS,
  AGENT_TERMINAL_MAX_COLUMNS,
  AGENT_TERMINAL_MAX_ROWS,
  type AgentTerminalSize,
  type AgentTerminalEvent,
  type AgentTerminalSnapshot,
} from "./agents";
import { isAgentDaemonWorkspaceDescriptor, type AgentDaemonWorkspaceDescriptor } from "./index";

export const TERMINAL_STREAM_PROTOCOL = "overtchat-terminal-v1";
export const TERMINAL_SOCKET_PATH = "/api/agent-terminals/socket";
export const TERMINAL_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export type TerminalControl =
  | { type: "input"; data: string }
  | { type: "resize"; size: AgentTerminalSize; claim?: boolean }
  | { type: "restart"; size: AgentTerminalSize }
  | { type: "kill" };
export type TerminalHostMessage =
  | { type: "attach"; streamId: string; workspace: AgentDaemonWorkspaceDescriptor; size: AgentTerminalSize }
  | { type: "detach"; streamId: string }
  | { type: "control"; streamId: string; control: TerminalControl };
export type TerminalViewMessage =
  | { type: "snapshot"; snapshot: AgentTerminalSnapshot }
  | AgentTerminalEvent
  | { type: "error"; message: string };
export type TerminalHostReply = { streamId: string; message: TerminalViewMessage };

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
export function isAgentTerminalSize(value: unknown): value is AgentTerminalSize {
  return record(value) && Number.isInteger(value.cols) && Number(value.cols) >= 2 &&
    Number(value.cols) <= AGENT_TERMINAL_MAX_COLUMNS && Number.isInteger(value.rows) &&
    Number(value.rows) >= 1 && Number(value.rows) <= AGENT_TERMINAL_MAX_ROWS;
}
export function isAgentTerminalSnapshot(value: unknown): value is AgentTerminalSnapshot {
  if (!record(value) || !isAgentTerminalSize(value)) return false;
  const data = value as unknown as Record<string, unknown>;
  return id(data.workspaceId) && revision(data.revision) && typeof data.data === "string" &&
    data.data.length <= AGENT_TERMINAL_MAX_SNAPSHOT_CHARS && typeof data.exited === "boolean" &&
    (data.exitCode === null || Number.isSafeInteger(data.exitCode)) &&
    (data.signal === null || Number.isSafeInteger(data.signal));
}
export function isTerminalControl(value: unknown): value is TerminalControl {
  if (!record(value)) return false;
  switch (value.type) {
    case "input": return typeof value.data === "string" && value.data.length > 0 && value.data.length <= AGENT_TERMINAL_MAX_INPUT_CHARS;
    case "resize": return isAgentTerminalSize(value.size) && (value.claim === undefined || typeof value.claim === "boolean");
    case "restart": return isAgentTerminalSize(value.size);
    case "kill": return true;
    default: return false;
  }
}
export function isTerminalHostMessage(value: unknown): value is TerminalHostMessage {
  if (!record(value) || !id(value.streamId)) return false;
  switch (value.type) {
    case "attach": return isAgentDaemonWorkspaceDescriptor(value.workspace) && isAgentTerminalSize(value.size);
    case "detach": return true;
    case "control": return isTerminalControl(value.control);
    default: return false;
  }
}
export function isTerminalViewMessage(value: unknown): value is TerminalViewMessage {
  if (!record(value)) return false;
  switch (value.type) {
    case "snapshot": return isAgentTerminalSnapshot(value.snapshot);
    case "output": return revision(value.revision) && typeof value.data === "string" && value.data.length <= AGENT_TERMINAL_MAX_OUTPUT_CHARS;
    case "exit": return revision(value.revision) && (value.exitCode === null || Number.isSafeInteger(value.exitCode)) && (value.signal === null || Number.isSafeInteger(value.signal));
    case "error": return typeof value.message === "string" && value.message.length <= 4096;
    default: return false;
  }
}
export function isTerminalHostReply(value: unknown): value is TerminalHostReply {
  return record(value) && id(value.streamId) && isTerminalViewMessage(value.message);
}

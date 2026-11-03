import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Keyboard: { dismiss: () => {} },
  Pressable: () => null,
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => {} }));
vi.mock("@/components/ui/useMeasuredPopoverAnchor", () => ({
  useMeasuredPopoverAnchor: () => ({}),
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ colors: {}, radii: {}, fonts: {} }),
}));
vi.mock("@/lib/toast", () => ({ toastError: () => {}, toastSuccess: () => {} }));
vi.mock("./AgentMenu", () => ({ AgentMenu: () => null }));

import {
  agentSessionMenuSections,
  type AgentSessionMenuInput,
} from "./AgentSessionHeaderMenu";

const input: AgentSessionMenuInput = {
  renameSupported: true,
  ready: true,
  busy: false,
  commandPending: false,
  usageSupported: true,
  workspaceKnown: true,
  providerSessionId: "provider-session",
  workspacePath: "/workspace",
  onRename: () => {},
  onCompact: () => {},
  onUsage: () => {},
  onOpenWorkspace: () => {},
  onCopy: () => {},
};

function item(key: string, overrides: Partial<AgentSessionMenuInput> = {}) {
  const sections = agentSessionMenuSections({ ...input, ...overrides });
  const found = sections.flatMap((section) => section.items).find((entry) => entry.key === key);
  if (!found) throw new Error(`missing menu row ${key}`);
  return found;
}

it("greys compaction and usage while the agent is working but still allows renaming", () => {
  expect(item("rename", { busy: true }).disabled).toBe(false);
  expect(item("compact", { busy: true }).disabled).toBe(true);
  expect(item("usage", { busy: true }).disabled).toBe(true);
  expect(item("workspace", { busy: true }).disabled).toBeFalsy();
  expect(item("copy-session", { busy: true }).disabled).toBeFalsy();
  expect(item("copy-path", { busy: true }).disabled).toBeFalsy();
});

it("greys every session command while another command is in flight", () => {
  expect(item("rename", { commandPending: true }).disabled).toBe(true);
  expect(item("compact", { commandPending: true }).disabled).toBe(true);
  expect(item("usage", { commandPending: true }).disabled).toBe(true);
  expect(item("workspace", { commandPending: true }).disabled).toBeFalsy();
});

it("greys session commands while the session is not writable", () => {
  expect(item("rename", { ready: false }).disabled).toBe(true);
  expect(item("compact", { ready: false }).disabled).toBe(true);
  expect(item("usage", { ready: false }).disabled).toBe(true);
  expect(item("workspace", { ready: false }).disabled).toBeFalsy();
});

it("hides rename and usage when the provider does not support them", () => {
  const sections = agentSessionMenuSections({
    ...input,
    renameSupported: false,
    usageSupported: false,
  });
  const keys = sections.flatMap((section) => section.items).map((entry) => entry.key);
  expect(keys).toEqual(["compact", "workspace", "copy-session", "copy-path"]);
});

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// The React Compiler memoizes components and hooks for us, but it silently
// leaves one alone when its code breaks a rule the compiler relies on. A
// skipped component hands new callbacks and objects to its children on every
// render, which is how a streamed reply came to redraw the whole chat screen.
// This compiles every source file the way Metro does and fails when a file
// that should be optimized is skipped.

const mobileRoot = path.resolve(__dirname, "..");
const fromMobile = createRequire(path.join(mobileRoot, "package.json"));
// The versions Metro uses: the compiler comes with Expo's Babel preset.
const fromPreset = createRequire(
  createRequire(fromMobile.resolve("expo/package.json")).resolve("babel-preset-expo/package.json"),
);
const babel: {
  transformSync: (code: string, options: Record<string, unknown>) => unknown;
} = fromPreset("@babel/core");
const compiler: unknown = fromPreset("babel-plugin-react-compiler");

// Files the compiler skips today, with the rule each breaks. Fix the code and
// remove the entry; never add one for new code. An entry that no longer
// applies fails the check too, so the list cannot go stale.
const KNOWN_BAILOUTS: Record<string, string> = {
  "src/app/(authed)/(drawer)/agent/[id].tsx": "hook lint rule switched off",
  "src/app/(authed)/(drawer)/agents/index.tsx": "try with finally, or throw inside try",
  "src/app/(authed)/settings/chat.tsx": "hook reached through a call",
  "src/app/(authed)/settings/data.tsx": "try with finally, or throw inside try",
  "src/app/(authed)/settings/index.tsx": "hook reached through a call",
  "src/app/(authed)/settings/notifications.tsx": "hook reached through a call",
  "src/app/(authed)/settings/profile.tsx": "hook reached through a call; try with finally, or throw inside try",
  "src/app/(authed)/settings/security.tsx": "hook reached through a call",
  "src/app/(authed)/settings/server.tsx": "hook reached through a call",
  "src/app/(authed)/settings/users/[id].tsx": "hook reached through a call",
  "src/app/(authed)/sign-in-request.tsx": "try with finally, or throw inside try",
  "src/app/_layout.tsx": "hook reached through a call",
  "src/app/login.tsx": "try with finally, or throw inside try",
  "src/app/server.tsx": "try with finally, or throw inside try",
  "src/components/RequiredTwoFactorNotice.tsx": "try with finally, or throw inside try",
  "src/components/agents/AgentComposer.tsx": "try with finally, or throw inside try",
  "src/components/agents/AgentForkMenu.tsx": "ref read or written during render",
  "src/components/agents/AgentRewindMenu.tsx": "ref read or written during render",
  "src/components/agents/AgentSessionHeaderMenu.tsx": "ref read or written during render",
  "src/components/agents/AgentUserMessage.tsx": "ref read or written during render",
  "src/components/chat/ChatHeaderMenu.tsx": "ref read or written during render",
  "src/components/chat/DocumentViewer.tsx": "try with finally, or throw inside try",
  "src/components/chat/GeneratedImageCard.tsx": "try with finally, or throw inside try",
  "src/components/chat/OpenUICard.tsx": "try with finally, or throw inside try",
  "src/components/chat/VoiceControls.tsx": "ref read or written during render",
  "src/components/drawer/AgentsDrawer.tsx": "ref read or written during render",
  "src/components/drawer/AppDrawer.tsx": "hook reached through a call; ref read or written during render",
  "src/components/personalization/MemoryEditorSheet.tsx": "try with finally, or throw inside try",
  "src/components/projects/ProjectFilesSection.tsx": "try with finally, or throw inside try",
  "src/components/settings/AdminGate.tsx": "hook reached through a call",
  "src/components/settings/SettingsUI.tsx": "try with finally, or throw inside try",
  "src/lib/agents/drafts.ts": "hook lint rule switched off",
  "src/lib/auth/useAuthCookie.ts": "hook reached through a call",
  "src/lib/chat/useAttachments.ts": "try with finally, or throw inside try",
  "src/lib/notifications/useNotifications.ts": "hook reached through a call",
  "src/lib/queries/agents.ts": "hook lint rule switched off; try with finally, or throw inside try",
  "src/lib/queries/chatMessages.ts": "try with finally, or throw inside try",
  "src/lib/queries/modelPreferences.ts": "hook reached through a call",
  "src/lib/queries/settings.ts": "hook reached through a call",
  "src/lib/useDictation.ts": "try with finally, or throw inside try",
  "src/lib/useSpeech.ts": "try with finally, or throw inside try",
  "src/lib/voice/useMobileVoice.ts": "try with finally, or throw inside try",
};

function reasonOf(detail: Record<string, unknown> | undefined): string {
  const options = detail?.options as Record<string, unknown> | undefined;
  return String(detail?.reason ?? options?.reason ?? detail?.description ?? "unknown reason");
}

/** Why the compiler skipped something in the file, or null when it compiled all of it. */
function bailout(file: string): string | null {
  const reasons: string[] = [];
  babel.transformSync(fs.readFileSync(path.join(mobileRoot, file), "utf8"), {
    filename: path.join(mobileRoot, file),
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [
      [
        compiler,
        {
          panicThreshold: "none",
          logger: {
            logEvent: (_file: string, event: { kind: string; detail?: Record<string, unknown> }) => {
              if (event.kind === "CompileError") reasons.push(reasonOf(event.detail));
            },
          },
        },
      ],
    ],
  });
  return reasons.length ? [...new Set(reasons)].join("; ") : null;
}

const sourceFiles = fs
  .readdirSync(path.join(mobileRoot, "src"), { recursive: true })
  .map((file) => `src/${String(file).split(path.sep).join("/")}`)
  .filter((file) => /\.tsx?$/.test(file) && !/\.(test\.tsx?|d\.ts)$/.test(file))
  .sort();

describe("React Compiler coverage", () => {
  const skipped = new Map<string, string>();
  for (const file of sourceFiles) {
    const reason = bailout(file);
    if (reason) skipped.set(file, reason);
  }

  it("optimizes every component and hook outside the known list", () => {
    const unexpected = [...skipped].filter(([file]) => !(file in KNOWN_BAILOUTS));
    expect(
      unexpected.map(([file, reason]) => `${file}: ${reason}`),
      "The React Compiler skipped these files. Fix the rule each breaks rather than listing it.",
    ).toEqual([]);
  });

  it("lists only files that are still skipped", () => {
    expect(
      Object.keys(KNOWN_BAILOUTS).filter((file) => !skipped.has(file)),
      "These files compile now. Remove them from KNOWN_BAILOUTS.",
    ).toEqual([]);
  });
}, 120_000);

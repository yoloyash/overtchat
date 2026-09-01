"use client";

import { useAgentWorkspaceNavigation } from "./AgentWorkspaceNavigationContext";

function positiveLine(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function AgentWorkspaceLink({
  children,
  path,
  linestart,
  lineend,
}: {
  children?: React.ReactNode;
  path?: unknown;
  linestart?: unknown;
  lineend?: unknown;
}) {
  const navigation = useAgentWorkspaceNavigation();
  const workspacePath = typeof path === "string" ? path : "Workspace file";
  const lineStart = positiveLine(linestart);
  const lineEnd = positiveLine(lineend);
  const location = lineStart
    ? `${workspacePath}:L${lineStart}${lineEnd ? `-L${lineEnd}` : ""}`
    : workspacePath;

  if (!navigation) {
    return (
      <span
        data-testid="agent-workspace-link"
        data-workspace-path={workspacePath}
        data-line-start={lineStart}
        data-line-end={lineEnd}
        title={location}
        className="inline-flex max-w-full items-baseline font-medium text-primary no-underline"
      >
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        navigation.openFile({
          path: workspacePath,
          ...(lineStart ? { lineStart } : {}),
          ...(lineEnd ? { lineEnd } : {}),
        })
      }
      data-testid="agent-workspace-link"
      data-workspace-path={workspacePath}
      data-line-start={lineStart}
      data-line-end={lineEnd}
      title={location}
      className="inline-flex max-w-full cursor-pointer items-baseline font-medium text-primary no-underline hover:underline"
    >
      {children}
    </button>
  );
}

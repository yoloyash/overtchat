import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { cjk } from "@streamdown/cjk";
import { defaultRemarkPlugins } from "streamdown";
import { useMemo } from "react";
import { useTheme } from "next-themes";

export function useStreamdownPlugins() {
  const { resolvedTheme } = useTheme();
  return useMemo(
    () => ({
      code,
      math,
      cjk,
      mermaid: createMermaidPlugin({
        config: { theme: resolvedTheme === "dark" ? "dark" : "default" },
      }),
    }),
    [resolvedTheme],
  );
}

export const STREAMDOWN_DEFAULT_REMARK_PLUGINS = Object.values(defaultRemarkPlugins);

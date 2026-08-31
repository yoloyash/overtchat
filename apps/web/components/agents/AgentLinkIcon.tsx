import CsharpPlain from "devicons-react/icons/CsharpPlain";
import { Braces, File, FileCode2, Globe2, Link2 } from "lucide-react";
import {
  siC,
  siCplusplus,
  siGithub,
  siGo,
  siJavascript,
  siMarkdown,
  siPython,
  siRust,
  siTypescript,
  type SimpleIcon,
} from "simple-icons";
import {
  AGENT_LINK_ICON_KINDS,
  type AgentLinkIconKind,
} from "@/lib/agents/links";

function isAgentLinkIconKind(value: unknown): value is AgentLinkIconKind {
  return (
    typeof value === "string" &&
    (AGENT_LINK_ICON_KINDS as readonly string[]).includes(value)
  );
}

function BrandMark({ icon }: { icon: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
      <path d={icon.path} />
    </svg>
  );
}

export function AgentLinkIcon({ kind }: { kind?: unknown }) {
  const resolvedKind: AgentLinkIconKind = isAgentLinkIconKind(kind)
    ? kind
    : "link";
  let icon: React.ReactNode;

  switch (resolvedKind) {
    case "github":
      icon = <BrandMark icon={siGithub} />;
      break;
    case "web":
      icon = <Globe2 className="size-3.5" />;
      break;
    case "typescript":
      icon = <BrandMark icon={siTypescript} />;
      break;
    case "javascript":
      icon = <BrandMark icon={siJavascript} />;
      break;
    case "json":
      icon = <Braces className="size-3.5" />;
      break;
    case "markdown":
      icon = <BrandMark icon={siMarkdown} />;
      break;
    case "python":
      icon = <BrandMark icon={siPython} />;
      break;
    case "c":
      icon = <BrandMark icon={siC} />;
      break;
    case "cplusplus":
      icon = <BrandMark icon={siCplusplus} />;
      break;
    case "csharp":
      icon = <CsharpPlain size="0.875rem" color="currentColor" />;
      break;
    case "go":
      icon = <BrandMark icon={siGo} />;
      break;
    case "rust":
      icon = <BrandMark icon={siRust} />;
      break;
    case "code":
      icon = <FileCode2 className="size-3.5" />;
      break;
    case "file":
      icon = <File className="size-3.5" />;
      break;
    case "link":
      icon = <Link2 className="size-3.5" />;
      break;
  }

  return (
    <span
      data-testid={`agent-link-icon-${resolvedKind}`}
      aria-hidden="true"
      className="mr-1 inline-flex shrink-0 self-center text-primary"
    >
      {icon}
    </span>
  );
}

"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockDownloadButton,
  useIsCodeFenceIncomplete,
} from "streamdown";
import { Loader2, Play } from "lucide-react";
import type { CodeExecutionOutput } from "@overtchat/shared";
import {
  executePython,
  releasePythonOutput,
} from "@/lib/code-execution/browser-python";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import { CodeExecutionArtifacts } from "./CodeExecutionArtifacts";

type MarkdownCodeProps = ComponentProps<"code"> & {
  node?: unknown;
  "data-block"?: unknown;
};

export function PythonCodeBlock({
  disabled,
  ...props
}: MarkdownCodeProps & { disabled?: boolean }) {
  const incomplete = useIsCodeFenceIncomplete();
  const isBlock = "data-block" in props;
  const className = typeof props.className === "string" ? props.className : "";
  const language = className.match(/language-([^\s]+)/)?.[1]?.toLowerCase() ?? "";
  const code = extractText(props.children);
  const [running, setRunning] = useState(false);
  const [execution, setExecution] = useState<{
    code: string;
    output: CodeExecutionOutput;
  } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (execution) releasePythonOutput(execution.output);
    },
    [execution],
  );
  if (!isBlock) {
    const { children, ...inlineProps } = props;
    delete inlineProps.node;
    delete inlineProps["data-block"];
    return (
      <code
        {...(inlineProps as React.ComponentProps<"code">)}
        className={cn(
          "rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
          className,
        )}
      >
        {children as ReactNode}
      </code>
    );
  }

  const python = language === "python" || language === "py";
  const output = execution?.code === code ? execution.output : null;
  const run = async () => {
    setRunning(true);
    setExecution(null);
    const result = await executePython(code);
    if (!mounted.current) return;
    setExecution({ code, output: result });
    setRunning(false);
  };

  return (
    <div className="my-4 space-y-2">
      <CodeBlock
        code={code}
        language={language}
        isIncomplete={incomplete}
        lineNumbers
      >
        {python && (
          <button
            type="button"
            title="Run Python"
            aria-label="Run Python"
            disabled={disabled || incomplete || running || !code.trim()}
            onClick={() => void run()}
            className="cursor-pointer p-1 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
            ) : (
              <Play className="size-3.5" />
            )}
          </button>
        )}
        <CodeBlockDownloadButton code={code} language={language} />
        <CodeBlockCopyButton code={code} />
      </CodeBlock>
      {output && <ExecutionOutputView output={output} />}
    </div>
  );
}

function ExecutionOutputView({ output }: { output: CodeExecutionOutput }) {
  const hasResult = output.result !== null && output.result !== undefined;
  return (
    <div className="overflow-hidden rounded-lg border bg-background/50 font-mono text-xs">
      <div className="border-b px-3 py-1.5 font-sans text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Output
      </div>
      <div className="max-h-72 space-y-2 overflow-auto p-3">
        {output.stdout && (
          <pre className="whitespace-pre-wrap break-words">{output.stdout}</pre>
        )}
        {hasResult && (
          <pre className="whitespace-pre-wrap break-words">
            {formatResult(output.result)}
          </pre>
        )}
        {output.stderr && (
          <pre className="whitespace-pre-wrap break-words text-destructive">
            {output.stderr}
          </pre>
        )}
        {output.outputs.length > 0 && (
          <CodeExecutionArtifacts artifacts={output.outputs} />
        )}
        {!output.stdout && !hasResult && !output.stderr && (
          <span className="font-sans text-muted-foreground">
            Completed with no output
          </span>
        )}
      </div>
    </div>
  );
}

function extractText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(value)) {
    return Children.toArray(value.props.children).map(extractText).join("");
  }
  return "";
}

function formatResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

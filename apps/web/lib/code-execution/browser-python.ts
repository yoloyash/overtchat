"use client";

import type { CodeExecutionOutput } from "@overtchat/shared";

export const PYTHON_EXECUTION_TIMEOUT_MS = 60_000;
export const MAX_PYTHON_CODE_CHARS = 100_000;
const MAX_OUTPUT_CHARS = 64_000;

const PACKAGE_IMPORTS = Object.freeze({
  numpy: "numpy",
  pandas: "pandas",
  scipy: "scipy",
  sklearn: "scikit-learn",
  sympy: "sympy",
  regex: "regex",
  tiktoken: "tiktoken",
  pytz: "pytz",
});

type PendingExecution = {
  resolve: (output: CodeExecutionOutput) => void;
  timeout: number;
};

type SandboxMessage = {
  type?: string;
  id?: string;
  stdout?: unknown;
  stderr?: unknown;
  result?: unknown;
};

// The worker keeps CPU-bound Python off the chat UI thread. Its owning iframe
// still has an opaque origin, so Python's JavaScript bridge cannot reach the
// authenticated parent document.
const pythonWorkerScript = String.raw`
  var pyodide = null;
  var pyodideReady = null;
  var stdout = "";
  var stderr = "";
  var MAX_OUTPUT_CHARS = 64000;

  function append(current, text) {
    if (current.length >= MAX_OUTPUT_CHARS) return current;
    var next = current + String(text) + "\n";
    return next.length > MAX_OUTPUT_CHARS
      ? next.slice(0, MAX_OUTPUT_CHARS) + "\n[output truncated]"
      : next;
  }

  function clean(value, depth, seen) {
    if (depth > 12) return "[maximum depth reached]";
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
      return value;
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value.toJs === "function") {
      var converted;
      try {
        converted = value.toJs();
      } finally {
        if (typeof value.destroy === "function") value.destroy();
      }
      return clean(converted, depth + 1, seen);
    }
    if (ArrayBuffer.isView(value)) {
      return Array.from(value).slice(0, 10000);
    }
    if (value instanceof Map) {
      var mapped = {};
      for (var entry of value.entries()) {
        mapped[String(entry[0])] = clean(entry[1], depth + 1, seen);
      }
      return mapped;
    }
    if (value instanceof Set) {
      return Array.from(value, function (item) {
        return clean(item, depth + 1, seen);
      });
    }
    if (Array.isArray(value)) {
      return value.slice(0, 10000).map(function (item) {
        return clean(item, depth + 1, seen);
      });
    }
    if (typeof value === "object") {
      if (seen.has(value)) return "[circular reference]";
      seen.add(value);
      var output = {};
      var keys = Object.keys(value).slice(0, 10000);
      for (var key of keys) output[key] = clean(value[key], depth + 1, seen);
      seen.delete(value);
      return output;
    }
    return String(value);
  }

  async function ensureRuntime(indexUrl, packages) {
    if (!pyodideReady) {
      importScripts(indexUrl + "pyodide.js");
      pyodideReady = loadPyodide({
        indexURL: indexUrl,
        stdout: function (text) { stdout = append(stdout, text); },
        stderr: function (text) { stderr = append(stderr, text); }
      }).then(function (runtime) {
        pyodide = runtime;
        return runtime;
      });
    }
    await pyodideReady;
    if (packages && packages.length > 0) await pyodide.loadPackage(packages);
  }

  self.addEventListener("message", async function (event) {
    var data = event.data || {};
    if (data.type !== "execute" || typeof data.id !== "string") return;
    stdout = "";
    stderr = "";
    try {
      await ensureRuntime(data.indexUrl, data.packages || []);
      var result = await pyodide.runPythonAsync(data.code);
      self.postMessage({
        type: "result",
        id: data.id,
        stdout: stdout || null,
        stderr: stderr || null,
        result: clean(result, 0, new WeakSet())
      });
    } catch (error) {
      self.postMessage({
        type: "result",
        id: data.id,
        stdout: stdout || null,
        stderr: error && error.message ? error.message : String(error),
        result: null
      });
    }
  });
`;

const sandboxScript = String.raw`
(function () {
  var indexUrl = window.__OVERTCHAT_PYODIDE_URL__;
  var workerUrl = URL.createObjectURL(new Blob([
    ${JSON.stringify(pythonWorkerScript)}
  ], { type: "text/javascript" }));
  var worker = new Worker(workerUrl);
  URL.revokeObjectURL(workerUrl);

  worker.addEventListener("message", function (event) {
    parent.postMessage(event.data, "*");
  });
  worker.addEventListener("error", function (event) {
    parent.postMessage({
      type: "runtime-error",
      stderr: event.message || "Python runtime failed"
    }, "*");
  });
  window.addEventListener("message", function (event) {
    if (event.source !== parent) return;
    var data = event.data || {};
    if (data.type !== "execute" || typeof data.id !== "string") return;
    worker.postMessage(Object.assign({}, data, { indexUrl: indexUrl }));
  });
})();
`;

export function packagesForPython(code: string): string[] {
  const imports = new Set<string>();
  const importPattern = /(?:^|\n)\s*(?:import|from)\s+([A-Za-z_][\w]*)/g;
  for (const match of code.matchAll(importPattern)) {
    const packageName = PACKAGE_IMPORTS[match[1] as keyof typeof PACKAGE_IMPORTS];
    if (packageName) imports.add(packageName);
  }
  return [...imports];
}

class BrowserPythonExecutor {
  private iframe: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, PendingExecution>();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private onWindowMessage: ((event: MessageEvent<SandboxMessage>) => void) | null =
    null;

  execute(code: string): Promise<CodeExecutionOutput> {
    const generation = this.generation;
    const operation = this.queue.then(() =>
      generation === this.generation
        ? this.executeNow(code)
        : failedOutput("Python runtime was reset"),
    );
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  dispose(reason = "Python runtime was reset"): void {
    this.generation += 1;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.resolve(failedOutput(reason));
    }
    this.pending.clear();
    if (this.onWindowMessage) {
      window.removeEventListener("message", this.onWindowMessage);
      this.onWindowMessage = null;
    }
    this.iframe?.remove();
    this.iframe = null;
    this.ready = null;
  }

  private async executeNow(code: string): Promise<CodeExecutionOutput> {
    if (!code.trim()) return failedOutput("No Python code was provided");
    if (code.length > MAX_PYTHON_CODE_CHARS) {
      return failedOutput(
        `Python code exceeds the ${MAX_PYTHON_CODE_CHARS.toLocaleString()} character limit`,
      );
    }

    await this.ensureFrame();
    const target = this.iframe?.contentWindow;
    if (!target) return failedOutput("Python runtime is unavailable");

    const id = crypto.randomUUID();
    return new Promise<CodeExecutionOutput>((resolve) => {
      const timeout = window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.dispose("Execution time limit exceeded");
      }, PYTHON_EXECUTION_TIMEOUT_MS);
      this.pending.set(id, { resolve, timeout });
      target.postMessage(
        {
          type: "execute",
          id,
          code,
          packages: packagesForPython(code),
        },
        "*",
      );
    });
  }

  private ensureFrame(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = new Promise<void>((resolve, reject) => {
      const origin = window.location.origin;
      const indexUrl = `${origin}/pyodide/`;
      const csp = [
        "default-src 'none'",
        `script-src 'unsafe-inline' 'wasm-unsafe-eval' ${origin}`,
        `connect-src ${origin}`,
        "worker-src blob:",
      ].join("; ");
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("title", "Python execution sandbox");
      iframe.style.display = "none";
      iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>window.__OVERTCHAT_PYODIDE_URL__=${JSON.stringify(indexUrl)}</script><script src="${indexUrl}pyodide.js"></script></head><body><script>${sandboxScript}</script></body></html>`;

      const onMessage = (event: MessageEvent<SandboxMessage>) => {
        if (event.source !== iframe.contentWindow) return;
        const message = event.data;
        if (message.type === "runtime-error") {
          this.dispose(textValue(message.stderr) ?? "Python runtime failed");
          return;
        }
        if (message.type !== "result" || !message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        window.clearTimeout(pending.timeout);
        pending.resolve(normalizeOutput(message));
      };

      iframe.addEventListener("load", () => resolve(), { once: true });
      iframe.addEventListener(
        "error",
        () => reject(new Error("Failed to load the Python runtime")),
        { once: true },
      );
      this.onWindowMessage = onMessage;
      window.addEventListener("message", onMessage);
      this.iframe = iframe;
      document.body.appendChild(iframe);
    }).catch((error) => {
      this.dispose();
      throw error;
    });

    return this.ready;
  }
}

let executor: BrowserPythonExecutor | null = null;

export function executePython(code: string): Promise<CodeExecutionOutput> {
  executor ??= new BrowserPythonExecutor();
  return executor.execute(code).catch((cause) =>
    failedOutput(
      cause instanceof Error ? cause.message : "Python execution failed",
    ),
  );
}

export function resetPythonExecutor(): void {
  executor?.dispose();
  executor = null;
}

function failedOutput(stderr: string): CodeExecutionOutput {
  return { stdout: null, stderr, result: null, outputs: [] };
}

function normalizeOutput(message: SandboxMessage): CodeExecutionOutput {
  return {
    stdout: truncateText(textValue(message.stdout)),
    stderr: truncateText(textValue(message.stderr)),
    result: limitResult(message.result),
    outputs: [],
  };
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function truncateText(value: string | null): string | null {
  if (!value || value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`;
}

function limitResult(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_OUTPUT_CHARS) return value;
    return `${serialized.slice(0, MAX_OUTPUT_CHARS)}\n[result truncated]`;
  } catch {
    return String(value).slice(0, MAX_OUTPUT_CHARS);
  }
}

"use client";

import {
  MAX_CODE_EXECUTION_FILE_BYTES,
  MAX_CODE_EXECUTION_OUTPUTS,
  MAX_CODE_EXECUTION_TOTAL_OUTPUT_BYTES,
  type CodeExecutionArtifact,
  type CodeExecutionOutput,
} from "@overtchat/shared";

export const PYTHON_EXECUTION_TIMEOUT_MS = 60_000;
export const MAX_PYTHON_CODE_CHARS = 100_000;
const MAX_OUTPUT_CHARS = 64_000;

const PACKAGE_IMPORTS = Object.freeze({
  numpy: "numpy",
  pandas: "pandas",
  matplotlib: "matplotlib",
  scipy: "scipy",
  sklearn: "scikit-learn",
  sympy: "sympy",
  regex: "regex",
  tiktoken: "tiktoken",
  pytz: "pytz",
});

export interface PythonInputFile {
  name: string;
  data: ArrayBuffer;
}

type PendingExecution = {
  resolve: (output: CodeExecutionOutput) => void;
  timeout: number;
};

type SandboxArtifact = {
  name?: unknown;
  byteLength?: unknown;
  data?: unknown;
};

type SandboxMessage = {
  type?: string;
  id?: string;
  stdout?: unknown;
  stderr?: unknown;
  result?: unknown;
  outputs?: unknown;
  failed?: unknown;
};

// The worker keeps CPU-bound Python off the chat UI thread. Its owning iframe
// still has an opaque origin, so Python's JavaScript bridge cannot reach the
// authenticated parent document.
const pythonWorkerScript = String.raw`
  var pyodide = null;
  var pyodideReady = null;
  var stdout = "";
  var stderr = "";
  var nativeFetch = self.fetch.bind(self);
  var nativeImportScripts = self.importScripts.bind(self);
  var MAX_OUTPUT_CHARS = 64000;
  var MAX_OUTPUT_FILES = ${MAX_CODE_EXECUTION_OUTPUTS};
  var MAX_FILE_BYTES = ${MAX_CODE_EXECUTION_FILE_BYTES};
  var MAX_TOTAL_BYTES = ${MAX_CODE_EXECUTION_TOTAL_OUTPUT_BYTES};
  var UPLOAD_DIR = "/mnt/uploads";

  function append(current, text) {
    if (current.length >= MAX_OUTPUT_CHARS) return current;
    var next = current + String(text) + "\n";
    return next.length > MAX_OUTPUT_CHARS
      ? next.slice(0, MAX_OUTPUT_CHARS) + "\n[output truncated]"
      : next;
  }

  function disableNetwork() {
    var blocked = function () {
      throw new Error("Network access is disabled in Python execution");
    };
    self.fetch = function () {
      return Promise.reject(new Error("Network access is disabled in Python execution"));
    };
    self.importScripts = blocked;
    self.XMLHttpRequest = blocked;
    self.WebSocket = blocked;
    self.EventSource = blocked;
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
    if (ArrayBuffer.isView(value)) return Array.from(value).slice(0, 10000);
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

  function ensureUploadDir() {
    try {
      pyodide.FS.stat(UPLOAD_DIR);
    } catch {
      pyodide.FS.mkdirTree(UPLOAD_DIR);
    }
  }

  function mountFiles(files) {
    ensureUploadDir();
    for (var file of files || []) {
      if (!file || typeof file.name !== "string" || !(file.data instanceof ArrayBuffer)) continue;
      pyodide.FS.writeFile(UPLOAD_DIR + "/" + file.name, new Uint8Array(file.data));
    }
  }

  function fingerprint(bytes) {
    var hash = 2166136261;
    for (var index = 0; index < bytes.length; index += 1) {
      hash ^= bytes[index];
      hash = Math.imul(hash, 16777619);
    }
    return bytes.length + ":" + (hash >>> 0);
  }

  function snapshotFiles() {
    ensureUploadDir();
    var snapshot = {};
    var names = pyodide.FS.readdir(UPLOAD_DIR)
      .filter(function (name) { return name !== "." && name !== ".."; })
      .sort();
    for (var name of names) {
      var path = UPLOAD_DIR + "/" + name;
      try {
        var stat = pyodide.FS.stat(path);
        if (pyodide.FS.isDir(stat.mode)) continue;
        snapshot[name] = fingerprint(pyodide.FS.readFile(path));
      } catch {}
    }
    return snapshot;
  }

  function collectOutputs(before) {
    var outputs = [];
    var warnings = [];
    var total = 0;
    var names = pyodide.FS.readdir(UPLOAD_DIR)
      .filter(function (name) { return name !== "." && name !== ".."; })
      .sort();

    for (var name of names) {
      var path = UPLOAD_DIR + "/" + name;
      try {
        var stat = pyodide.FS.stat(path);
        if (pyodide.FS.isDir(stat.mode)) continue;
        var bytes = pyodide.FS.readFile(path);
        if (before[name] === fingerprint(bytes)) continue;
        if (outputs.length >= MAX_OUTPUT_FILES) {
          warnings.push("Skipped " + name + ": only " + MAX_OUTPUT_FILES + " output files are allowed");
          continue;
        }
        if (bytes.byteLength > MAX_FILE_BYTES) {
          warnings.push("Skipped " + name + ": file exceeds the 20 MB output limit");
          continue;
        }
        if (total + bytes.byteLength > MAX_TOTAL_BYTES) {
          warnings.push("Skipped " + name + ": outputs exceed the 50 MB total limit");
          continue;
        }
        var copy = bytes.slice().buffer;
        outputs.push({ name: name, byteLength: bytes.byteLength, data: copy });
        total += bytes.byteLength;
      } catch (error) {
        warnings.push("Skipped " + name + ": " + (error && error.message ? error.message : String(error)));
      }
    }
    return { outputs: outputs, warnings: warnings };
  }

  async function patchMatplotlib() {
    await pyodide.runPythonAsync([
      "import os",
      "os.environ['MPLBACKEND'] = 'AGG'",
      "import matplotlib.figure as _overtchat_figure",
      "import matplotlib.pyplot as _overtchat_plt",
      "if not hasattr(_overtchat_figure.Figure, '_overtchat_original_savefig'):",
      "    _overtchat_figure.Figure._overtchat_original_savefig = _overtchat_figure.Figure.savefig",
      "    def _overtchat_tracked_savefig(self, *args, **kwargs):",
      "        _result = self._overtchat_original_savefig(*args, **kwargs)",
      "        _target = args[0] if args else kwargs.get('fname')",
      "        try:",
      "            _path = os.path.abspath(os.fsdecode(os.fspath(_target)))",
      "        except (TypeError, ValueError):",
      "            _path = None",
      "        if _path is not None and os.path.dirname(_path) == '/mnt/uploads':",
      "            self._overtchat_saved_to_uploads = True",
      "        return _result",
      "    _overtchat_figure.Figure.savefig = _overtchat_tracked_savefig",
      "try:",
      "    _overtchat_plot_counter",
      "except NameError:",
      "    _overtchat_plot_counter = 0",
      "def _overtchat_show(*, block=None):",
      "    global _overtchat_plot_counter",
      "    for _number in list(_overtchat_plt.get_fignums()):",
      "        _figure = _overtchat_plt.figure(_number)",
      "        if not getattr(_figure, '_overtchat_saved_to_uploads', False):",
      "            while True:",
      "                _overtchat_plot_counter += 1",
      "                _path = f'/mnt/uploads/plot-{_overtchat_plot_counter}.png'",
      "                if not os.path.exists(_path):",
      "                    break",
      "            _figure._overtchat_original_savefig(_path, format='png', bbox_inches='tight')",
      "        _overtchat_plt.close(_figure)",
      "_overtchat_plt.show = _overtchat_show"
    ].join("\n"));
  }

  async function ensureRuntime(indexUrl, packages) {
    self.fetch = nativeFetch;
    self.importScripts = nativeImportScripts;
    if (!pyodideReady) {
      importScripts(indexUrl + "pyodide.js");
      pyodideReady = loadPyodide({
        indexURL: indexUrl,
        stdout: function (text) { stdout = append(stdout, text); },
        stderr: function (text) { stderr = append(stderr, text); }
      }).then(function (runtime) {
        pyodide = runtime;
        ensureUploadDir();
        return runtime;
      });
    }
    try {
      await pyodideReady;
      if (packages && packages.length > 0) await pyodide.loadPackage(packages);
    } finally {
      disableNetwork();
    }
  }

  self.addEventListener("message", async function (event) {
    var data = event.data || {};
    if (data.type !== "execute" || typeof data.id !== "string") return;
    stdout = "";
    stderr = "";
    try {
      await ensureRuntime(data.indexUrl, data.packages || []);
      mountFiles(data.files || []);
      var before = snapshotFiles();
      if (/(?:^|\s)(?:from|import)\s+matplotlib\b/m.test(data.code)) {
        await patchMatplotlib();
      }
      var result = await pyodide.runPythonAsync(data.code);
      var collected = collectOutputs(before);
      for (var warning of collected.warnings) stderr = append(stderr, warning);
      self.postMessage({
        type: "result",
        id: data.id,
        stdout: stdout || null,
        stderr: stderr || null,
        result: clean(result, 0, new WeakSet()),
        outputs: collected.outputs,
        failed: false
      }, collected.outputs.map(function (output) { return output.data; }));
    } catch (error) {
      self.postMessage({
        type: "result",
        id: data.id,
        stdout: stdout || null,
        stderr: error && error.message ? error.message : String(error),
        result: null,
        outputs: [],
        failed: true
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

  function buffersFromFiles(files) {
    return (files || []).map(function (file) { return file.data; })
      .filter(function (data) { return data instanceof ArrayBuffer; });
  }

  worker.addEventListener("message", function (event) {
    var outputs = event.data && event.data.outputs;
    var transfers = (outputs || []).map(function (output) { return output.data; })
      .filter(function (data) { return data instanceof ArrayBuffer; });
    parent.postMessage(event.data, "*", transfers);
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
    worker.postMessage(Object.assign({}, data, { indexUrl: indexUrl }), buffersFromFiles(data.files));
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
  private objectUrls = new Set<string>();
  private onWindowMessage: ((event: MessageEvent<SandboxMessage>) => void) | null =
    null;

  execute(code: string, files: PythonInputFile[]): Promise<CodeExecutionOutput> {
    const generation = this.generation;
    const operation = this.queue.then(() =>
      generation === this.generation
        ? this.executeNow(code, files)
        : failedOutput("Python runtime was reset"),
    );
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  release(output: CodeExecutionOutput): void {
    for (const artifact of output.outputs) {
      if (!artifact.url.startsWith("blob:")) continue;
      URL.revokeObjectURL(artifact.url);
      this.objectUrls.delete(artifact.url);
    }
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
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  private async executeNow(
    code: string,
    files: PythonInputFile[],
  ): Promise<CodeExecutionOutput> {
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
          files,
        },
        "*",
        files.map((file) => file.data),
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
        pending.resolve(this.normalizeOutput(message));
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

  private normalizeOutput(message: SandboxMessage): CodeExecutionOutput {
    const outputs = Array.isArray(message.outputs)
      ? message.outputs.flatMap((value) => {
          const artifact = normalizeArtifact(value as SandboxArtifact);
          if (!artifact) return [];
          const url = URL.createObjectURL(
            new Blob([artifact.data], { type: artifact.mediaType }),
          );
          this.objectUrls.add(url);
          return [{ ...artifact, url } satisfies CodeExecutionArtifact];
        })
      : [];
    return {
      stdout: truncateText(textValue(message.stdout)),
      stderr: truncateText(textValue(message.stderr)),
      result: limitResult(message.result),
      outputs,
      failed: message.failed === true,
    };
  }
}

let executor: BrowserPythonExecutor | null = null;

export function executePython(
  code: string,
  files: PythonInputFile[] = [],
): Promise<CodeExecutionOutput> {
  executor ??= new BrowserPythonExecutor();
  return executor.execute(code, files).catch((cause) =>
    failedOutput(
      cause instanceof Error ? cause.message : "Python execution failed",
    ),
  );
}

export function releasePythonOutput(output: CodeExecutionOutput): void {
  executor?.release(output);
}

export function resetPythonExecutor(): void {
  executor?.dispose();
  executor = null;
}

function failedOutput(stderr: string): CodeExecutionOutput {
  return { stdout: null, stderr, result: null, outputs: [], failed: true };
}

function normalizeArtifact(value: SandboxArtifact):
  | (Omit<CodeExecutionArtifact, "url"> & { data: ArrayBuffer })
  | null {
  if (
    typeof value.name !== "string" ||
    typeof value.byteLength !== "number" ||
    !(value.data instanceof ArrayBuffer) ||
    value.byteLength !== value.data.byteLength
  ) {
    return null;
  }
  const name = safeFilename(value.name);
  const mediaType = artifactMediaType(name, new Uint8Array(value.data));
  return {
    kind: mediaType.startsWith("image/") ? "image" : "file",
    name,
    mediaType,
    byteLength: value.byteLength,
    data: value.data,
  };
}

function safeFilename(value: string): string {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .trim()
    .slice(0, 180);
  return sanitized || "output.bin";
}

function artifactMediaType(name: string, data: Uint8Array): string {
  if (hasBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (hasBytes(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    hasBytes(data, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    hasBytes(data, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (
    hasBytes(data, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...data.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  const extension = name.toLowerCase().split(".").at(-1) ?? "";
  return (
    {
      csv: "text/csv",
      json: "application/json",
      md: "text/markdown",
      txt: "text/plain",
      html: "text/html",
      css: "text/css",
      js: "text/javascript",
      ts: "text/plain",
      py: "text/x-python",
      pdf: "application/pdf",
      zip: "application/zip",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    } as Record<string, string>
  )[extension] ?? "application/octet-stream";
}

function hasBytes(data: Uint8Array, prefix: number[]): boolean {
  return (
    data.byteLength >= prefix.length &&
    prefix.every((byte, index) => data[index] === byte)
  );
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

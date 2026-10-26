import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  userId: string;
  filename: string;
  mediaType: string;
  category: string;
  size: number;
  extractedText?: string | null;
};

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  disk: new Map<string, Buffer>(),
  run: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(async (path: string) => {
      const bytes = mocks.disk.get(path);
      if (!bytes) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return bytes;
    }),
    writeFile: vi.fn(async (path: string, bytes: Buffer) => {
      mocks.disk.set(path, bytes);
    }),
    rm: vi.fn(async (path: string) => {
      mocks.disk.delete(path);
    }),
  },
}));
vi.mock("@/lib/db/uploads", () => ({
  uploadPath: (id: string) => `/uploads/${id}`,
  getUpload: vi.fn(async (id: string, userId: string) => {
    const row = mocks.rows.get(id);
    return row && row.userId === userId ? row : null;
  }),
  createUpload: vi.fn(async (row: Row) => {
    mocks.rows.set(row.id, row);
  }),
  readFetchedImage: vi.fn(async (url: string, userId: string) => {
    const id = url.replace("/api/uploads/", "");
    const row = mocks.rows.get(id);
    if (!row || row.userId !== userId || row.category !== "image") return null;
    return { data: mocks.disk.get(`/uploads/${id}`)!, filename: row.filename, mediaType: row.mediaType };
  }),
}));
vi.mock("./client", () => ({ runInSandbox: mocks.run }));

import type { CodeExecutionOutput } from "@overtchat/shared";
import { createUpload } from "@/lib/db/uploads";
import type { ChatFile } from "@/lib/chat/chat-files";
import type { SandboxInfo } from "./client";
import {
  CODE_EXECUTION_TOOL_ORDER,
  codeExecutionPrompt,
  createCodeExecutionTools,
  formatRun,
  mediaTypeFor,
} from "./tools";

const options = {
  toolCallId: "call",
  messages: [],
  abortSignal: undefined,
  context: {},
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const info: SandboxInfo = {
  tier: "slim",
  version: "0.1.0",
  packages: { pandas: "2.2.3", matplotlib: "3.9.2" },
  tools: ["pdftotext"],
  skills: [
    { name: "spreadsheets", description: "Read and write Excel files.", path: "/opt/skills/spreadsheets/SKILL.md" },
  ],
  limits: {
    timeout_seconds: 60,
    max_timeout_seconds: 120,
    max_input_bytes: 100,
    max_output_files: 20,
    max_output_bytes: 1_000,
  },
};

function stored(id: string, filename: string, bytes: Buffer, mediaType = "text/csv", userId = "user") {
  mocks.rows.set(id, { id, userId, filename, mediaType, category: "spreadsheet", size: bytes.byteLength });
  mocks.disk.set(`/uploads/${id}`, bytes);
}

function sandboxResult(files: Array<{ name: string; data: Buffer }> = [], extra = {}) {
  return {
    exit_code: 0,
    signal: null,
    timed_out: false,
    duration_ms: 1_234,
    stdout: "done\n",
    stdout_truncated: false,
    stderr: "",
    stderr_truncated: false,
    files: files.map((file) => ({
      path: `outputs/${file.name}`,
      name: file.name,
      size: file.data.byteLength,
      media_type: "application/octet-stream",
      data: file.data.toString("base64"),
    })),
    skipped_files: [],
    ...extra,
  };
}

function tools(files: ChatFile[], supportsImageInput = false, outputTokens = 8_000) {
  return createCodeExecutionTools({ userId: "user", files, supportsImageInput, outputTokens, info });
}

async function execute(
  runTools: ReturnType<typeof tools>,
  input: { code: string; timeout_seconds?: number } = { code: "print('hi')" },
): Promise<CodeExecutionOutput> {
  return (await runTools.run_python.execute!(input, options)) as CodeExecutionOutput;
}

describe("run_python", () => {
  beforeEach(() => {
    mocks.rows.clear();
    mocks.disk.clear();
    mocks.run.mockReset();
    vi.mocked(createUpload).mockClear();
  });

  it("is the only code execution tool", () => {
    expect(Object.keys(tools([]))).toEqual([...CODE_EXECUTION_TOOL_ORDER]);
  });

  it("sends the conversation's own files, newest first within the input limit", async () => {
    stored("old", "old.csv", Buffer.alloc(60, 1));
    stored("mid", "mid.csv", Buffer.alloc(30, 2));
    stored("new", "new.csv", Buffer.alloc(40, 3));
    stored("foreign", "foreign.csv", Buffer.alloc(1, 4), "text/csv", "someone-else");
    mocks.run.mockResolvedValue(sandboxResult());
    const output = await execute(
      tools([
        { uploadId: "old", name: "old.csv", mediaType: "text/csv" },
        { uploadId: "mid", name: "mid (2).csv", mediaType: "text/csv" },
        { uploadId: "foreign", name: "foreign.csv", mediaType: "text/csv" },
        { uploadId: "new", name: "new.csv", mediaType: "text/csv" },
      ]),
      { code: "import pandas", timeout_seconds: 90 },
    );
    const [request] = mocks.run.mock.calls[0];
    expect(request).toEqual({
      code: "import pandas",
      timeoutSeconds: 90,
      files: [
        { name: "new.csv", data: Buffer.alloc(40, 3).toString("base64") },
        { name: "mid (2).csv", data: Buffer.alloc(30, 2).toString("base64") },
      ],
    });
    expect(output.omittedInputs).toEqual(["old.csv"]);
  });

  it("caps the timeout at the sandbox maximum and what fetch waits for", () => {
    const schema = tools([]).run_python.inputSchema as unknown as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ code: "1", timeout_seconds: 120 }).success).toBe(true);
    expect(schema.safeParse({ code: "1", timeout_seconds: 121 }).success).toBe(false);
    expect(schema.safeParse({ code: "" }).success).toBe(false);
    // Runs must answer before Node's fetch stops waiting for headers.
    const patient = createCodeExecutionTools({
      userId: "user",
      files: [],
      supportsImageInput: false,
      outputTokens: 8_000,
      info: { ...info, limits: { ...info.limits, max_timeout_seconds: 600 } },
    }).run_python.inputSchema as unknown as { safeParse: (value: unknown) => { success: boolean } };
    expect(patient.safeParse({ code: "1", timeout_seconds: 240 }).success).toBe(true);
    expect(patient.safeParse({ code: "1", timeout_seconds: 241 }).success).toBe(false);
  });

  it("saves returned files as uploads without taking an attachment's name", async () => {
    stored("sales", "sales.csv", Buffer.from("region,total\nnorth,3\n"));
    mocks.run.mockResolvedValue(
      sandboxResult([
        { name: "sales.csv", data: Buffer.from("region,total\nnorth,4\n") },
        { name: "chart.png", data: PNG },
        { name: "fake.png", data: Buffer.from("<svg onload=alert(1)>") },
        { name: "notes.md", data: Buffer.from("# Findings\nNorth grew.") },
        { name: "broken.docx", data: Buffer.from("not a zip") },
      ]),
    );
    const output = await execute(
      tools([{ uploadId: "sales", name: "Sales.csv", mediaType: "text/csv" }]),
    );
    expect(output.files.map(({ name, mediaType, size }) => ({ name, mediaType, size }))).toEqual([
      { name: "sales (2).csv", mediaType: "text/csv", size: 21 },
      { name: "chart.png", mediaType: "image/png", size: PNG.byteLength },
      { name: "fake.png", mediaType: "application/octet-stream", size: 21 },
      { name: "notes.md", mediaType: "text/markdown", size: 22 },
      {
        name: "broken.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 9,
      },
    ]);
    for (const file of output.files) {
      expect(file.url).toBe(`/api/uploads/${file.id}`);
      expect(mocks.disk.has(`/uploads/${file.id}`)).toBe(true);
    }
    const rows = vi.mocked(createUpload).mock.calls.map(([row]) => row);
    expect(rows.map(({ filename, category, extractedText }) => ({ filename, category, extractedText }))).toEqual([
      { filename: "sales (2).csv", category: "spreadsheet", extractedText: "region,total\nnorth,4" },
      { filename: "chart.png", category: "image", extractedText: null },
      { filename: "fake.png", category: "document", extractedText: null },
      { filename: "notes.md", category: "text", extractedText: "# Findings\nNorth grew." },
      { filename: "broken.docx", category: "document", extractedText: null },
    ]);
    expect(rows.every((row) => row.userId === "user")).toBe(true);
  });

  it("gives later runs in the same answer the files earlier runs saved", async () => {
    const runTools = tools([]);
    mocks.run.mockResolvedValueOnce(sandboxResult([{ name: "out.csv", data: Buffer.from("a\n1\n") }]));
    const first = await execute(runTools);
    mocks.run.mockResolvedValueOnce(sandboxResult([{ name: "out.csv", data: Buffer.from("a\n2\n") }]));
    const second = await execute(runTools);
    mocks.run.mockResolvedValueOnce(sandboxResult());
    await execute(runTools);
    expect(mocks.run.mock.calls[1][0].files).toEqual([
      { name: "out.csv", data: Buffer.from("a\n1\n").toString("base64") },
    ]);
    // Saving the name again replaces the file, so the next run reads the new one.
    expect(first.files[0].name).toBe("out.csv");
    expect(second.files[0].name).toBe("out.csv");
    expect(second.files[0].id).not.toBe(first.files[0].id);
    expect(mocks.run.mock.calls[2][0].files).toEqual([
      { name: "out.csv", data: Buffer.from("a\n2\n").toString("base64") },
    ]);
  });

  it("replaces an earlier run's file but numbers a name taken in the same run", async () => {
    stored("old", "chart.png", PNG, "image/png");
    mocks.run.mockResolvedValue(
      sandboxResult([
        { name: "chart.png", data: PNG },
        { name: "Chart.png", data: PNG },
        { name: "photo.png", data: PNG },
      ]),
    );
    const output = await execute(
      tools([
        { uploadId: "photo", name: "photo.png", mediaType: "image/png" },
        { uploadId: "old", name: "chart.png", mediaType: "image/png", fromRun: true },
      ]),
    );
    expect(output.files.map((file) => file.name)).toEqual(["chart.png", "Chart (2).png", "photo (2).png"]);
  });

  it("removes the saved bytes when the upload row cannot be created", async () => {
    mocks.run.mockResolvedValue(sandboxResult([{ name: "a.txt", data: Buffer.from("a") }]));
    vi.mocked(createUpload).mockRejectedValueOnce(new Error("disk full"));
    await expect(execute(tools([]))).rejects.toThrow("disk full");
    expect(mocks.disk.size).toBe(0);
  });

  it("passes sandbox failures to the model as tool errors", async () => {
    mocks.run.mockRejectedValue(new Error("The code sandbox is unreachable."));
    await expect(execute(tools([]))).rejects.toThrow("The code sandbox is unreachable.");
  });

  it("describes runs to the model from the saved output", async () => {
    const output: CodeExecutionOutput = {
      exitCode: 1,
      timedOut: false,
      durationMs: 2_500,
      stdout: "rows: 3\n",
      stderr: "Traceback ...\nKeyError: 'total'\n",
      stderrTruncated: true,
      files: [
        { id: "f1", url: "/api/uploads/f1", name: "summary.csv", mediaType: "text/csv", size: 2_048 },
      ],
      skippedFiles: [{ path: "outputs/link", reason: "not a regular file" }],
      omittedInputs: ["huge.csv"],
    };
    expect(formatRun(output)).toBe(
      [
        "Exit code 1 after 2.5s.",
        "stdout:\nrows: 3",
        "stderr (truncated):\nTraceback ...\nKeyError: 'total'",
        "Saved files (later runs read them from /mnt/data/uploads/<name>; link finished ones in your reply):\n- summary.csv (text/csv, 2.0 KB)",
        "Not returned: outputs/link (not a regular file)",
        "Left out of this run because of size limits: huge.csv",
      ].join("\n\n"),
    );
    expect(formatRun({ ...output, exitCode: null, timedOut: true, files: [] })).toMatch(
      /^Stopped after reaching the time limit \(2\.5s\)\./,
    );
    expect(formatRun({ ...output, exitCode: null, signal: "SIGKILL" })).toMatch(
      /^Stopped by SIGKILL after 2\.5s\./,
    );
  });

  it("keeps the start and end of long output within the model's budget", async () => {
    const stdout = Array.from({ length: 2_000 }, (_, index) => `row ${index}`).join("\n");
    const stderr = "Traceback (most recent call last):\nValueError: bad row\n";
    const output: CodeExecutionOutput = {
      exitCode: 1,
      timedOut: false,
      durationMs: 10,
      stdout,
      stderr,
      files: [],
    };
    const model = await tools([], false, 1_000).run_python.toModelOutput!({
      toolCallId: "call",
      input: { code: "1" },
      output,
    });
    const text = (model as { value: string }).value;
    expect(text).toContain("stdout (truncated):\nrow 0\nrow 1\n");
    expect(text).toMatch(/\nrow \d+\n\[\d+ characters omitted\]\nrow \d+\n/);
    expect(text).toContain("row 1999\n\nstderr:\nTraceback (most recent call last):\nValueError: bad row");
    // The short stream stays whole and the long one fills the rest.
    const printed = text.slice(text.indexOf("stdout (truncated):\n") + 20, text.indexOf("\n\nstderr:"));
    expect(printed.length + stderr.trimEnd().length).toBeLessThanOrEqual(3_000 + 40);
    expect(printed.length).toBeGreaterThan(2_800);
    // Within budget, nothing is cut.
    expect(formatRun(output)).toContain(stdout);
  });

  it("shows returned images to models that accept images", async () => {
    mocks.run.mockResolvedValue(
      sandboxResult([
        { name: "a.png", data: PNG },
        { name: "b.png", data: PNG },
        { name: "c.png", data: PNG },
        { name: "d.png", data: PNG },
        { name: "e.png", data: PNG },
        { name: "data.csv", data: Buffer.from("x\n1\n") },
      ]),
    );
    const visual = tools([], true);
    const output = await execute(visual);
    const model = await visual.run_python.toModelOutput!({ toolCallId: "call", input: { code: "1" }, output });
    expect(model.type).toBe("content");
    const parts = (model as { value: Array<{ type: string; filename?: string; mediaType?: string }> }).value;
    expect(parts[0]).toEqual({ type: "text", text: formatRun(output) });
    expect(parts.slice(1).map((part) => [part.type, part.filename, part.mediaType])).toEqual([
      ["file", "a.png", "image/png"],
      ["file", "b.png", "image/png"],
      ["file", "c.png", "image/png"],
      ["file", "d.png", "image/png"],
    ]);

    const textOnly = await tools([], false).run_python.toModelOutput!({
      toolCallId: "call",
      input: { code: "1" },
      output,
    });
    expect(textOnly).toEqual({ type: "text", value: formatRun(output) });
  });

  it("does not replay a malformed or foreign saved output", async () => {
    const runTools = tools([], true);
    await expect(
      runTools.run_python.toModelOutput!({
        toolCallId: "call",
        input: { code: "1" },
        output: { stdout: "x" } as unknown as CodeExecutionOutput,
      }),
    ).resolves.toEqual({ type: "error-text", value: "This code run is unavailable." });

    stored("theirs", "theirs.png", PNG, "image/png", "someone-else");
    mocks.rows.get("theirs")!.category = "image";
    const output: CodeExecutionOutput = {
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
      stdout: "",
      stderr: "",
      files: [{ id: "theirs", url: "/api/uploads/theirs", name: "theirs.png", mediaType: "image/png", size: 11 }],
    };
    expect(
      await runTools.run_python.toModelOutput!({ toolCallId: "call", input: { code: "1" }, output }),
    ).toEqual({ type: "text", value: formatRun(output) });
  });

  it("tells the model what the sandbox offers", () => {
    const description = tools([]).run_python.description!;
    expect(description).toContain("/mnt/data/uploads/<name>");
    expect(description).toContain("/mnt/data/outputs/");
    expect(description).toContain("Installed packages: pandas, matplotlib.");
    expect(description).toContain("Command-line tools: pdftotext.");
    expect(codeExecutionPrompt(info)).toContain(
      "spreadsheets (/opt/skills/spreadsheets/SKILL.md): Read and write Excel files.",
    );
    expect(codeExecutionPrompt({ ...info, skills: [] })).not.toContain("guide");
    // Saved files reach the reply only through links the model writes.
    expect(codeExecutionPrompt(info)).toContain(
      "The user sees a file in your reply only when you link it by name, such as ![Chart](chart.png)",
    );
    expect(mediaTypeFor("Report.XLSX")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(mediaTypeFor("archive.tar.gz")).toBe("application/octet-stream");
    expect(mediaTypeFor("Makefile")).toBe("application/octet-stream");
  });
});

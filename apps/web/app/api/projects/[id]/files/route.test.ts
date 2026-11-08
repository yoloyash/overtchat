import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getProject: vi.fn(),
  listProjectFiles: vi.fn(),
  addProjectFile: vi.fn(),
  removeProjectFile: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/db/project-files", () => ({
  listProjectFiles: mocks.listProjectFiles,
  addProjectFile: mocks.addProjectFile,
  removeProjectFile: mocks.removeProjectFile,
}));
import { GET, POST } from "./route";
import { DELETE } from "./[uploadId]/route";

const params = Promise.resolve({ id: "p" });
const fileParams = Promise.resolve({ id: "p", uploadId: "u" });
const file = { uploadId: "u", url: "/api/uploads/u", filename: "spec.pdf" };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/projects/p/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "alice" } });
  mocks.getProject.mockResolvedValue({ id: "p" });
  mocks.listProjectFiles.mockResolvedValue([file]);
  mocks.addProjectFile.mockResolvedValue({ ok: true, created: true, file });
  mocks.removeProjectFile.mockResolvedValue(true);
});

describe("project files API", () => {
  it("requires authentication", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/projects/p/files"), { params })).status).toBe(401);
    expect((await post({ uploadId: "u" })).status).toBe(401);
    expect((await DELETE(new Request("http://localhost/api/projects/p/files/u", { method: "DELETE" }), { params: fileParams })).status).toBe(401);
    expect(mocks.listProjectFiles).not.toHaveBeenCalled();
    expect(mocks.addProjectFile).not.toHaveBeenCalled();
    expect(mocks.removeProjectFile).not.toHaveBeenCalled();
  });

  it("lists the owner's files without shared caching", async () => {
    const response = await GET(new Request("http://localhost/api/projects/p/files"), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ files: [file] });
    expect(mocks.listProjectFiles).toHaveBeenCalledWith("p", "alice");

    mocks.getProject.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/projects/p/files"), { params })).status).toBe(404);
  });

  it("validates the link body", async () => {
    for (const body of ["not json", {}, { uploadId: 5 }, { uploadId: "../x" }, { uploadId: "u", sourceChatId: 1 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(mocks.addProjectFile).not.toHaveBeenCalled();
  });

  it("links a file and reports whether it was new", async () => {
    const created = await post({ uploadId: "u", sourceChatId: "c" });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ file });
    expect(mocks.addProjectFile).toHaveBeenCalledWith({
      projectId: "p",
      userId: "alice",
      uploadId: "u",
      sourceChatId: "c",
    });

    mocks.addProjectFile.mockResolvedValue({ ok: true, created: false, file });
    expect((await post({ uploadId: "u" })).status).toBe(200);
    expect(mocks.addProjectFile).toHaveBeenLastCalledWith(expect.objectContaining({ sourceChatId: null }));
  });

  it.each([
    ["project-not-found", 404, undefined],
    ["upload-not-found", 400, "That file is not available."],
    ["image", 400, "Project files are documents and text. Attach images to a message instead."],
    ["limit", 400, "A project holds up to 50 files."],
  ])("maps the %s result", async (reason, status, error) => {
    mocks.addProjectFile.mockResolvedValue({ ok: false, reason });
    const response = await post({ uploadId: "u" });
    expect(response.status).toBe(status);
    if (error) expect(await response.json()).toEqual({ error });
  });

  it("unlinks a file", async () => {
    const request = new Request("http://localhost/api/projects/p/files/u", { method: "DELETE" });
    expect((await DELETE(request, { params: fileParams })).status).toBe(204);
    expect(mocks.removeProjectFile).toHaveBeenCalledWith("p", "alice", "u");
    mocks.removeProjectFile.mockResolvedValue(false);
    expect((await DELETE(request, { params: fileParams })).status).toBe(404);
  });
});

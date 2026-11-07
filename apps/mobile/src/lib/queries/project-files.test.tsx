import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type ProjectFileItem,
  useAddProjectFile,
  useProjectFiles,
  useRemoveProjectFile,
} from "./project-files";
import { queryKeys } from "./keys";

const request = vi.hoisted(() => vi.fn<typeof fetch>());
const upload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  getApiBase: () => "https://chat.example",
  authFetch: request,
  uploadFile: upload,
}));

const spec: ProjectFileItem = {
  uploadId: "spec",
  url: "/api/uploads/spec",
  filename: "spec.pdf",
  mediaType: "application/pdf",
  category: "document",
  size: 10,
  pageCount: 2,
  truncated: false,
  addedAt: 1,
  sourceChat: null,
};

let root: Root;
let client: QueryClient;
let hooks: {
  files: ReturnType<typeof useProjectFiles>;
  add: ReturnType<typeof useAddProjectFile>;
  remove: ReturnType<typeof useRemoveProjectFile>;
};
function Probe({ projectId }: { projectId: string | null }) {
  const files = useProjectFiles(projectId);
  const add = useAddProjectFile(projectId ?? "");
  const remove = useRemoveProjectFile(projectId ?? "");
  useEffect(() => {
    hooks = { files, add, remove };
  }, [files, add, remove]);
  return null;
}
function render(projectId: string | null) {
  return act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe projectId={projectId} />
      </QueryClientProvider>,
    ),
  );
}

beforeEach(() => {
  request.mockReset();
  upload.mockReset();
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("stays idle without a project and lists files for one", async () => {
  await render(null);
  expect(request).not.toHaveBeenCalled();
  expect(hooks.files.fetchStatus).toBe("idle");

  request.mockImplementation(() => Promise.resolve(Response.json({ files: [spec] })));
  await render("p");
  await vi.waitFor(() =>
    expect(client.getQueryData(queryKeys.projectFiles("p"))).toEqual([spec]),
  );
  expect(request).toHaveBeenCalledWith("https://chat.example/api/projects/p/files");
});

it("uploads a picked file through the attachment route, then links it", async () => {
  client.setQueryData(queryKeys.projectFiles("p"), []);
  upload.mockResolvedValue({ url: "/api/uploads/spec", mediaType: "application/pdf" });
  request.mockImplementation((_url, init) =>
    Promise.resolve(
      init?.method === "POST" ? Response.json({ file: spec }, { status: 201 }) : Response.json({ files: [spec] }),
    ),
  );
  await render("p");
  const picked = { uri: "file:///tmp/spec.pdf", name: "spec.pdf", type: "application/pdf" };
  await act(async () => {
    await hooks.add.mutateAsync(picked);
  });
  expect(upload).toHaveBeenCalledWith(picked);
  expect(request).toHaveBeenCalledWith(
    "https://chat.example/api/projects/p/files",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ uploadId: "spec" }) }),
  );
  expect(client.getQueryData(queryKeys.projectFiles("p"))).toEqual([spec]);
});

it("surfaces the server's reason when a link is refused", async () => {
  client.setQueryData(queryKeys.projectFiles("p"), []);
  upload.mockResolvedValue({ url: "/api/uploads/photo", mediaType: "image/png" });
  request.mockResolvedValue(
    Response.json({ error: "Project files are documents and text." }, { status: 400 }),
  );
  await render("p");
  await expect(
    act(() => hooks.add.mutateAsync({ uri: "file:///p.png", name: "p.png", type: "image/png" })),
  ).rejects.toThrow("Project files are documents and text.");
});

it("removes a file from the cached list", async () => {
  client.setQueryData(queryKeys.projectFiles("p"), [spec]);
  request.mockResolvedValue(new Response(null, { status: 204 }));
  await render("p");
  await act(async () => {
    await hooks.remove.mutateAsync("spec");
  });
  expect(request).toHaveBeenCalledWith(
    "https://chat.example/api/projects/p/files/spec",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(client.getQueryData(queryKeys.projectFiles("p"))).toEqual([]);
});

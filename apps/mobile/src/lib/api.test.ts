import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  server: "https://chat.example",
  cookie: vi.fn<() => Promise<string>>(),
  fetch: vi.fn<typeof fetch>(async () =>
    Response.json({ url: "/api/uploads/image.png", mediaType: "image/png" }),
  ),
}));
vi.mock("@/lib/auth/client", () => {
  const client = { getCookie: mocks.cookie };
  return { getAuthClient: () => client };
});
vi.mock("@/lib/server-url", () => ({ getServerUrl: () => mocks.server }));
vi.mock("expo/fetch", () => ({ fetch: mocks.fetch }));
vi.mock("expo-file-system", () => ({
  File: class extends Blob {
    constructor() {
      super(["image"]);
    }
  },
}));
import { authFetch, uploadFile } from "./api";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.server = "https://chat.example";
});

it("waits for SecureStore before sending an authenticated request", async () => {
  let resolve!: (cookie: string) => void;
  mocks.cookie.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = authFetch("https://chat.example/api/chats", {
    headers: { Accept: "application/json" },
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
  resolve("session=test-cookie");
  await pending;
  const init = mocks.fetch.mock.calls[0][1]!;
  expect(init.credentials).toBe("omit");
  expect((init.headers as Headers).get("Cookie")).toBe("session=test-cookie");
  expect((init.headers as Headers).get("Accept")).toBe("application/json");
});

it("keeps an explicitly scoped notification cookie without reading another login", async () => {
  await authFetch("https://previous.example/api/push-devices", {
    headers: { Cookie: "previous-session" },
  });
  expect(mocks.cookie).not.toHaveBeenCalled();
  expect((mocks.fetch.mock.calls[0][1]!.headers as Headers).get("Cookie")).toBe(
    "previous-session",
  );
});

it("does not send a request when secure storage fails", async () => {
  mocks.cookie.mockRejectedValue(new Error("storage unavailable"));
  await expect(authFetch("https://chat.example/api/chats")).rejects.toThrow(
    "storage unavailable",
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("does not send a delayed cookie to the previous server after switching", async () => {
  let finish!: (cookie: string) => void;
  mocks.cookie.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = authFetch("https://chat.example/api/chats");
  mocks.server = "https://other.example";
  finish("other-server-cookie");
  await expect(request).rejects.toThrow("Server changed");
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("awaits the cookie for multipart uploads and keeps native cookie handling disabled", async () => {
  mocks.cookie.mockResolvedValue("session=upload-cookie");
  await uploadFile({
    uri: "file:///image.png",
    name: "image.png",
    type: "image/png",
  });
  expect(mocks.fetch).toHaveBeenCalledWith(
    "https://chat.example/api/uploads",
    expect.objectContaining({
      method: "POST",
      credentials: "omit",
      headers: { Cookie: "session=upload-cookie" },
    }),
  );
});

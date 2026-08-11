import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import { materializeAgentImages } from "./materialize-images";

describe("agent image materialization", () => {
  it("writes image bytes on the selected host", async () => {
    const target = {
      connectorId: "connector",
      transport: "ssh" as const,
      alias: "macbook",
    };
    mocks.executeOnHost.mockResolvedValue({
      stdout: JSON.stringify(["/tmp/overtchat-agent-images/image.png"]),
      stderr: "",
      code: 0,
      signal: null,
    });

    await expect(
      materializeAgentImages(target, [
        {
          uploadId: "11111111-1111-4111-8111-111111111111",
          filename: "image.png",
          mediaType: "image/png",
          data: "aW1hZ2U=",
        },
      ]),
    ).resolves.toEqual(["/tmp/overtchat-agent-images/image.png"]);

    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      target,
      {
        command: "node",
        args: ["-e", expect.stringContaining("overtchat-agent-images")],
      },
      {
        timeoutMs: 60_000,
        stdin: JSON.stringify([
          { data: "aW1hZ2U=", mediaType: "image/png" },
        ]),
      },
    );
  });

  it("rejects invalid host output and skips empty batches", async () => {
    mocks.executeOnHost.mockClear();
    await expect(
      materializeAgentImages(
        { transport: "local" },
        [],
      ),
    ).resolves.toEqual([]);
    expect(mocks.executeOnHost).not.toHaveBeenCalled();

    mocks.executeOnHost.mockResolvedValue({
      stdout: "{}",
      stderr: "",
      code: 0,
      signal: null,
    });
    await expect(
      materializeAgentImages(
        { transport: "local" },
        [
          {
            uploadId: "11111111-1111-4111-8111-111111111111",
            filename: "image.png",
            mediaType: "image/png",
            data: "aW1hZ2U=",
          },
        ],
      ),
    ).rejects.toThrow("invalid image paths");
  });
});

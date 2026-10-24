import { describe, expect, it, vi } from "vitest";
import {
  waitForSignInApproval,
  type SignInApprovalState,
} from "@overtchat/shared";

const pending: SignInApprovalState = {
  status: "pending",
  number: 42,
  expiresAt: "2026-10-23T12:05:00.000Z",
};

describe("waitForSignInApproval", () => {
  it("shows the number, then holds requests open until the answer", async () => {
    const read = vi
      .fn<(wait: boolean) => Promise<SignInApprovalState>>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ status: "approved", code: "0123456789" });
    const onPending = vi.fn();
    await expect(
      waitForSignInApproval({ read, onPending, signal: new AbortController().signal }),
    ).resolves.toEqual({ status: "approved", code: "0123456789" });
    expect(read.mock.calls.map(([wait]) => wait)).toEqual([false, true, true]);
    expect(onPending).toHaveBeenCalledTimes(2);
  });

  it("retries a dropped connection, then gives up", async () => {
    const read = vi
      .fn<(wait: boolean) => Promise<SignInApprovalState>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ status: "denied" });
    await expect(
      waitForSignInApproval({
        read,
        onPending: () => {},
        signal: new AbortController().signal,
        retryDelayMs: 0,
      }),
    ).resolves.toEqual({ status: "denied" });

    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      waitForSignInApproval({
        read: failing,
        onPending: () => {},
        signal: new AbortController().signal,
        retryDelayMs: 0,
        maxFailures: 3,
      }),
    ).rejects.toThrow("offline");
    expect(failing).toHaveBeenCalledTimes(3);
  });

  it("stops when the sign-in screen goes away", async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => {
      controller.abort();
      return pending;
    });
    await expect(
      waitForSignInApproval({ read, onPending: () => {}, signal: controller.signal }),
    ).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

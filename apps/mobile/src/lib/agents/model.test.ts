import { describe, it, expect } from "vitest";
import { snapshot } from "./test-fixtures";
import {
  agentImageSource,
  prepareSubmission,
  sessionModes,
  sessionStatus,
  submitCommand,
} from "./model";
import {
  interactionFormComplete,
  interactionFormFields,
  normalizeFormValues,
  safeExternalUrl,
} from "./interaction";

describe("mobile agent submissions", () => {
  it("queues busy followups but executes slash commands immediately", () => {
    expect(submitCommand(snapshot("running"), "hello", []).type).toBe("queue");
    expect(
      submitCommand(
        { ...snapshot(), state: { isCompacting: true } },
        "hello",
        [],
      ).type,
    ).toBe("queue");
    expect(submitCommand(snapshot("running"), "/compact notes", [])).toEqual({
      type: "compact",
      customInstructions: "notes",
    });
    expect(submitCommand(snapshot(), "/usage", [])).toEqual({
      type: "show_usage",
    });
    expect(submitCommand(snapshot(), "/my-skill argument", []).type).toBe(
      "prompt",
    );
  });
  it("retains the original wire command on an unchanged retry even when the agent becomes idle", () => {
    const first = prepareSubmission(
      snapshot("running"),
      " fix this ",
      [],
      undefined,
      () => "one",
    );
    const retry = prepareSubmission(
      snapshot(),
      "fix this",
      [],
      first.pending,
      () => "two",
    );
    expect(retry.command).toEqual(first.command);
    expect(retry.command).toMatchObject({
      type: "queue",
      clientMessageId: "one",
    });
    expect(
      prepareSubmission(
        snapshot(),
        "something else",
        [],
        first.pending,
        () => "two",
      ).command,
    ).toMatchObject({ clientMessageId: "two" });
  });
  it("uses a fresh identity for a new send of the same text after acknowledgement", () => {
    const first = prepareSubmission(
      snapshot(),
      "hello",
      [],
      undefined,
      () => "one",
    );
    expect(
      prepareSubmission(snapshot(), "hello", [], undefined, () => "two")
        .command,
    ).not.toEqual(first.command);
  });
  it("preserves image-only prompts and does not interpret image captions as slash commands", () => {
    const images = [
      {
        uploadId: "image",
        filename: "shot.png",
        mediaType: "image/png" as const,
      },
    ];
    expect(submitCommand(snapshot(), "", images)).toEqual({
      type: "prompt",
      message: "",
      images,
    });
    expect(submitCommand(snapshot(), "/usage", images).type).toBe("prompt");
  });
  it("shows waiting and read-only state before ordinary running state", () => {
    expect(
      sessionStatus({
        ...snapshot("running"),
        pendingInteraction: {
          type: "interaction_request",
          id: "approval",
          method: "confirm",
        },
      }),
    ).toBe("Waiting for you");
    expect(
      sessionStatus({
        ...snapshot(),
        readOnly: { reason: "Busy elsewhere", retryable: true },
      }),
    ).toBe("Read only");
    expect(
      sessionModes({
        ...snapshot(),
        state: {
          modes: [{ id: "full", label: "Full access", dangerous: true }, null],
        },
      }),
    ).toHaveLength(1);
  });
});

describe("mobile image authentication", () => {
  it("only sends the cookie to this server's uploads", () => {
    expect(
      agentImageSource("/api/uploads/one", "https://chat.example", "secret"),
    ).toEqual({
      uri: "https://chat.example/api/uploads/one",
      headers: { Cookie: "secret" },
    });
    for (const url of [
      "https://evil.example/api/uploads/one",
      "//evil.example/one",
      "file:///etc/passwd",
      "/api/other",
      "data:text/html;base64,aaaa",
    ]) {
      expect(
        agentImageSource(url, "https://chat.example", "secret"),
      ).toBeNull();
    }
    expect(
      agentImageSource(
        "data:image/png;base64,aaaa",
        "https://chat.example",
        "secret",
      ),
    ).toEqual({ uri: "data:image/png;base64,aaaa" });
  });
});

describe("agent question forms", () => {
  const fields = interactionFormFields([
    {
      id: "size",
      label: "Size",
      type: "number",
      required: true,
      minimum: 1,
      maximum: 10,
    },
    { id: "confirm", type: "boolean", required: true },
    {
      id: "choice",
      type: "select",
      options: [{ value: "a", label: "A" }],
      required: true,
    },
    { id: "notes", type: "text" },
  ]);
  it("accepts false and validates numeric bounds and selections", () => {
    expect(
      interactionFormComplete(fields, { size: 1, confirm: false, choice: "a" }),
    ).toBe(true);
    for (const size of [0, 11, NaN])
      expect(
        interactionFormComplete(fields, { size, confirm: false, choice: "a" }),
      ).toBe(false);
    expect(
      interactionFormComplete(fields, {
        size: 2,
        confirm: false,
        choice: "bad",
      }),
    ).toBe(false);
    expect(interactionFormComplete(fields, { size: 2, choice: "a" })).toBe(
      false,
    );
  });
  it("keeps meaningful false/zero values and omits empty answers", () => {
    expect(
      normalizeFormValues(fields, { size: 0, confirm: false, notes: "" }),
    ).toEqual({ size: 0, confirm: false });
  });
  it("only opens HTTP authorization links", () => {
    expect(safeExternalUrl("https://auth.example/approve")).toBe(
      "https://auth.example/approve",
    );
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
  });
});

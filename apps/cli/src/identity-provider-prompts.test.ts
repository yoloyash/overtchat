import { beforeEach, describe, expect, it, vi } from "vitest";
import { promptIdentityProvider } from "./identity-provider-prompts.js";
import type { IdentityProviderConfig } from "./types.js";

const answers = vi.hoisted(() => new Map<string, unknown[]>());
const asked = vi.hoisted(() => [] as string[]);
const notes = vi.hoisted(() => [] as Array<{ message: string; title: string }>);
const validators = vi.hoisted(
  () => new Map<string, (value: string | undefined) => string | undefined>(),
);

vi.mock("@clack/prompts", () => {
  // Each question takes its next queued answer, or its initial value.
  const prompt = async (options: {
    message: string;
    initialValue?: unknown;
    validate?: (value: string | undefined) => string | undefined;
  }) => {
    asked.push(options.message);
    if (options.validate) validators.set(options.message, options.validate);
    const queued = answers.get(options.message);
    return queued?.length ? queued.shift() : options.initialValue;
  };
  return {
    cancel: vi.fn(),
    confirm: prompt,
    isCancel: () => false,
    note: (message: string, title: string) => notes.push({ message, title }),
    password: prompt,
    select: prompt,
    text: prompt,
  };
});

const QUESTION = "Sign in with an identity provider?";
const options = {
  publicUrl: "https://chat.example.com",
  secretStored: false,
  check: vi.fn(async () => null as string | null),
};
const current: IdentityProviderConfig = {
  issuerUrl: "https://id.example.com",
  clientId: "overtchat",
  name: "Pocket ID",
  autoCreateUsers: false,
  disablePasswordLogin: false,
};

function answer(message: string, ...values: unknown[]) {
  answers.set(message, values);
}

beforeEach(() => {
  answers.clear();
  validators.clear();
  asked.length = 0;
  notes.length = 0;
  options.check.mockReset().mockResolvedValue(null);
});

describe("the identity provider question", () => {
  it("defaults to setting it up later and asks nothing else", async () => {
    expect(await promptIdentityProvider(undefined, options)).toBeUndefined();
    expect(asked).toEqual([QUESTION]);
    expect(options.check).not.toHaveBeenCalled();
  });

  it("shows the redirect address to register and collects the client", async () => {
    answer(QUESTION, "configure");
    answer("Issuer URL", "https://id.example.com/");
    answer("Client ID", " overtchat ");
    answer("Client secret", "s3cret");
    answer("Name on the sign-in button", " Pocket ID ");

    expect(await promptIdentityProvider(undefined, options)).toEqual({
      ...current,
      clientSecret: "s3cret",
    });
    expect(
      notes.find((note) => note.title === "Register OvertChat with the provider")
        ?.message,
    ).toContain(
      "Redirect address: https://chat.example.com/api/auth/callback/oidc",
    );
    expect(options.check).toHaveBeenCalledWith("https://id.example.com");
    // Neither account creation nor passwords off is chosen by default.
    expect(notes.some((note) => note.title === "Passwords off")).toBe(false);
    expect(validators.get("Client secret")?.("")).toBe("Enter the client secret.");
  });

  it("keeps a configured provider by default, secret and all", async () => {
    expect(
      await promptIdentityProvider(current, { ...options, secretStored: true }),
    ).toEqual(current);
    expect(asked).toEqual([QUESTION]);
  });

  it("turns the provider off", async () => {
    answer(QUESTION, "off");
    expect(
      await promptIdentityProvider(
        { ...current, disablePasswordLogin: true },
        { ...options, secretStored: true },
      ),
    ).toBeUndefined();
  });

  it("changes settings without asking for the stored secret again", async () => {
    answer(QUESTION, "configure");
    answer("Turn off password sign-in?", true);

    const changed = await promptIdentityProvider(current, {
      ...options,
      secretStored: true,
    });

    // Everything else kept its current value; no secret travels with it.
    expect(changed).toEqual({ ...current, disablePasswordLogin: true });
    expect(asked).toContain("Client secret (leave blank to keep current)");
    expect(
      validators.get("Client secret (leave blank to keep current)")?.(""),
    ).toBeUndefined();
    expect(
      notes.find((note) => note.title === "Passwords off")?.message,
    ).toContain("run overtchat setup again and keep passwords");
  });

  it("asks again for an issuer that can't be read, or keeps it on request", async () => {
    answer(QUESTION, "configure");
    answer("Issuer URL", "https://typo.example.com", "https://id.example.com");
    answer("Use this address anyway?", false);
    answer("Client ID", "overtchat");
    answer("Client secret", "s3cret");
    answer("Name on the sign-in button", "Pocket ID");
    options.check
      .mockResolvedValueOnce("it didn't answer")
      .mockResolvedValueOnce(null);

    expect(
      (await promptIdentityProvider(undefined, options))?.issuerUrl,
    ).toBe("https://id.example.com");
    expect(
      notes.find((note) => note.title === "Provider not reached")?.message,
    ).toContain("https://typo.example.com from this computer: it didn't answer");

    answer(QUESTION, "configure");
    answer("Issuer URL", "https://internal.example.com");
    answer("Use this address anyway?", true);
    answer("Client ID", "overtchat");
    answer("Client secret", "s3cret");
    answer("Name on the sign-in button", "Pocket ID");
    options.check.mockResolvedValueOnce("it didn't answer");

    expect(
      (await promptIdentityProvider(undefined, options))?.issuerUrl,
    ).toBe("https://internal.example.com");
  });
});

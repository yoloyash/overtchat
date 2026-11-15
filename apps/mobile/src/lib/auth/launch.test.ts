import { createAuthClient } from "better-auth/client";
import { expect, it, vi } from "vitest";
import { sessionKnown } from "./launch";

const signedIn = {
  session: { id: "session-1", userId: "user-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  user: { id: "user-1", email: "a@example.com" },
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// A client whose session checks wait for the test to answer them.
function client() {
  const answers: Array<(response: Response) => void> = [];
  const auth = createAuthClient({
    baseURL: "https://chat.example",
    fetchOptions: {
      customFetchImpl: (() =>
        new Promise<Response>((resolve) => answers.push(resolve))) as typeof fetch,
    },
  });
  const known: boolean[] = [];
  auth.useSession.listen((session) => known.push(sessionKnown(session)));
  return {
    known,
    session: () => auth.useSession.get(),
    async check(body: unknown) {
      const before = answers.length;
      const done = auth.useSession.get().refetch();
      await vi.waitFor(() => expect(answers.length).toBe(before + 1));
      const duringCheck = sessionKnown(auth.useSession.get());
      answers[before](json(body));
      await done;
      return duringCheck;
    },
  };
}

it("does not know the session until the first check answers", async () => {
  const auth = client();
  expect(sessionKnown(auth.session())).toBe(false);

  expect(await auth.check(signedIn)).toBe(false);

  expect(auth.known).toEqual([false, true]);
  expect(auth.session().data?.user.id).toBe("user-1");
});

it("knows a signed-out session once the server says so", async () => {
  const auth = client();

  expect(await auth.check(null)).toBe(false);

  expect(sessionKnown(auth.session())).toBe(true);
  expect(auth.session().data).toBeNull();
});

it("knows a stored session while the first check is still pending", () => {
  expect(sessionKnown({ data: signedIn, isPending: true })).toBe(true);
});

// The root layout waits on this only at launch for that reason: unmounting the
// screens here would reset the login form's two-factor step.
it("reports a signed-out session as unknown again while it is rechecked", async () => {
  const auth = client();
  await auth.check(null);

  expect(await auth.check(null)).toBe(false);
});

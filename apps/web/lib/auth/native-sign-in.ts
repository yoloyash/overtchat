import "server-only";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { NATIVE_SIGN_IN_EXCHANGE_PATH } from "@overtchat/shared";
import { z } from "zod";
import { redeemNativeSignInCode } from "@/lib/db/nativeSignIn";

const START_WINDOW_MS = 60_000;
/** Far above what the people on one server start, far below a flood. */
const START_MAX = 60;

/**
 * Starting a sign-in needs no login and stores a row, so the whole server
 * shares one budget; an address-based one could be dodged with forged
 * forwarding headers. Returns the seconds to wait when it is spent.
 */
export function createNativeSignInStartLimiter(now = Date.now) {
  let count = 0;
  let reset = 0;
  return (): number | null => {
    const time = now();
    if (time >= reset) {
      count = 0;
      reset = time + START_WINDOW_MS;
    }
    if (count >= START_MAX)
      return Math.max(1, Math.ceil((reset - time) / 1000));
    count++;
    return null;
  };
}

export const limitNativeSignInStart = createNativeSignInStartLimiter();

/**
 * The last step of an app's sign-in through the system browser, described in
 * `@overtchat/shared/sign-in`: the app trades the code its redirect carried,
 * and the secret it kept, for a session of its own. Better Auth creates the
 * session, so bans and the bearer and Expo plugins apply as for any sign-in.
 */
export function nativeSignIn() {
  return {
    id: "overtchat-native-sign-in",
    endpoints: {
      exchangeNativeSignIn: createAuthEndpoint(
        NATIVE_SIGN_IN_EXCHANGE_PATH,
        {
          method: "POST",
          body: z.object({
            code: z.string().min(1).max(256),
            codeVerifier: z.string().min(43).max(128),
          }),
        },
        async (ctx) => {
          const expired = () =>
            new APIError("BAD_REQUEST", {
              code: "NATIVE_SIGN_IN_EXPIRED",
              message: "That sign-in took too long. Try again.",
            });
          const userId = redeemNativeSignInCode(
            ctx.body.code,
            ctx.body.codeVerifier,
          );
          if (!userId) throw expired();
          const user = await ctx.context.internalAdapter.findUserById(userId);
          if (!user) throw expired();
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Couldn't sign in. Try again.",
            });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ token: session.token, user });
        },
      ),
    },
  };
}

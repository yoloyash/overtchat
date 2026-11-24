import { signInMethods } from "@/lib/auth/oidc";

/** Public: what the login screen offers. It reveals no more than the screen does. */
export function GET() {
  return Response.json(signInMethods(), {
    headers: { "Cache-Control": "no-store" },
  });
}

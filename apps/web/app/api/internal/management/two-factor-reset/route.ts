import { z } from "zod";
import { findUserByEmail } from "@/lib/db/passwords";
import { resetUserTwoFactor } from "@/lib/db/twoFactor";
import { managementRequestAuthorized } from "@/lib/management/auth";

export async function POST(request: Request) {
  if (!managementRequestAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const parsed = z
    .object({ email: z.email().trim().toLowerCase() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const target = findUserByEmail(parsed.data.email);
  if (!target)
    return Response.json({ error: "User not found." }, { status: 404 });
  const result = resetUserTwoFactor(target.id);
  if (result === "not_found")
    return Response.json({ error: "User not found." }, { status: 404 });
  if (result === "not_enabled") {
    return Response.json(
      { error: "This user hasn't set up two-factor." },
      { status: 409 },
    );
  }
  return Response.json({ status: true });
}

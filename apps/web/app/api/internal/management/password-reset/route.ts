import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { findUserByEmail, resetUserPassword } from "@/lib/db/passwords";
import { managementRequestAuthorized } from "@/lib/management/auth";

export async function POST(request: Request) {
  if (!managementRequestAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const parsed = z
    .object({
      email: z.email().trim().toLowerCase(),
      newPassword: z.string().min(1).max(128),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Enter a valid email and password." },
      { status: 400 },
    );
  }
  const context = await auth.$context;
  const { minPasswordLength, maxPasswordLength } = context.password.config;
  if (
    parsed.data.newPassword.length < minPasswordLength ||
    parsed.data.newPassword.length > maxPasswordLength
  ) {
    return Response.json(
      {
        error: `Use between ${minPasswordLength} and ${maxPasswordLength} characters.`,
      },
      { status: 400 },
    );
  }
  const target = findUserByEmail(parsed.data.email);
  if (!target)
    return Response.json({ error: "User not found." }, { status: 404 });
  const hash = await context.password.hash(parsed.data.newPassword);
  const result = resetUserPassword(target.id, hash);
  if (result === "not_found")
    return Response.json({ error: "User not found." }, { status: 404 });
  if (result !== "updated") {
    return Response.json(
      { error: "This account does not use a password." },
      { status: 409 },
    );
  }
  return Response.json({ status: true });
}

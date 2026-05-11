"use server";

import { auth } from "@/lib/auth/server";

export async function bootstrapSignUp(input: {
  email: string;
  password: string;
}): Promise<{ error?: string }> {
  try {
    await auth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: input.email,
      },
    });
    return {};
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { count } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { LoginForm } from "./LoginForm";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/");

  const [{ n }] = await db.select({ n: count() }).from(user);
  if (n === 0) redirect("/signup");

  return <LoginForm />;
}

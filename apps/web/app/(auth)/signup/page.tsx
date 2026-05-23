import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [{ n }] = await db.select({ n: count() }).from(user);
  if (n > 0) redirect("/login");
  return <SignupForm />;
}

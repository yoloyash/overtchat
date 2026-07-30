import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { ProfileForm } from "./ProfileForm";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <ProfileForm
      userId={session.user.id}
      name={session.user.name}
      image={session.user.image ?? null}
    />
  );
}

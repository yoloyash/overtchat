import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { auth } from "@/lib/auth/server";
import {
  listServerCapabilities,
  toAdminServerCapability,
} from "@/lib/db/serverCapabilities";
import { getQueryClient } from "@/lib/queryClient";
import { serverCapabilityKeys } from "@/lib/queries/keys";
import { getVoiceCapability } from "@/lib/voice/capability";
import { ServicesPanel } from "./ServicesPanel";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: serverCapabilityKeys.list(),
    queryFn: async () => ({
      capabilities: listServerCapabilities().map(toAdminServerCapability),
      voice: getVoiceCapability(),
    }),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ServicesPanel />
    </HydrationBoundary>
  );
}

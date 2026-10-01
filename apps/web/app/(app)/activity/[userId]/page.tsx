import { ActivityProfile } from "@/components/activity/ActivityProfile";

export default async function ActivityProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <ActivityProfile userId={userId} />;
}

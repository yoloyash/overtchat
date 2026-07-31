import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { getChat, getMessages } from "@/lib/db/chats";
import { getChatUsageTotals } from "@/lib/db/usage";
import { ChatArea } from "@/components/chat/ChatArea";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const chat = await getChat(id, session.user.id);
  if (!chat) redirect("/");
  const [initialMessages, initialUsage] = await Promise.all([
    getMessages(id),
    getChatUsageTotals(id, session.user.id),
  ]);
  return (
    <ChatArea
      key={id}
      chatId={id}
      projectId={chat.projectId ?? null}
      initialMessages={initialMessages}
      initialUsage={initialUsage}
    />
  );
}

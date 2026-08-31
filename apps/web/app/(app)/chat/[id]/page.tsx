import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { getChat, getMessagesPage } from "@/lib/db/chats";
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
  const initialPage = await getMessagesPage(id);
  return (
    <ChatArea
      key={id}
      chatId={id}
      chatKind={chat.kind}
      projectId={chat.projectId ?? null}
      initialMessages={initialPage.messages}
      initialMessageCursor={initialPage.nextCursor}
    />
  );
}

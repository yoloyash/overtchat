import { ChatArea } from "@/components/chat/ChatArea";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; q?: string }>;
}) {
  const { projectId, q } = await searchParams;
  const chatId = crypto.randomUUID();
  return (
    <ChatArea
      key={chatId}
      chatId={chatId}
      projectId={projectId ?? null}
      initialQuery={q}
      isNew
    />
  );
}

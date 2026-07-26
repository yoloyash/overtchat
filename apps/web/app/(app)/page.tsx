import { ChatArea } from "@/components/chat/ChatArea";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; q?: string | string[] }>;
}) {
  const { projectId, q } = await searchParams;
  const initialQuery = Array.isArray(q) ? q[0] : q;
  const chatId = crypto.randomUUID();
  return (
    <ChatArea
      key={chatId}
      chatId={chatId}
      projectId={projectId ?? null}
      initialQuery={initialQuery}
      isNew
    />
  );
}

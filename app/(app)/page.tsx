import { ChatArea } from "@/components/ChatArea";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  const chatId = crypto.randomUUID();
  return (
    <ChatArea
      key={chatId}
      chatId={chatId}
      projectId={projectId ?? null}
      isNew
    />
  );
}

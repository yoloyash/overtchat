import { ChatArea } from "@/components/ChatArea";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  return (
    <ChatArea
      chatId={crypto.randomUUID()}
      projectId={projectId ?? null}
      isNew
    />
  );
}

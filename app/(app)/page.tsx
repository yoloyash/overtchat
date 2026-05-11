import { ChatArea } from "@/components/ChatArea";

export default function Home() {
  return <ChatArea chatId={crypto.randomUUID()} isNew />;
}

import { type ComponentProps, useCallback, useState } from "react";
import {
  createRoute,
  redirect,
  useMatch,
  useNavigate,
} from "@tanstack/react-router";
import { ChatArea } from "@/components/chat/ChatArea";
import { fetchChatMessagesPage } from "@/lib/queries/chats";
import { randomUuid } from "@/lib/uuid";
import { AppPending, ChatPending } from "@/spa/pending";
import { appRoute } from "@/spa/routes/root";
import { optionalString } from "@/spa/search";

/**
 * Drafts that were just saved and moved from `/` to `/chat/$id`. Their chat
 * is already on screen, so the chat route skips fetching its history once.
 */
const persistedDrafts = new Set<string>();

// Both chat routes render the same component under this remount key, so
// moving a new chat from `/` to its own URL keeps the live ChatArea.
const chatSurfaceRemountDeps = () => "chat-surface";

export const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  validateSearch: (
    search: Record<string, unknown>,
  ): { projectId?: string; q?: string } => ({
    projectId: optionalString(search.projectId),
    q: optionalString(search.q),
  }),
  loaderDeps: ({ search }) => search,
  // Each visit, including clicking "New chat" while already on `/`, starts a
  // fresh draft, so the loader result is never reused.
  loader: () => ({ chatId: randomUuid() }),
  gcTime: 0,
  remountDeps: chatSurfaceRemountDeps,
  pendingComponent: AppPending,
  component: ChatSurface,
});

export const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/chat/$id",
  loader: async ({ params }) => {
    if (persistedDrafts.delete(params.id)) return { page: null };
    const page = await fetchChatMessagesPage(params.id);
    if (!page) throw redirect({ to: "/" });
    return { page };
  },
  // ChatArea only reads history on mount, so always load it fresh.
  gcTime: 0,
  remountDeps: chatSurfaceRemountDeps,
  pendingComponent: ChatPending,
  component: ChatSurface,
});

type ChatAreaProps = ComponentProps<typeof ChatArea>;

function ChatSurface() {
  const navigate = useNavigate();
  const home = useMatch({ from: homeRoute.id, shouldThrow: false });
  const chat = useMatch({ from: chatRoute.id, shouldThrow: false });
  const routeProps: ChatAreaProps = home
    ? {
        chatId: home.loaderData!.chatId,
        projectId: home.search.projectId ?? null,
        initialQuery: home.search.q,
        isNew: true,
      }
    : chatAreaProps(chat!.params.id, chat!.loaderData!.page);
  // ChatArea's props seed its state on mount. Keep the first set for a chat
  // so its saved draft or a background reload does not change them.
  const [props, setProps] = useState(routeProps);
  if (routeProps.chatId !== props.chatId) setProps(routeProps);

  const { chatId } = props;
  const onPersisted = useCallback(() => {
    persistedDrafts.add(chatId);
    void navigate({
      to: "/chat/$id",
      params: { id: chatId },
      replace: true,
      resetScroll: false,
    });
  }, [chatId, navigate]);

  return <ChatArea key={chatId} {...props} onPersisted={onPersisted} />;
}

function chatAreaProps(
  chatId: string,
  page: Awaited<ReturnType<typeof fetchChatMessagesPage>>,
): ChatAreaProps {
  if (!page) return { chatId };
  return {
    chatId,
    chatKind: page.kind,
    projectId: page.projectId,
    initialMessages: page.messages,
    initialModelId: page.modelConfigId,
    initialMessageCursor: page.nextCursor,
  };
}

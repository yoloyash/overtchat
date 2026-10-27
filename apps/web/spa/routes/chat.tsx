import { type ComponentProps, useCallback, useEffect, useState } from "react";
import {
  createRoute,
  redirect,
  useMatch,
  useNavigate,
} from "@tanstack/react-router";
import { ChatArea } from "@/components/chat/ChatArea";
import { ProjectHome } from "@/components/projects/ProjectHome";
import { fetchChatMessagesPage } from "@/lib/queries/chats";
import { fetchProject, projectQuery } from "@/lib/queries/projects";
import { randomUuid } from "@/lib/uuid";
import { AppPending, ChatPending, ProjectPending } from "@/spa/pending";
import { appRoute } from "@/spa/routes/root";
import { optionalString } from "@/spa/search";

/**
 * The chat the mounted chat surface is showing. Its history is already on
 * screen, including a just-saved draft that moved from `/` to `/chat/$id`, so
 * the chat route does not fetch it. The router can rerun a loader for the
 * same location, so this stays set while the chat is shown.
 */
let shownChatId: string | null = null;

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

// A project's page is where its new chats start, so it shares the chat surface.
export const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$id",
  loader: async ({ context, params }) => {
    const project = await fetchProject(params.id);
    if (!project) throw redirect({ to: "/" });
    context.queryClient.setQueryData(projectQuery(params.id).queryKey, project);
    return { chatId: randomUuid() };
  },
  gcTime: 0,
  remountDeps: chatSurfaceRemountDeps,
  pendingComponent: ProjectPending,
  component: ChatSurface,
});

export const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/chat/$id",
  loader: async ({ params }) => {
    if (params.id === shownChatId) return { page: null };
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
  const project = useMatch({ from: projectRoute.id, shouldThrow: false });
  const chat = useMatch({ from: chatRoute.id, shouldThrow: false });
  const routeProps: ChatAreaProps = home
    ? {
        chatId: home.loaderData!.chatId,
        projectId: home.search.projectId ?? null,
        initialQuery: home.search.q,
        isNew: true,
      }
    : project
      ? projectHomeProps(project.loaderData!.chatId, project.params.id)
      : chatAreaProps(chat!.params.id, chat!.loaderData!.page);
  // ChatArea's props seed its state on mount. Keep the first set for a chat
  // so its saved draft or a background reload does not change them.
  const [props, setProps] = useState(routeProps);
  if (routeProps.chatId !== props.chatId) setProps(routeProps);

  const { chatId } = props;
  useEffect(() => {
    shownChatId = chatId;
    return () => {
      if (shownChatId === chatId) shownChatId = null;
    };
  }, [chatId]);
  const onPersisted = useCallback(() => {
    void navigate({
      to: "/chat/$id",
      params: { id: chatId },
      replace: true,
      resetScroll: false,
    });
  }, [chatId, navigate]);

  return <ChatArea key={chatId} {...props} onPersisted={onPersisted} />;
}

function projectHomeProps(chatId: string, projectId: string): ChatAreaProps {
  return {
    chatId,
    projectId,
    isNew: true,
    renderEmptyState: (composer, { selectModel }) => (
      <ProjectHome
        projectId={projectId}
        composer={composer}
        onDefaultModelChange={selectModel}
      />
    ),
  };
}

function chatAreaProps(
  chatId: string,
  page: Awaited<ReturnType<typeof fetchChatMessagesPage>>,
): ChatAreaProps {
  if (!page) return { chatId };
  return {
    chatId,
    projectId: page.projectId,
    initialMessages: page.messages,
    initialModelId: page.modelConfigId,
    initialMessageCursor: page.nextCursor,
  };
}

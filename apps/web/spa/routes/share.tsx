import { createRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "@/components/I18nProvider";
import { rootRoute } from "./root";
import { publicShareQuery } from "@/lib/queries/shares";
import { SharedTranscript } from "@/components/chat/SharedTranscript";
import { Button } from "@/components/ui/button";

export const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share/$id",
  component: SharedChatPage,
});

function SharedChatPage() {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const { id } = shareRoute.useParams();
  const query = useInfiniteQuery(publicShareQuery(id));
  const client = useQueryClient();
  const data = query.data?.pages[0];
  return (
    <div className="min-h-dvh overflow-auto bg-background text-foreground">
      <meta name="robots" content="noindex,nofollow,noarchive" />
      <meta name="referrer" content="no-referrer" />
      <title>
        {data?.title
          ? `${data.title} · OvertChat`
          : t("app.share.defaultPageTitle")}
      </title>
      <header className="border-b px-6 py-4">
        {/* eslint-disable-next-line i18next/no-literal-string -- product name */}
        <Link to="/" className="font-semibold">OvertChat</Link>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-8">
        {query.isPending ? (
          <p role="status">{t("app.share.loading")}</p>
        ) : query.error ? (
          <div role="alert" className="space-y-3">
            <p>{query.error.message}</p>
            <Button
              onClick={() =>
                void client.resetQueries({
                  queryKey: publicShareQuery(id).queryKey,
                })
              }
            >
              {t("app.share.reload")}
            </Button>
          </div>
        ) : data ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold wrap-anywhere">
                {data.title}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("app.share.meta", {
                  date: new Date(data.updatedAt!).toLocaleDateString(locale),
                })}
              </p>
            </div>
            <SharedTranscript
              messages={query.data!.pages.flatMap(
                (page) => page?.messages ?? [],
              )}
              formStates={query.data!.pages.flatMap(
                (page) => page?.formStates ?? [],
              )}
              onLoadMore={() => void query.fetchNextPage()}
              hasMore={query.hasNextPage}
              loadingMore={query.isFetchingNextPage}
            />
          </>
        ) : (
          <div>
            <h1 className="text-2xl font-semibold">{t("app.share.unavailableTitle")}</h1>
            <p className="mt-2 text-muted-foreground">
              {t("app.share.unavailableDescription")}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

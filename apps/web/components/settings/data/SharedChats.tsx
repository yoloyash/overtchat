import { useQuery } from "@tanstack/react-query";
import {
  sharesQuery,
  shareUrl,
  useChangeChatShare,
} from "@/lib/queries/shares";
import { SettingsSection } from "../SettingsRows";
import { Button } from "@/components/ui/button";

export function SharedChats() {
  const query = useQuery(sharesQuery);
  const change = useChangeChatShare();
  return (
    <SettingsSection
      title="Shared chats"
      description="Manage public links to your conversations."
    >
      {query.isPending ? (
        <p role="status" className="p-4 text-sm">
          Loading shared chats…
        </p>
      ) : query.error ? (
        <p role="alert" className="p-4 text-sm">
          {query.error.message}
        </p>
      ) : query.data?.shares.length ? (
        <ul className="divide-y">
          {query.data.shares.map((share) => (
            <li key={share.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <a
                  href={shareUrl(share)}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium underline"
                >
                  {share.title}
                </a>
                <p className="text-xs text-muted-foreground">
                  Updated {new Date(share.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={change.isPending}
                onClick={() =>
                  change.mutate({ chatId: share.chatId, method: "DELETE" })
                }
              >
                Unshare
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">No shared chats.</p>
      )}
      {change.error && (
        <p role="alert" className="p-4 text-sm text-destructive">
          {change.error.message}
        </p>
      )}
    </SettingsSection>
  );
}

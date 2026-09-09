import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { SidebarToggle } from "@/components/SidebarToggle";

export default function LibraryPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarToggle />
        <span className="text-sm font-medium">Library</span>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
        <div className="px-4 pb-4 pt-6 sm:px-6">
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="mt-2 text-sm text-muted-foreground">Files from your saved chats. Reuse them with “Add from library” in any chat.</p>
        </div>
        <LibraryBrowser />
      </div>
    </div>
  );
}

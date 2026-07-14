export default function ChatLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="size-8 rounded-md motion-skeleton" />
        <div className="h-4 w-48 rounded motion-skeleton" />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 pt-10 pb-8">
        <div className="ml-auto h-16 w-2/3 rounded-lg motion-skeleton" />
        <div className="h-28 w-5/6 rounded-lg motion-skeleton" />
        <div className="ml-auto h-14 w-1/2 rounded-lg motion-skeleton" />
      </div>
      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto h-24 max-w-3xl rounded-3xl motion-skeleton" />
      </div>
    </div>
  );
}

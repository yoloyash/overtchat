export default function AppLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="size-8 rounded-md motion-skeleton" />
        <div className="h-4 w-36 rounded motion-skeleton" />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end gap-6 px-4 py-8">
        <div className="h-20 w-4/5 rounded-lg motion-skeleton" />
        <div className="ml-auto h-14 w-2/3 rounded-lg motion-skeleton" />
        <div className="h-24 w-5/6 rounded-lg motion-skeleton" />
        <div className="h-24 rounded-3xl motion-skeleton" />
      </div>
    </div>
  );
}

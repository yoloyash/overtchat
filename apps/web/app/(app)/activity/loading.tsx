export default function ActivityLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 md:px-8">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-7 w-52 rounded motion-skeleton" />
          <div className="h-4 w-32 rounded motion-skeleton" />
        </div>
        <div className="h-8 w-56 rounded-md motion-skeleton" />
      </div>
      <div className="grid grid-cols-3 border-y">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-2 p-4">
            <div className="h-3 w-20 rounded motion-skeleton" />
            <div className="h-6 w-28 rounded motion-skeleton" />
          </div>
        ))}
      </div>
      <div className="space-y-px border-y">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex h-16 items-center gap-3 px-3">
            <div className="size-8 rounded-full motion-skeleton" />
            <div className="h-4 w-36 rounded motion-skeleton" />
            <div className="ml-auto h-4 w-20 rounded motion-skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}

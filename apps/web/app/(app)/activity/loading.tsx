import { ActivityMetric } from "./_components/ActivityMetric";

export default function ActivityLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 md:px-8 md:py-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-52 rounded motion-skeleton" />
          <div className="h-4 w-32 rounded motion-skeleton" />
        </div>
        <div className="h-8 w-56 rounded-md motion-skeleton" />
      </div>
      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
        {["Chat tokens", "Responses", "Active people"].map((label) => (
          <ActivityMetric key={label} label={label} value={undefined} pending />
        ))}
      </dl>
      <div className="space-y-px overflow-hidden rounded-lg border border-border/70">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex h-20 items-center gap-3 px-4">
            <div className="size-8 rounded-full motion-skeleton" />
            <div className="h-4 w-36 rounded motion-skeleton" />
            <div className="ml-auto h-4 w-20 rounded motion-skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}

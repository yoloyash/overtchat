export default function ProjectLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="size-8 rounded-md motion-skeleton" />
        <div className="h-4 w-44 rounded motion-skeleton" />
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 md:px-8">
        <section className="space-y-3">
          <div className="h-5 w-32 rounded motion-skeleton" />
          <div className="h-32 rounded-lg motion-skeleton" />
        </section>
        <section className="space-y-3">
          <div className="h-5 w-24 rounded motion-skeleton" />
          <div className="h-12 rounded-lg motion-skeleton" />
          <div className="h-12 rounded-lg motion-skeleton" />
        </section>
      </div>
    </div>
  );
}

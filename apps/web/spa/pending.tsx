import { ActivityMetric } from "@/components/activity/ActivityMetric";
import { SettingsPage } from "@/components/settings/SettingsRows";

/** Shown while a page in the app shell loads. */
export function AppPending() {
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

/** Shown while a chat or agent session loads. */
export function ChatPending() {
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

/** Shown while a project loads. */
export function ProjectPending() {
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

/** Shown inside the settings layout while a settings page loads. */
export function SettingsPending() {
  return (
    <SettingsPage>
      <span className="sr-only" role="status">
        Loading settings…
      </span>
      <div aria-hidden="true" className="space-y-8">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded motion-skeleton" />
          <div className="h-4 w-72 max-w-full rounded motion-skeleton" />
        </div>
        <div className="space-y-4">
          <div className="h-5 w-32 rounded motion-skeleton" />
          <div className="divide-y border-y">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="grid gap-3 py-4 @2xl/settings:grid-cols-2 @2xl/settings:gap-8"
              >
                <div className="h-5 w-32 rounded motion-skeleton" />
                <div className="h-10 rounded-lg motion-skeleton" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SettingsPage>
  );
}

/** Shown inside the activity layout while activity loads. */
export function ActivityPending() {
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

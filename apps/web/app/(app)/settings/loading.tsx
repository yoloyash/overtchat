import { SettingsPage } from "./_components/SettingsRows";

export default function SettingsLoading() {
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

export default function SettingsLoading() {
  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded motion-skeleton" />
        <div className="h-4 w-72 max-w-full rounded motion-skeleton" />
      </div>
      <div className="space-y-4 rounded-lg border p-4">
        <div className="h-5 w-32 rounded motion-skeleton" />
        <div className="h-10 rounded-lg motion-skeleton" />
        <div className="h-10 rounded-lg motion-skeleton" />
        <div className="h-10 rounded-lg motion-skeleton" />
      </div>
    </div>
  );
}

/** The centered wordmark and card around sign-in and first-run screens. */
export function AuthFrame({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div data-titlebar aria-hidden className="fixed inset-x-0 top-0 h-12" />
      <div className="mb-8 flex items-center gap-2">
        <span className="font-brand text-lg font-semibold tracking-tight">
          overtchat
        </span>
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        {children}
      </div>
      {footer}
    </div>
  );
}

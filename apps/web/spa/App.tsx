import { useState } from "react";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import { QueryProvider } from "@/components/QueryProvider";
import { ToastProvider } from "@/components/ui/toast";
import { createAppRouter } from "@/spa/router";

/**
 * The OvertChat UI. Hosts render it inside `ThemeProvider`, so the theme can
 * be applied before the bundle loads.
 */
export function App({ history }: { history?: RouterHistory }) {
  const [router] = useState(() => createAppRouter(history));
  return (
    <QueryProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryProvider>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DesktopUpdateAction } from "@/components/DesktopUpdateAction";
import type { ServerProblem } from "../shared/ipc";
import { failureText } from "./failure-reason";
import { hostOf, shell } from "./shell";

function describe(host: string, problem: ServerProblem, t: TFunction): { title: string; message: string } {
  const version = problem.kind === "unreachable" ? undefined : problem.version;
  switch (problem.kind) {
    case "unreachable":
      return { title: t("app.desktopShell.problem.unreachableTitle", { host }), message: failureText(problem, t) };
    case "server-outdated":
      return {
        title: t("app.desktopShell.problem.serverOutdatedTitle", { host }),
        message: version
          ? t("app.desktopShell.problem.serverOutdatedVersion", { version })
          : t("app.desktopShell.problem.serverOutdatedUnknown"),
      };
    case "app-outdated":
      return {
        title: t("app.desktopShell.problem.appOutdatedTitle"),
        message: version
          ? t("app.desktopShell.problem.appOutdatedVersion", { host, version })
          : t("app.desktopShell.problem.appOutdatedUnknown", { host }),
      };
  }
}

/** Shown instead of the UI when the saved server can't run it. */
export function ServerProblemScreen({
  origin,
  problem: initialProblem,
}: {
  origin: string;
  problem: ServerProblem;
}) {
  const { t } = useTranslation();
  const host = hostOf(origin);
  const [problem, setProblem] = useState(initialProblem);
  const [checking, setChecking] = useState(false);

  const retry = useCallback(async () => {
    setChecking(true);
    try {
      const { server } = await shell.boot();
      if (!server?.problem) {
        window.location.reload();
        return;
      }
      setProblem(server.problem);
    } catch {
      setProblem({ kind: "unreachable", message: t("app.desktopShell.problem.checkFailed") });
    } finally {
      setChecking(false);
    }
  }, [t]);

  // A server that was offline is often back when the network is.
  useEffect(() => {
    if (problem.kind !== "unreachable") return;
    const onOnline = () => void retry();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [problem.kind, retry]);

  const { title, message } = describe(host, problem, t);

  return (
    <section className="space-y-5" aria-live="polite">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </header>
      <div className="flex flex-col gap-2">
        {problem.kind === "app-outdated" && (
          <DesktopUpdateAction alwaysVisible />
        )}
        <Button disabled={checking} onClick={() => void retry()} className="w-full">
          {checking ? t("app.desktopShell.problem.checking") : t("app.desktopShell.problem.tryAgain")}
        </Button>
        <Button variant="outline" onClick={() => void shell.changeServer()} className="w-full">
          {t("app.desktopShell.problem.changeServer")}
        </Button>
      </div>
    </section>
  );
}

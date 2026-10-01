import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ServerProblem } from "../shared/ipc";
import { hostOf, shell } from "./shell";

function describe(host: string, problem: ServerProblem): { title: string; message: string } {
  switch (problem.kind) {
    case "unreachable":
      return { title: `Can't reach ${host}`, message: problem.message };
    case "server-outdated":
      return {
        title: `${host} needs an update`,
        message: `It runs ${problem.version ? `OvertChat ${problem.version}` : "an older OvertChat"}, which this app can't use. Update the server, then try again.`,
      };
    case "app-outdated":
      return {
        title: "This app needs an update",
        message: `${host} runs ${problem.version ? `OvertChat ${problem.version}` : "a newer OvertChat"}, which is newer than this app supports. Update the desktop app.`,
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
  const host = hostOf(origin);
  const [problem, setProblem] = useState(initialProblem);
  const [checking, setChecking] = useState(false);

  const retry = useCallback(async () => {
    setChecking(true);
    const { server } = await shell.boot();
    if (!server?.problem) {
      window.location.reload();
      return;
    }
    setProblem(server.problem);
    setChecking(false);
  }, []);

  // A server that was offline is often back when the network is.
  useEffect(() => {
    if (problem.kind !== "unreachable") return;
    const onOnline = () => void retry();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [problem.kind, retry]);

  const { title, message } = describe(host, problem);

  return (
    <section className="space-y-5" aria-live="polite">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </header>
      <div className="flex flex-col gap-2">
        <Button disabled={checking} onClick={() => void retry()} className="w-full">
          {checking ? "Checking…" : "Try again"}
        </Button>
        <Button variant="outline" onClick={() => void shell.changeServer()} className="w-full">
          Change server
        </Button>
      </div>
    </section>
  );
}

const UPDATE_INTERVAL_MS = 10 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 60 * 1000;

interface UpdateEventSource {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

/** Installed apps check at startup, periodically, and when the user returns. */
export function startUpdateScheduler(
  check: () => void,
  appEvents: UpdateEventSource,
  powerEvents: UpdateEventSource,
): () => void {
  let lastCheckAt = 0;

  function checkNow(): void {
    lastCheckAt = Date.now();
    check();
  }

  function checkOnActivity(): void {
    if (Date.now() - lastCheckAt >= ACTIVITY_THROTTLE_MS) checkNow();
  }

  checkNow();
  const timer = setInterval(checkNow, UPDATE_INTERVAL_MS);
  timer.unref();
  appEvents.on("browser-window-focus", checkOnActivity);
  powerEvents.on("resume", checkOnActivity);
  appEvents.on("before-quit", stop);

  function stop(): void {
    clearInterval(timer);
    appEvents.removeListener("browser-window-focus", checkOnActivity);
    powerEvents.removeListener("resume", checkOnActivity);
    appEvents.removeListener("before-quit", stop);
  }

  return stop;
}

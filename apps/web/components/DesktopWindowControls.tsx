"use client";

import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import type { DesktopWindowState } from "@overtchat/shared/desktop";
import { desktopBridge } from "@/lib/desktop";

/** Window buttons share the app's header on Windows, including before sign-in. */
export function DesktopWindowControls() {
  const controls = desktopBridge()?.windowControls;
  const [state, setState] = useState<DesktopWindowState>({ maximized: false, fullscreen: false });
  useEffect(() => {
    if (!controls) return;
    let active = true;
    let changed = false;
    const unsubscribe = controls.onState((next) => {
      changed = true;
      setState(next);
    });
    void controls.getState().then((next) => {
      if (active && !changed) setState(next);
    });
    return () => { active = false; unsubscribe(); };
  }, [controls]);
  if (!controls || state.fullscreen) return null;

  const buttonClass = "flex h-12 w-[46px] items-center justify-center hover:bg-muted focus-visible:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2";
  return (
    <div className="desktop-window-controls fixed right-0 top-0 z-[100] flex bg-background text-foreground" role="group" aria-label="Window controls">
      <button type="button" className={buttonClass} aria-label="Minimize window" title="Minimize" onClick={() => void controls.minimize()}>
        <Minus className="size-3.5" aria-hidden />
      </button>
      <button type="button" className={buttonClass} aria-label={state.maximized ? "Restore window" : "Maximize window"} title={state.maximized ? "Restore" : "Maximize"} onClick={() => void controls.toggleMaximize()}>
        {state.maximized ? <Copy className="size-3" aria-hidden /> : <Square className="size-3" aria-hidden />}
      </button>
      <button type="button" className={`${buttonClass} hover:bg-red-600 hover:text-white focus-visible:bg-red-600 focus-visible:text-white`} aria-label="Close window" title="Close" onClick={() => void controls.close()}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

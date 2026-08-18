import { spawn } from "node:child_process";

import { configureProcessSpawner } from "./process";

export function configureLocalTestProcessSpawner(): void {
  configureProcessSpawner((_target, launch) => {
    const child = spawn(launch.command, launch.args ?? [], {
      cwd: launch.cwd,
      env: { ...process.env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exit: new Promise((resolve) => {
        let settled = false;
        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          resolve({ code: null, signal: null, error });
        });
        child.once("exit", (code, signal) => {
          if (settled) return;
          settled = true;
          resolve({ code, signal });
        });
      }),
      kill: (signal = "SIGTERM") => child.kill(signal),
    };
  });
}

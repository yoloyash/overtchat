import { Console } from "node:console";
import {
  closeSync,
  fstatSync,
  ftruncateSync,
  openSync,
  mkdirSync,
  readSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { windowsServiceDirectory } from "./windows-service.js";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const LOG_BACKUPS = 3;

export function rotatingLog(
  fd: number,
  file: string,
  maxBytes = MAX_LOG_BYTES,
): Writable {
  function rotate() {
    const size = fstatSync(fd).size;
    if (!size) return;
    for (let index = LOG_BACKUPS - 1; index >= 1; index--) {
      try {
        renameSync(`${file}.${index}`, `${file}.${index + 1}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    // Keep launchd's open descriptor: renaming the active file would leave
    // stdout/stderr writing to an archive. Bound legacy oversized logs too.
    const bytes = Buffer.alloc(Math.min(size, maxBytes));
    const source = openSync(file, "r");
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(
          source, bytes, offset, bytes.length - offset,
          size - bytes.length + offset,
        );
        if (!count) break;
        offset += count;
      }
      writeFileSync(`${file}.1`, bytes.subarray(0, offset), { mode: 0o600 });
    } finally {
      closeSync(source);
    }
    if (process.platform === "win32") {
      // Windows append-only handles cannot truncate. Keep the active append
      // descriptor, but obtain write access on a second handle for rotation.
      const writable = openSync(file, "r+");
      try { ftruncateSync(writable, 0); } finally { closeSync(writable); }
    } else ftruncateSync(fd, 0);
  }

  if (fstatSync(fd).size > maxBytes) rotate();
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        let offset = 0;
        while (offset < chunk.length) {
          let size = fstatSync(fd).size;
          if (size >= maxBytes) {
            rotate();
            size = 0;
          }
          offset += writeSync(
            fd, chunk, offset, Math.min(chunk.length - offset, maxBytes - size),
          );
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

export function configureServiceLogging(windowsService = false): void {
  if (process.platform === "win32" && windowsService) {
    const directory = windowsServiceDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const log = (name: string) => {
      const file = path.join(directory, name);
      return rotatingLog(openSync(file, "a", 0o600), file);
    };
    globalThis.console = new Console({ stdout: log("connector.log"), stderr: log("connector.error.log") });
    return;
  }
  if (
    process.platform !== "darwin" ||
    process.env.XPC_SERVICE_NAME !== "com.overtchat.connector"
  ) return;
  const directory = path.join(os.homedir(), "Library", "Logs", "OvertChat");
  globalThis.console = new Console({
    stdout: rotatingLog(1, path.join(directory, "connector.log")),
    stderr: rotatingLog(2, path.join(directory, "connector.error.log")),
  });
}

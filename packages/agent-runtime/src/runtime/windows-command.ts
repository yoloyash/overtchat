/** Runs on the execution host, embedded in discovery and the connector helper. */
export const WINDOWS_COMMAND_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
function environmentValue(env, name) {
  const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}
function resolveCommand(command, env = process.env) {
  if (command === "node" || command === "node.exe") return process.execPath;
  const extensions = (environmentValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD")
    .split(";").map(ext => ext.trim()).filter(Boolean)
    .map(ext => ext.startsWith('.') ? ext : '.' + ext);
  // npm installs an extensionless POSIX shim alongside its .cmd wrapper.
  // Resolve extensionless names through PATHEXT, never as native executables.
  const names = path.extname(command) ? [command] : extensions.map(ext => command + ext);
  const explicit = /[\\/]/.test(command);
  const directories = explicit ? [""] : (environmentValue(env, "PATH") || "").split(";").filter(Boolean);
  for (const directory of directories) {
    for (const name of names) {
      const candidate = explicit ? name : path.join(directory.replace(/^"|"$/g, ""), name);
      try { if (fs.statSync(candidate).isFile()) return path.resolve(candidate); } catch {}
    }
  }
  throw new Error("Executable not found in the Windows SSH environment: " + command);
}
function cmdArgument(value) {
  // Quote for the executable's argv parser, then escape both cmd.exe passes:
  // the initial /c command and the batch wrapper's %* expansion.
  if (/[\r\n\0]/.test(value)) throw new Error("Windows batch arguments cannot contain newlines or NUL.");
  let quoted = '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
  const meta = /([()[\]%!^"\x60<>&|;, *?])/g;
  quoted = quoted.replace(meta, '^$1');
  return quoted.replace(meta, '^$1');
}
function commandLaunch(command, args, env = process.env) {
  const executable = resolveCommand(command, env);
  if (!/\.(cmd|bat)$/i.test(executable)) return { command: executable, args, windowsVerbatimArguments: false };
  const escapedCommand = executable.replace(/([()[\]%!^"\x60<>&|;, *?])/g, '^$1');
  const line = escapedCommand + ' ' + args.map(cmdArgument).join(' ');
  if (line.length > 7500) throw new Error("Windows batch command is too long; configure the provider's native executable instead.");
  return {
    command: environmentValue(env, "COMSPEC") || "cmd.exe",
    args: ["/d", "/s", "/c", '"' + line + '"'],
    windowsVerbatimArguments: true,
  };
}
`.trim();

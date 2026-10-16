import type { AgentProcessHostLaunch } from "@overtchat/agent-runtime";
import { Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { WINDOWS_COMMAND_SCRIPT } from "@overtchat/agent-runtime/runtime/windows-command";
import { powershellCommand, powershellLiteral } from "./host-environment.js";
import { WINDOWS_INPUT_SCRIPT } from "./windows-input.js";

// Read exactly one bootstrap line, leaving subsequent agent input untouched.
// The code and launch data travel over stdin, below neither cmd's command-line
// limit nor PowerShell's text-pipeline encoding/conversion rules.
export const WINDOWS_HELPER_BOOTSTRAP = `const fs=require('node:fs');let bytes=[];const b=Buffer.alloc(1);while(fs.readSync(0,b,0,1,null)){if(b[0]===10)break;if(bytes.length>=2097152)throw Error('Bootstrap too large');bytes.push(b[0]);}const payload=JSON.parse(Buffer.from(bytes).toString('utf8'));if(payload.version!==1)throw Error('Unsupported helper version');new Function('require','process','payload',payload.source)(require,process,payload);`;

// Assign the bootstrap itself before it starts Node. Descendants inherit the job;
// closing PowerShell's last job handle kills even detached/orphaned descendants.
// The handle is deliberately not inheritable. Nested jobs require Windows 8+.
const JOB = `using System; using System.Runtime.InteropServices; using System.ComponentModel;
public static class OvertChatJob {
 static IntPtr job;
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr p, uint s);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 public static void Own() {
  job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception();
  int size=IntPtr.Size==8?144:112; IntPtr p=Marshal.AllocHGlobal(size);
  try { for(int i=0;i<size;i++) Marshal.WriteByte(p,i,0); Marshal.WriteInt32(p,16,8192);
   if(!SetInformationJobObject(job,9,p,(uint)size)||!AssignProcessToJobObject(job,GetCurrentProcess())) throw new Win32Exception();
  } finally { Marshal.FreeHGlobal(p); }
 }
}`;

export function windowsHelperCommand(node: string, identity?: string): string {
  return powershellCommand(
    `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -TypeDefinition ${powershellLiteral(JOB)}; [OvertChatJob]::Own(); & ${powershellLiteral(node)} -e ${powershellLiteral(WINDOWS_HELPER_BOOTSTRAP)} ${powershellLiteral(identity ?? "overtchat-helper")}; exit $LASTEXITCODE`,
  );
}

const HELPER = `${WINDOWS_COMMAND_SCRIPT}
const launch = payload.launch;
if (payload.gate) {
  fs.writeSync(2, 'OVERTCHAT_MANAGED_PID_' + payload.gate + ':' + process.pid + '\\n');
  const bytes = []; const byte = Buffer.alloc(1);
  while (fs.readSync(0, byte, 0, 1, null)) {
    if (byte[0] === 10) break;
    if (bytes.length > 128) process.exit(1);
    bytes.push(byte[0]);
  }
  if (Buffer.from(bytes).toString('utf8') !== payload.gate) process.exit(1);
}
const env = { ...process.env };
const inheritedPath = environmentValue(env, 'PATH') || '';
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = path.dirname(process.execPath) + ';' + inheritedPath;
for (const [key, value] of Object.entries(launch.env || {})) {
  for (const existing of Object.keys(env)) if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
  env[key] = value;
}
// Relative executables and PATH entries are relative to the requested cwd,
// just as they are for a direct spawn.
if (launch.cwd) process.chdir(launch.cwd);
const resolved = commandLaunch(launch.command, launch.args || [], env);
let prefix;
// Node -e scripts are our filesystem/session helpers. Windows CreateProcess
// also limits the native argv to 32K, so transfer their source and argv through
// stdin as well, then leave the rest of stdin for the requested operation.
if (resolved.command.toLowerCase() === process.execPath.toLowerCase() && resolved.args[0] === '-e') {
  prefix = JSON.stringify({source:resolved.args[1],args:resolved.args.slice(2)}) + '\\n';
  resolved.args = ['-e', ${JSON.stringify(`const fs=require('node:fs');let bytes=[];const b=Buffer.alloc(1);while(fs.readSync(0,b,0,1,null)){if(b[0]===10)break;if(bytes.length>=2097152)throw Error('Script too large');bytes.push(b[0]);}const p=JSON.parse(Buffer.from(bytes).toString('utf8'));process.argv=[process.execPath,...p.args];new Function('require','process','__dirname','__filename',p.source)(require,process,process.cwd(),'[eval]');`)}];
}
const child = cp.spawn(resolved.command, resolved.args, {
  cwd: launch.cwd, env, windowsHide: true,
  windowsVerbatimArguments: resolved.windowsVerbatimArguments,
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.on('error', error => { process.stderr.write(error.message + '\\n'); process.exitCode = 1; process.stdin.destroy(); });
child.stdin.on('error', () => {});
if (prefix) child.stdin.write(prefix);
${WINDOWS_INPUT_SCRIPT}
`;

export function windowsInputChannel(
  child: ChildProcessWithoutNullStreams,
  gate?: string,
): Writable {
  let gating = Boolean(gate);
  let ticket = Buffer.alloc(0);
  let heartbeat: NodeJS.Timeout | undefined;
  const startHeartbeat = () => {
    heartbeat = setInterval(() => {
      child.stdin.write('{"type":"ping"}\n');
    }, 5000);
    heartbeat.unref();
  };
  if (!gating) startHeartbeat();
  child.stdin.on("error", () => {});
  child.once("close", () => {
    if (heartbeat) clearInterval(heartbeat);
  });
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (gating) {
        ticket = Buffer.concat([ticket, chunk]);
        const end = ticket.indexOf(10);
        if (end < 0) {
          callback(
            ticket.length > 128
              ? new Error("Invalid startup ticket")
              : undefined,
          );
          return;
        }
        if (ticket.subarray(0, end).toString() !== gate) {
          callback(new Error("Invalid startup ticket"));
          return;
        }
        child.stdin.write(ticket.subarray(0, end + 1));
        chunk = ticket.subarray(end + 1);
        gating = false;
        startHeartbeat();
      }
      const frames: string[] = [];
      for (let i = 0; i < chunk.length; i += 32768)
        frames.push(
          JSON.stringify({
            type: "data",
            data: chunk.subarray(i, i + 32768).toString("base64"),
          }) + "\n",
        );
      if (frames.length) child.stdin.write(frames.join(""), callback);
      else callback();
    },
    final(callback) {
      if (gating) child.stdin.end(callback);
      else child.stdin.write('{"type":"end"}\n', callback);
    },
  });
}

export function windowsHelperInput(
  launch: AgentProcessHostLaunch,
  gate?: string,
): string {
  return JSON.stringify({ version: 1, source: HELPER, launch, gate }) + "\n";
}

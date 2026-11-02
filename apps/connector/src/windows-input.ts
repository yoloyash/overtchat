// Executed inside the remote Node helper with `process` and `child` in scope.
// Keep framing/liveness separate from launch/quoting so this exact source can
// also be tested with controlled streams and time, without SSH or PowerShell.
export const WINDOWS_INPUT_SCRIPT = String.raw`
const MAX_FRAME_BYTES = 100000;
const MAX_PENDING_INPUT_BYTES = 64 * 1024 * 1024;
let lastFrame = Date.now();
let inputEnded = false;
let finished = false;
let pending = '';
const fail = message => {
  if (finished) return;
  finished = true;
  process.stderr.write(message + '\n');
  process.exit(1);
};
const watchdog = setInterval(() => {
  if (Date.now() - lastFrame > 30000) fail('Windows SSH heartbeat expired.');
}, 1000);
watchdog.unref();

function receive(line) {
  const frame = JSON.parse(line);
  if (!frame || typeof frame !== 'object') throw Error('Invalid input frame');
  if (frame.type === 'ping') { lastFrame = Date.now(); return; }
  if (frame.type === 'end') {
    if (!inputEnded) child.stdin.end();
    inputEnded = true;
  } else {
    if (frame.type !== 'data' || inputEnded || typeof frame.data !== 'string') throw Error('Invalid input frame');
    const data = Buffer.from(frame.data, 'base64');
    if (child.stdin.writableLength + data.length > MAX_PENDING_INPUT_BYTES)
      throw Error('Windows agent is not reading stdin: pending input exceeds 64 MiB.');
    // Writable preserves byte order and queues EOF behind pending writes. Do
    // not await its drain here: heartbeats and transport EOF must stay readable
    // even while the agent is busy. Bound that queue explicitly instead.
    child.stdin.write(data);
  }
  lastFrame = Date.now();
}
process.stdin.on('data', chunk => {
  if (finished) return;
  try {
    // All transport frames are ASCII JSON with base64 data.
    pending += chunk.toString('utf8');
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      if (end > MAX_FRAME_BYTES) throw Error('Input frame too large');
      receive(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
    if (pending.length > MAX_FRAME_BYTES) throw Error('Input frame too large');
  } catch (error) { fail(error.message); }
});
process.stdin.on('end', () => fail('Windows SSH transport closed.'));
process.stdin.on('error', error => fail(error.message));
child.on('close', code => {
  finished = true;
  clearInterval(watchdog);
  process.stdin.destroy();
  process.exitCode = code === null ? 1 : code;
});
`;

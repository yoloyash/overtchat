const input = process.stdin;

if (process.argv[2] !== "setup") {
  console.error("Expected the installer to invoke setup.");
  process.exit(2);
}
if (!input.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) {
  console.error("Installer did not attach all standard streams to a terminal.");
  process.exit(3);
}
if (typeof input.setRawMode !== "function") {
  console.error("Terminal input does not support raw mode.");
  process.exit(4);
}

input.setRawMode(true);
input.resume();
process.stdout.write("OVERTCHAT_TERMINAL_READY\n");

const timeout = setTimeout(() => {
  input.setRawMode?.(false);
  console.error("Timed out waiting for terminal input.");
  process.exit(5);
}, 10_000);

input.once("data", (chunk: Buffer) => {
  clearTimeout(timeout);
  input.setRawMode?.(false);
  input.pause();
  if (chunk.toString("utf8") !== "x") {
    console.error(`Unexpected terminal input: ${chunk.toString("hex")}`);
    process.exit(6);
  }
  process.stdout.write("OVERTCHAT_TERMINAL_OK\n");
});

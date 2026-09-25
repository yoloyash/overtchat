#!/usr/bin/env python3
"""Run the unmodified piped installer and release CLI's real setup prompts."""

from __future__ import annotations

import errno
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import pathlib
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time


FIRST_PROMPT = b"Where do you want to access OvertChat?"
CUSTOMIZE_PROMPT = b"Customize the port or additional addresses?"
PORT_PROMPT = b"OvertChat port"
LAN_PROMPT = b"This server's LAN address"
ADDITIONAL_PROMPT = b"Additional addresses (comma-separated, optional)"
SERVICES_PROMPT = b"Web search"
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


def executable(path: pathlib.Path, contents: str) -> None:
    path.write_text(contents, encoding="utf-8")
    path.chmod(0o755)


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: cli-installer-pty-smoke.py INSTALLER CLI PLATFORM")
    installer = pathlib.Path(sys.argv[1]).resolve()
    binary = pathlib.Path(sys.argv[2]).resolve()
    platform = sys.argv[3]
    manifest = installer.with_name("install-manifest.json").read_bytes()
    version = json.loads(manifest)["cliVersion"]
    binary.chmod(0o755)
    actual_version = subprocess.check_output([str(binary), "version"], timeout=10)
    if actual_version.decode().strip() != version:
        raise SystemExit("CLI artifact must match the candidate manifest version")

    class ManifestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != "/install-manifest.json":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(manifest)))
            self.end_headers()
            self.wfile.write(manifest)

        def log_message(self, *_args: object) -> None:
            pass

    # Use the existing manifest override to avoid the live site's availability,
    # version drift, or self-updates replacing the exact artifact under test.
    with HTTPServer(("127.0.0.1", 0), ManifestHandler) as server, \
            tempfile.TemporaryDirectory(prefix="overtchat-installer-smoke-") as root:
        root_path = pathlib.Path(root)
        home = root_path / "home"
        mock_bin = root_path / "bin"
        home.mkdir()
        mock_bin.mkdir()
        digest = hashlib.sha256(binary.read_bytes()).hexdigest()
        checksums = root_path / "checksums.txt"
        checksums.write_text(f"{digest}  overtchat-{platform}\n", encoding="utf-8")

        # Keep the real installer, checksum verification, installed executable,
        # and setup command. Only release asset transport is replaced.
        executable(mock_bin / "curl", """#!/bin/sh
set -eu
[ "$#" = 6 ] && [ "$1" = --proto ] && [ "$2" = '=https' ] &&
  [ "$3" = --tlsv1.2 ] && [ "$4" = -fsSLo ] || exit 90
case "$6" in
  "$SMOKE_RELEASE_URL/overtchat-checksums.txt") cp "$SMOKE_CHECKSUMS" "$5" ;;
  "$SMOKE_RELEASE_URL/overtchat-$SMOKE_PLATFORM") cp "$SMOKE_BINARY" "$5" ;;
  *) echo "Unexpected download: $6" >&2; exit 91 ;;
esac
""")
        # No real Docker daemon is contacted. Fail closed if setup tries to
        # provision anything, and record that attempt even if the CLI ignores it.
        executable(mock_bin / "docker", """#!/bin/sh
case "$*" in
  info|"compose version") exit 0 ;;
  "inspect overtchat-app") exit 1 ;;
  "volume ls --filter label=com.docker.compose.volume=overtchat-data --format {{.Name}}") exit 0 ;;
  *) printf '%s\\n' "$*" >> "$SMOKE_UNEXPECTED_DOCKER"; exit 99 ;;
esac
""")
        executable(mock_bin / "nvidia-smi", "#!/bin/sh\nexit 1\n")
        environment = {
            "HOME": str(home),
            "OVERTCHAT_HOME": str(home),
            "OVERTCHAT_CONFIG_DIR": str(root_path / "config"),
            "OVERTCHAT_STACK_DIR": str(root_path / "stack"),
            "OVERTCHAT_RELEASE_MANIFEST_URL":
                f"http://127.0.0.1:{server.server_port}/install-manifest.json",
            "INSTALLER": str(installer),
            "PATH": f"{mock_bin}:/usr/bin:/bin:/usr/sbin:/sbin",
            "TERM": "xterm-256color",
            "SMOKE_CHECKSUMS": str(checksums),
            "SMOKE_BINARY": str(binary),
            "SMOKE_PLATFORM": platform,
            "SMOKE_RELEASE_URL":
                f"https://github.com/yoloyash/overtchat/releases/download/cli-v{version}",
            "SMOKE_UNEXPECTED_DOCKER": str(root_path / "unexpected-docker"),
        }

        # Fork before starting the HTTP thread (forking a multithreaded Python
        # process is unsafe on macOS). A real window size is needed by Clack.
        child_pid, terminal_fd = pty.fork()
        if child_pid == 0:
            try:
                os.chdir(home)
                fcntl.ioctl(1, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
                os.execve("/bin/sh", ["sh", "-c", 'cat "$INSTALLER" | /bin/sh'], environment)
            finally:
                os._exit(127)

        worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05})
        worker.start()
        output = bytearray()
        stage = 0
        initial_selection = None
        status = None
        eof = False
        deadline = time.monotonic() + 30
        try:
            while time.monotonic() < deadline:
                if not eof and select.select([terminal_fd], [], [], 0.1)[0]:
                    try:
                        chunk = os.read(terminal_fd, 65536)
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise
                        chunk = b""
                    if not chunk:
                        eof = True
                    output.extend(chunk)
                    selections = re.findall(
                        r"● ([^\r\n]+)", ANSI.sub("", output.decode(errors="replace"))
                    )
                    selected = selections[-1] if selections else None
                    if stage == 0 and FIRST_PROMPT in output and b"Advanced setup" in output and selected:
                        # Either LAN or local is initially selected. Verify
                        # both arrow-key redraws before submitting that choice.
                        initial_selection = selected
                        os.write(terminal_fd, b"\x1b[B")
                        stage = 1
                    elif stage == 1 and selected and selected != initial_selection:
                        os.write(terminal_fd, b"\x1b[A")
                        stage = 2
                    elif stage == 2 and selected == initial_selection:
                        # Always exercise LAN customization, including hosts
                        # where setup initially selects local-only access.
                        if selected.startswith("Only on this computer"):
                            os.write(terminal_fd, b"\x1b[B")
                            stage = 3
                        else:
                            os.write(terminal_fd, b"\r")
                            stage = 4
                    elif stage == 3 and selected and selected.startswith("On my home network"):
                        os.write(terminal_fd, b"\r")
                        stage = 4
                    elif stage == 4 and CUSTOMIZE_PROMPT in output:
                        os.write(terminal_fd, b"\x1b[D\r")
                        stage = 5
                    elif stage == 5 and PORT_PROMPT in output:
                        os.write(terminal_fd, b"\x158888\r")
                        stage = 6
                    elif stage == 6 and LAN_PROMPT in output:
                        os.write(terminal_fd, b"\x1510.0.0.164\r")
                        stage = 7
                    elif stage == 7 and ADDITIONAL_PROMPT in output:
                        # Submit an untouched optional field. Clack returns
                        # undefined without an explicit empty default value.
                        os.write(terminal_fd, b"\r")
                        stage = 8
                    elif stage == 8 and SERVICES_PROMPT in output:
                        os.write(terminal_fd, b"\x1b")
                        stage = 9
                if status is None:
                    completed, candidate = os.waitpid(child_pid, os.WNOHANG)
                    if completed:
                        status = candidate
                if status is not None and eof:
                    break
                if eof:
                    time.sleep(0.01)

            if status is None:
                raise RuntimeError("installer/setup timed out")
            if os.waitstatus_to_exitcode(status) != 130:
                raise RuntimeError(f"expected cancelled setup (130), got status {status}")
            if stage != 9 or b"Setup cancelled." not in output:
                raise RuntimeError("real setup did not advance and cancel in response to keyboard input")
            if b"http://10.0.0.164:8888" not in output:
                raise RuntimeError("setup did not apply the custom LAN address and port")
            if b"undefined" in output:
                raise RuntimeError("setup displayed an undefined prompt value")
            if b"kqueue" in output:
                raise RuntimeError("terminal runtime error")
            installed = home / ".local/bin/overtchat"
            if hashlib.sha256(installed.read_bytes()).hexdigest() != digest:
                raise RuntimeError("setup did not use the supplied CLI artifact")
            for name in ("config", "stack", "unexpected-docker"):
                if (root_path / name).exists():
                    raise RuntimeError(f"setup attempted provisioning: {name}")
            print(f"PASS: {platform} installer accepts LAN customization and blank addresses, then cancels")
        finally:
            # Also terminate descendants if a timed-out shell leaves its CLI
            # running. pty.fork made this child the leader of its own session.
            if status is None:
                try:
                    os.killpg(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.waitpid(child_pid, 0)
            os.close(terminal_fd)
            server.shutdown()
            worker.join()
            sys.stdout.buffer.write(output)


if __name__ == "__main__":
    main()

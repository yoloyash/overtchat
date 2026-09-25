#!/usr/bin/env python3
"""Exercise the curl-to-shell installer inside a real controlling terminal."""

from __future__ import annotations

import hashlib
import os
import pathlib
import pty
import select
import sys
import tempfile
import time


READY = b"OVERTCHAT_TERMINAL_READY"
SUCCESS = b"OVERTCHAT_TERMINAL_OK"


def fail(message: str, output: bytearray) -> None:
    sys.stdout.buffer.write(output)
    raise SystemExit(message)


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: cli-installer-pty-smoke.py INSTALLER FIXTURE PLATFORM"
        )

    installer = pathlib.Path(sys.argv[1]).resolve()
    fixture = pathlib.Path(sys.argv[2]).resolve()
    platform = sys.argv[3]
    if not installer.is_file() or not fixture.is_file():
        raise SystemExit("installer and fixture executable must exist")

    with tempfile.TemporaryDirectory(prefix="overtchat-installer-smoke-") as root:
        root_path = pathlib.Path(root)
        home = root_path / "home"
        mock_bin = root_path / "bin"
        home.mkdir()
        mock_bin.mkdir()

        checksums = root_path / "checksums.txt"
        digest = hashlib.sha256(fixture.read_bytes()).hexdigest()
        checksums.write_text(
            f"{digest}  overtchat-{platform}\n", encoding="utf-8"
        )

        mock_curl = mock_bin / "curl"
        mock_curl.write_text(
            """#!/bin/sh
set -eu
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -fsSLo)
      output=$2
      shift 2
      ;;
    *)
      url=$1
      shift
      ;;
  esac
done
case "$url" in
  */overtchat-checksums.txt) cp "$SMOKE_CHECKSUMS" "$output" ;;
  *) cp "$SMOKE_FIXTURE" "$output" ;;
esac
""",
            encoding="utf-8",
        )
        mock_curl.chmod(0o755)

        environment = {
            **os.environ,
            "HOME": str(home),
            "INSTALLER": str(installer),
            "PATH": f"{mock_bin}{os.pathsep}{os.environ.get('PATH', '')}",
            "SMOKE_CHECKSUMS": str(checksums),
            "SMOKE_FIXTURE": str(fixture),
        }

        child_pid, terminal_fd = pty.fork()
        if child_pid == 0:
            os.execve(
                "/bin/sh",
                ["sh", "-c", 'cat "$INSTALLER" | /bin/sh'],
                environment,
            )

        output = bytearray()
        input_sent = False
        deadline = time.monotonic() + 20
        status: int | None = None
        try:
            while time.monotonic() < deadline:
                readable, _, _ = select.select([terminal_fd], [], [], 0.25)
                if readable:
                    try:
                        chunk = os.read(terminal_fd, 4096)
                    except OSError:
                        chunk = b""
                    if chunk:
                        output.extend(chunk)
                        if READY in output and not input_sent:
                            os.write(terminal_fd, b"x")
                            input_sent = True
                    else:
                        break

                completed, candidate = os.waitpid(child_pid, os.WNOHANG)
                if completed == child_pid:
                    status = candidate
                    break
        finally:
            os.close(terminal_fd)

        if status is None:
            completed, candidate = os.waitpid(child_pid, os.WNOHANG)
            if completed == child_pid:
                status = candidate
            else:
                os.kill(child_pid, 9)
                os.waitpid(child_pid, 0)
                fail("installer terminal smoke test timed out", output)

        if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
            fail(f"installer exited unsuccessfully with status {status}", output)
        if READY not in output or SUCCESS not in output:
            fail("installer did not complete its terminal input handshake", output)
        if b"invalid argument, kqueue" in output:
            fail("Bun attempted to register the terminal alias with kqueue", output)

        sys.stdout.buffer.write(output)


if __name__ == "__main__":
    main()

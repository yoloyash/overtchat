"""OvertChat code sandbox.

A stateless HTTP service: each request carries Python code and input files,
runs them once as a fresh unprivileged user, and returns the output and any
files written to the outputs folder. Nothing persists between runs.

The service holds no secrets and must not have network access beyond the
OvertChat app. Run code cannot open network sockets at all.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import importlib.metadata
import json
import mimetypes
import os
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = os.environ.get("SANDBOX_VERSION", "dev")
TIER = os.environ.get("SANDBOX_TIER", "slim")
TOKEN = os.environ.get("SANDBOX_TOKEN", "")
PORT = int(os.environ.get("SANDBOX_PORT", "8080"))
RUNS_DIR = Path(os.environ.get("SANDBOX_RUNS_DIR", "/runs"))
RUNNER = os.environ.get("SANDBOX_RUNNER", "/opt/overtchat/bin/runner")
PYTHON = os.environ.get("SANDBOX_PYTHON", "/opt/overtchat/venv/bin/python")
LIB_DIR = os.environ.get("SANDBOX_LIB_DIR", "/opt/overtchat/lib")
SKILLS_DIR = Path(os.environ.get("SANDBOX_SKILLS_DIR", "/opt/overtchat/skills"))

MAX_RUNS = int(os.environ.get("SANDBOX_MAX_RUNS", "4"))
MEMORY_BYTES = int(os.environ.get("SANDBOX_MEMORY_MB", "4096")) * 1024 * 1024
DEFAULT_TIMEOUT = int(os.environ.get("SANDBOX_TIMEOUT_SECONDS", "60"))
MAX_TIMEOUT = int(os.environ.get("SANDBOX_MAX_TIMEOUT_SECONDS", "300"))
MAX_PROCESSES = 64
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_REQUEST_BYTES = 160 * 1024 * 1024
MAX_CODE_CHARS = 200_000
MAX_INPUT_FILES = 50
MAX_INPUT_BYTES = 100 * 1024 * 1024
MAX_OUTPUT_FILES = 20
MAX_OUTPUT_BYTES = 50 * 1024 * 1024
MAX_STREAM_BYTES = 64 * 1024
FIRST_UID = 20_000

SAFE_NAME = re.compile(r"[\x00-\x1f\x7f/\\]")
TOOLS = ("pandoc", "pdftoppm", "pdftotext", "soffice", "tesseract", "ffmpeg")
PACKAGES = (
    "numpy",
    "pandas",
    "matplotlib",
    "pillow",
    "openpyxl",
    "xlsxwriter",
    "python-docx",
    "python-pptx",
    "pypdf",
    "pdfplumber",
    "reportlab",
    "scipy",
    "scikit-learn",
    "seaborn",
    "statsmodels",
    "opencv-python-headless",
    "pytesseract",
)


class RequestError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        super().__init__(message)
        self.status = status


class UserPool:
    """Each concurrent run gets its own user, so runs cannot see each other."""

    def __init__(self, size: int):
        self._free = list(range(FIRST_UID, FIRST_UID + size))
        self._condition = threading.Condition()

    def acquire(self, timeout: float) -> int:
        deadline = time.monotonic() + timeout
        with self._condition:
            while not self._free:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RequestError(
                        HTTPStatus.TOO_MANY_REQUESTS,
                        "The sandbox is busy. Try again shortly.",
                    )
                self._condition.wait(remaining)
            return self._free.pop(0)

    def release(self, uid: int) -> None:
        with self._condition:
            self._free.append(uid)
            self._condition.notify()


POOL = UserPool(MAX_RUNS)


def safe_name(name: object) -> str:
    if not isinstance(name, str):
        raise RequestError(HTTPStatus.BAD_REQUEST, "Each file needs a name.")
    cleaned = SAFE_NAME.sub("_", name).strip()
    try:
        size = len(cleaned.encode("utf-8"))
    except UnicodeEncodeError:
        size = None
    # Shortening a name would move the file away from the path the caller
    # expects, so names the file system cannot store are rejected instead.
    if cleaned in ("", ".", "..") or size is None or size > 255:
        raise RequestError(HTTPStatus.BAD_REQUEST, f"Invalid file name: {name!r}")
    return cleaned


def processes_of(uid: int) -> list[int]:
    """Live processes of a user. Exited ones awaiting the init process are
    already gone, so they are not counted."""
    pids = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/status", encoding="utf-8") as status:
                fields = dict(
                    line.split(":", 1) for line in status if ":" in line
                )
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
        if fields.get("State", "").strip().startswith("Z"):
            continue
        if int(fields.get("Uid", "-1").split()[0]) == uid:
            pids.append(int(entry))
    return pids


def kill_user(uid: int) -> None:
    """Kill everything the run started, including detached children."""
    for _ in range(50):
        pids = processes_of(uid)
        if not pids:
            return
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        time.sleep(0.02)


def remove_owned(uid: int, directory: Path) -> None:
    """Remove files a run left in shared scratch locations."""
    try:
        entries = list(directory.iterdir())
    except OSError:
        return
    for entry in entries:
        try:
            if entry.lstat().st_uid != uid:
                continue
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry, ignore_errors=True)
            else:
                entry.unlink(missing_ok=True)
        except OSError:
            continue


class StreamReader(threading.Thread):
    """Drains a pipe, keeping only the first bytes."""

    def __init__(self, stream):
        super().__init__(daemon=True)
        self.stream = stream
        self.data = bytearray()
        self.truncated = False

    def run(self) -> None:
        while chunk := self.stream.read(65_536):
            room = MAX_STREAM_BYTES - len(self.data)
            if room > 0:
                self.data += chunk[:room]
            if len(chunk) > room:
                self.truncated = True

    def text(self) -> str:
        return self.data.decode("utf-8", errors="replace")


def collect_outputs(outputs: Path, uid: int) -> tuple[list[dict], list[dict]]:
    """Regular files the run created under outputs/, never following links."""
    files: list[dict] = []
    skipped: list[dict] = []
    total = 0
    for directory, subdirectories, names in os.walk(outputs, followlinks=False):
        depth = Path(directory).relative_to(outputs).parts
        if len(depth) >= 4:
            subdirectories.clear()
        subdirectories.sort()
        for name in sorted(names):
            path = Path(directory) / name
            relative = path.relative_to(outputs.parent).as_posix()
            try:
                info = path.lstat()
            except OSError:
                continue
            # Links, devices and files linked in from elsewhere are not outputs.
            if not stat.S_ISREG(info.st_mode) or info.st_uid != uid:
                skipped.append({"path": relative, "reason": "not a regular file"})
                continue
            if len(files) >= MAX_OUTPUT_FILES:
                skipped.append({"path": relative, "reason": "too many files"})
                continue
            if total + info.st_size > MAX_OUTPUT_BYTES:
                skipped.append({"path": relative, "reason": "too large"})
                continue
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as handle:
                data = handle.read(MAX_OUTPUT_BYTES - total + 1)
            if total + len(data) > MAX_OUTPUT_BYTES:
                skipped.append({"path": relative, "reason": "too large"})
                continue
            total += len(data)
            files.append(
                {
                    "path": relative,
                    "name": name,
                    "size": len(data),
                    "media_type": mimetypes.guess_type(name)[0]
                    or "application/octet-stream",
                    "data": base64.b64encode(data).decode("ascii"),
                }
            )
    return files, skipped


def run(payload: dict) -> dict:
    code = payload.get("code")
    if not isinstance(code, str) or not code.strip():
        raise RequestError(HTTPStatus.BAD_REQUEST, "Provide code to run.")
    if len(code) > MAX_CODE_CHARS:
        raise RequestError(HTTPStatus.BAD_REQUEST, "The code is too long.")
    if payload.get("language", "python") != "python":
        raise RequestError(HTTPStatus.BAD_REQUEST, "Only Python is supported.")
    timeout = payload.get("timeout_seconds", DEFAULT_TIMEOUT)
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= MAX_TIMEOUT:
        raise RequestError(
            HTTPStatus.BAD_REQUEST, f"timeout_seconds must be 1 to {MAX_TIMEOUT}."
        )
    inputs = payload.get("files", [])
    if not isinstance(inputs, list) or len(inputs) > MAX_INPUT_FILES:
        raise RequestError(
            HTTPStatus.BAD_REQUEST, f"Provide at most {MAX_INPUT_FILES} files."
        )
    decoded: dict[str, bytes] = {}
    size = 0
    for entry in inputs:
        if not isinstance(entry, dict):
            raise RequestError(HTTPStatus.BAD_REQUEST, "Invalid file entry.")
        name = safe_name(entry.get("name"))
        if name in decoded:
            raise RequestError(HTTPStatus.BAD_REQUEST, f"Duplicate file name: {name}")
        try:
            data = base64.b64decode(entry.get("data", ""), validate=True)
        except (binascii.Error, TypeError, ValueError):
            raise RequestError(HTTPStatus.BAD_REQUEST, f"Invalid data for {name}.")
        size += len(data)
        if size > MAX_INPUT_BYTES:
            raise RequestError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Input files are too large.")
        decoded[name] = data

    uid = POOL.acquire(timeout=30)
    root = RUNS_DIR / secrets.token_hex(12)
    try:
        os.mkdir(root, 0o700)
        os.chown(root, uid, uid)
        uploads = root / "uploads"
        os.mkdir(uploads, 0o755)
        for name, data in decoded.items():
            path = uploads / name
            path.write_bytes(data)
            os.chmod(path, 0o444)
        os.chmod(uploads, 0o555)
        # Some programs (LibreOffice) will not create missing parents of
        # their configuration directory.
        for writable in ("outputs", "tmp", "tmp/config", "tmp/cache"):
            os.mkdir(root / writable, 0o700)
            os.chown(root / writable, uid, uid)
        script = root / ".main.py"
        script.write_text(code, encoding="utf-8")
        os.chmod(script, 0o444)

        environment = {
            "PATH": f"{Path(PYTHON).parent}:/usr/local/bin:/usr/bin:/bin",
            "HOME": str(root),
            "TMPDIR": str(root / "tmp"),
            "LANG": "C.UTF-8",
            "PYTHONPATH": LIB_DIR,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONUNBUFFERED": "1",
            "MPLBACKEND": "module://overtchat_matplotlib",
            "MPLCONFIGDIR": str(root / "tmp" / "matplotlib"),
            "XDG_CACHE_HOME": str(root / "tmp" / "cache"),
            "XDG_CONFIG_HOME": str(root / "tmp" / "config"),
            "OVERTCHAT_OUTPUT_DIR": str(root / "outputs"),
            "OPENBLAS_NUM_THREADS": "2",
            "OMP_NUM_THREADS": "2",
            "MKL_NUM_THREADS": "2",
        }
        started = time.monotonic()
        process = subprocess.Popen(
            [
                RUNNER,
                str(uid),
                str(timeout + 5),
                str(MEMORY_BYTES),
                str(MAX_PROCESSES),
                str(MAX_FILE_BYTES),
                PYTHON,
                "-B",
                str(script),
            ],
            cwd=root,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        stdout = StreamReader(process.stdout)
        stderr = StreamReader(process.stderr)
        stdout.start()
        stderr.start()
        timed_out = False
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        kill_user(uid)
        stdout.join(timeout=5)
        stderr.join(timeout=5)
        process.stdout.close()
        process.stderr.close()
        duration_ms = round((time.monotonic() - started) * 1000)
        files, skipped = collect_outputs(root / "outputs", uid)
        status = process.returncode
        return {
            "exit_code": status if status >= 0 else None,
            "signal": signal.Signals(-status).name if status < 0 else None,
            "timed_out": timed_out,
            "duration_ms": duration_ms,
            "stdout": stdout.text(),
            "stdout_truncated": stdout.truncated,
            "stderr": stderr.text(),
            "stderr_truncated": stderr.truncated,
            "files": files,
            "skipped_files": skipped,
        }
    finally:
        kill_user(uid)
        shutil.rmtree(root, ignore_errors=True)
        for scratch in (Path("/tmp"), Path("/dev/shm"), Path("/var/tmp")):
            remove_owned(uid, scratch)
        POOL.release(uid)


def versions() -> dict:
    """Versions of the packages run code can import, read from the run
    environment's metadata rather than the server's own interpreter."""
    site_packages = [str(path) for path in Path(PYTHON).parents[1].glob("lib/python*/site-packages")]
    installed = {
        distribution.metadata["Name"].lower(): distribution.version
        for distribution in importlib.metadata.distributions(path=site_packages)
    }
    return {name: installed[name] for name in PACKAGES if name in installed}


def skills() -> list[dict]:
    """Name and description of each bundled skill (SKILL.md frontmatter)."""
    found = []
    for path in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        text = path.read_text(encoding="utf-8")
        match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        if not match:
            continue
        fields = dict(
            line.split(":", 1) for line in match.group(1).splitlines() if ":" in line
        )
        name = fields.get("name", "").strip()
        description = fields.get("description", "").strip()
        if name and description:
            found.append({"name": name, "description": description, "path": str(path)})
    return found


def self_test() -> str | None:
    """Confirm the launcher can drop privileges in this container."""
    probe = subprocess.run(
        [RUNNER, str(FIRST_UID + MAX_RUNS), "5", str(256 * 1024 * 1024), "8", "1024", "/usr/bin/id", "-u"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    if probe.returncode != 0 or probe.stdout.strip() != str(FIRST_UID + MAX_RUNS):
        return (probe.stderr or probe.stdout).strip() or "The launcher failed."
    return None


STARTUP_ERROR = None
INFO: dict = {}


class Handler(BaseHTTPRequestHandler):
    server_version = "OvertChatSandbox"
    sys_version = ""

    def log_message(self, format, *args):  # noqa: A002 - signature from stdlib
        # Request lines only; never code, files or output.
        sys.stderr.write(f"{self.address_string()} {format % args}\n")

    def respond(self, status: HTTPStatus, body: dict) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def authorized(self) -> bool:
        if not TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        return hmac.compare_digest(header, f"Bearer {TOKEN}")

    def do_GET(self):  # noqa: N802 - stdlib naming
        if self.path != "/healthz":
            self.respond(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        if STARTUP_ERROR:
            self.respond(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"status": "error", "error": STARTUP_ERROR},
            )
            return
        self.respond(HTTPStatus.OK, {"status": "ok", **INFO})

    def do_POST(self):  # noqa: N802 - stdlib naming
        if self.path != "/run":
            self.respond(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        if not self.authorized():
            self.respond(HTTPStatus.UNAUTHORIZED, {"error": "Unauthorized"})
            return
        if STARTUP_ERROR:
            self.respond(HTTPStatus.SERVICE_UNAVAILABLE, {"error": STARTUP_ERROR})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self.respond(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE
                if length > MAX_REQUEST_BYTES
                else HTTPStatus.BAD_REQUEST,
                {"error": "Invalid request size."},
            )
            return
        try:
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError
        except ValueError:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON body."})
            return
        try:
            self.respond(HTTPStatus.OK, run(payload))
        except RequestError as error:
            self.respond(error.status, {"error": str(error)})
        except Exception as error:  # noqa: BLE001 - report, never drop the request
            sys.stderr.write(f"run failed: {type(error).__name__}\n")
            self.respond(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "The sandbox could not run the code."},
            )


def main() -> None:
    global STARTUP_ERROR, INFO
    if os.geteuid() != 0:
        STARTUP_ERROR = "The sandbox server must start as root to switch users."
    else:
        RUNS_DIR.mkdir(mode=0o711, exist_ok=True)
        os.chmod(RUNS_DIR, 0o711)
        STARTUP_ERROR = self_test()
    INFO = {
        "version": VERSION,
        "tier": TIER,
        "python": sys.version.split()[0],
        "packages": versions(),
        "tools": [tool for tool in TOOLS if shutil.which(tool)],
        "skills": skills(),
        "limits": {
            "timeout_seconds": DEFAULT_TIMEOUT,
            "max_timeout_seconds": MAX_TIMEOUT,
            "memory_mb": MEMORY_BYTES // (1024 * 1024),
            "max_input_bytes": MAX_INPUT_BYTES,
            "max_output_files": MAX_OUTPUT_FILES,
            "max_output_bytes": MAX_OUTPUT_BYTES,
            "concurrent_runs": MAX_RUNS,
        },
    }
    if STARTUP_ERROR:
        sys.stderr.write(f"sandbox self-test failed: {STARTUP_ERROR}\n")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()

"""Sandbox tests. Run inside the image with the production capabilities:

    docker run --rm --init --read-only --tmpfs /runs --tmpfs /tmp \
      --cap-drop ALL --cap-add SETUID --cap-add SETGID --cap-add CHOWN \
      --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add KILL \
      -v "$PWD/sandbox:/tests:ro" overtchat-sandbox-test \
      python -B -m unittest discover -s /tests -p 'test_*.py'
"""

import base64
import io
import json
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, "/opt/overtchat")
import server  # noqa: E402


def encode(text: str | bytes) -> str:
    return base64.b64encode(text.encode() if isinstance(text, str) else text).decode()


def run(code: str, files=None, **options) -> dict:
    return server.run({"code": code, "files": files or [], **options})


def outputs(result: dict) -> dict[str, bytes]:
    return {entry["path"]: base64.b64decode(entry["data"]) for entry in result["files"]}


class SandboxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.RUNS_DIR.mkdir(mode=0o711, exist_ok=True)
        error = server.self_test()
        if error:
            raise RuntimeError(f"self-test failed: {error}")

    def test_runs_code_and_reports_output(self):
        result = run("print('hello'); import sys; print('warn', file=sys.stderr)")
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(result["stdout"], "hello\n")
        self.assertEqual(result["stderr"], "warn\n")
        self.assertFalse(result["timed_out"])
        self.assertEqual(result["files"], [])

    def test_reports_failures(self):
        result = run("raise ValueError('bad input')")
        self.assertEqual(result["exit_code"], 1)
        self.assertIn("ValueError: bad input", result["stderr"])

    def test_reads_uploads_read_only_through_both_paths(self):
        result = run(
            "import pandas as pd\n"
            "print(pd.read_csv('uploads/sales.csv')['amount'].sum())\n"
            "print(open('/mnt/data/uploads/sales.csv').readline().strip())\n"
            "try:\n"
            "    open('uploads/sales.csv', 'a').write('x')\n"
            "except PermissionError:\n"
            "    print('read-only')\n",
            files=[{"name": "sales.csv", "data": encode("region,amount\nnorth,10\nsouth,32\n")}],
        )
        self.assertEqual(result["stdout"].split(), ["42", "region,amount", "read-only"])

    def test_returns_files_written_to_outputs(self):
        result = run(
            "import os\n"
            "os.makedirs('outputs/nested', exist_ok=True)\n"
            "open('outputs/report.csv', 'w').write('a,b\\n1,2\\n')\n"
            "open('/mnt/data/outputs/nested/notes.md', 'w').write('# Notes')\n"
            "open('tmp/scratch.txt', 'w').write('not returned')\n"
        )
        self.assertEqual(
            outputs(result),
            {"outputs/nested/notes.md": b"# Notes", "outputs/report.csv": b"a,b\n1,2\n"},
        )
        media = {entry["name"]: entry["media_type"] for entry in result["files"]}
        self.assertEqual(media["report.csv"], "text/csv")

    def test_shows_charts_as_images(self):
        result = run(
            "import matplotlib.pyplot as plt\n"
            "plt.plot([1, 2, 3], [3, 1, 2]); plt.title('Shown'); plt.show()\n"
            "plt.figure(); plt.bar(['a', 'b'], [1, 2])\n"
        )
        files = outputs(result)
        self.assertEqual(sorted(files), ["outputs/figure-1.png", "outputs/figure-2.png"])
        for data in files.values():
            self.assertTrue(data.startswith(b"\x89PNG"))
        # Charts the code saved itself are returned once, under its name.
        result = run(
            "import matplotlib.pyplot as plt\n"
            "plt.plot([1, 2]); plt.savefig('outputs/line.png')\n"
            "plt.figure(); plt.bar(['a'], [1]); plt.savefig('outputs/bar.png'); plt.show()\n"
        )
        self.assertEqual(sorted(outputs(result)), ["outputs/bar.png", "outputs/line.png"])

    def test_builds_documents_with_the_bundled_libraries(self):
        result = run(
            "import docx, openpyxl, pptx, pypdf, pdfplumber, reportlab, PIL, yaml, bs4, markdown\n"
            "document = docx.Document()\n"
            "document.add_heading('Title', 1)\n"
            "document.add_paragraph('one', style='List Bullet')\n"
            "document.save('outputs/a.docx')\n"
            "print([p.text for p in docx.Document('outputs/a.docx').paragraphs])\n"
        )
        self.assertEqual(result["exit_code"], 0, result["stderr"])
        self.assertEqual(result["stdout"].strip(), "['Title', 'one']")
        with zipfile.ZipFile(io.BytesIO(outputs(result)["outputs/a.docx"])) as archive:
            self.assertIn("word/document.xml", archive.namelist())

    @unittest.skipUnless(server.TIER == "full", "full tier only")
    def test_full_tier_converts_and_recognizes_text(self):
        result = run(
            "import subprocess\n"
            "open('tmp/a.md', 'w').write('# Quarterly report\\n\\n- Revenue grew\\n')\n"
            "subprocess.run(['pandoc', 'tmp/a.md', '-o', 'outputs/report.docx'], check=True)\n"
            "subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', 'outputs',\n"
            "                'outputs/report.docx'], check=True, capture_output=True)\n"
            "subprocess.run(['pdftoppm', '-r', '150', '-png', '-f', '1', '-l', '1', 'outputs/report.pdf',\n"
            "                'tmp/page'], check=True)\n"
            "import glob, pytesseract\n"
            "from PIL import Image\n"
            "print(pytesseract.image_to_string(Image.open(glob.glob('tmp/page*.png')[0])))\n"
            "import scipy, sklearn, seaborn, statsmodels, cv2\n",
            timeout_seconds=180,
        )
        self.assertEqual(result["exit_code"], 0, result["stderr"])
        self.assertIn("Quarterly report", result["stdout"])
        self.assertEqual(sorted(outputs(result)), ["outputs/report.docx", "outputs/report.pdf"])

    def test_cannot_open_network_sockets(self):
        result = run(
            "import socket, urllib.request\n"
            "for family in (socket.AF_INET, socket.AF_INET6):\n"
            "    try:\n"
            "        socket.socket(family, socket.SOCK_STREAM)\n"
            "        print('open')\n"
            "    except PermissionError:\n"
            "        print('denied')\n"
            "try:\n"
            "    urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)\n"
            "except Exception as error:\n"
            "    print(type(error).__name__)\n"
            "a, b = socket.socketpair()\n"
            "a.send(b'local'); print(b.recv(5).decode())\n"
        )
        self.assertEqual(result["stdout"].split(), ["denied", "denied", "URLError", "local"])

    def test_runs_as_an_unprivileged_user(self):
        result = run(
            "import os\n"
            "print(os.getuid() >= 20000, os.geteuid() == os.getuid())\n"
            "for attempt in (lambda: os.setuid(0), lambda: os.unshare(os.CLONE_NEWUSER),\n"
            "                lambda: open('/proc/1/environ').read(), lambda: open('/etc/x', 'w')):\n"
            "    try:\n"
            "        attempt(); print('allowed')\n"
            "    except OSError as error:\n"
            "        print(type(error).__name__)\n"
        )
        lines = result["stdout"].splitlines()
        self.assertEqual(lines[0], "True True")
        self.assertNotIn("allowed", lines[1:], result)

    def test_runs_are_isolated_and_cleaned_up(self):
        first = run(
            "import os, subprocess\n"
            "open('/tmp/left-behind', 'w').write('secret')\n"
            "open('/dev/shm/left-behind', 'w').write('secret')\n"
            "subprocess.Popen(['sleep', '60'], start_new_session=True)\n"
            "print(os.getcwd())\n"
        )
        run_dir = first["stdout"].strip()
        self.assertFalse(Path(run_dir).exists())
        self.assertFalse(Path("/tmp/left-behind").exists())
        self.assertFalse(Path("/dev/shm/left-behind").exists())
        for uid in range(server.FIRST_UID, server.FIRST_UID + server.MAX_RUNS):
            self.assertEqual(server.processes_of(uid), [])

        # A concurrent run cannot read another run's directory or private files.
        started = threading.Event()
        holder: dict = {}

        def hold():
            holder["result"] = run(
                "import os, time\n"
                "open('/tmp/private', 'w').write('mine')\n"
                "print(os.getcwd(), flush=True)\n"
                "open('/tmp/ready', 'w').close()\n"
                "time.sleep(3)\n"
            )

        thread = threading.Thread(target=hold)
        thread.start()
        for _ in range(100):
            if Path("/tmp/ready").exists():
                started.set()
                break
            time.sleep(0.05)
        self.assertTrue(started.is_set())
        snoop = run(
            "import os\n"
            "try:\n"
            "    print(open('/tmp/private').read())\n"
            "except PermissionError:\n"
            "    print('denied file')\n"
            "try:\n"
            "    print(os.listdir('/runs'))\n"
            "except PermissionError:\n"
            "    print('denied listing')\n"
        )
        thread.join()
        self.assertEqual(snoop["stdout"].split("\n")[:2], ["denied file", "denied listing"])

    def test_stops_runs_at_the_timeout(self):
        started = time.monotonic()
        result = run("while True: pass", timeout_seconds=2)
        self.assertTrue(result["timed_out"])
        self.assertEqual(result["signal"], "SIGKILL")
        self.assertLess(time.monotonic() - started, 10)

    def test_limits_memory(self):
        result = run("x = bytearray(8 * 1024 ** 3)")
        self.assertEqual(result["exit_code"], 1)
        self.assertIn("MemoryError", result["stderr"])

    def test_truncates_long_output(self):
        result = run("print('x' * 200_000)")
        self.assertEqual(len(result["stdout"]), server.MAX_STREAM_BYTES)
        self.assertTrue(result["stdout_truncated"])

    def test_limits_and_filters_returned_files(self):
        result = run(
            "import os\n"
            "for i in range(25):\n"
            "    open(f'outputs/file-{i:02}.txt', 'w').write(str(i))\n"
            "os.symlink('/etc/passwd', 'outputs/passwd')\n"
        )
        self.assertEqual(len(result["files"]), server.MAX_OUTPUT_FILES)
        reasons = {entry["path"]: entry["reason"] for entry in result["skipped_files"]}
        self.assertEqual(reasons["outputs/passwd"], "not a regular file")
        self.assertEqual(
            sum(reason == "too many files" for reason in reasons.values()), 5
        )
        self.assertNotIn(b"root:", b"".join(outputs(result).values()))

    def test_validates_requests(self):
        cases = [
            ({"code": ""}, "Provide code"),
            ({"code": "x" * (server.MAX_CODE_CHARS + 1)}, "too long"),
            ({"code": "1", "language": "ruby"}, "Only Python"),
            ({"code": "1", "timeout_seconds": 0}, "timeout_seconds"),
            ({"code": "1", "timeout_seconds": True}, "timeout_seconds"),
            ({"code": "1", "files": [{"name": "a", "data": "!!"}]}, "Invalid data"),
            ({"code": "1", "files": [{"name": "a", "data": ""}, {"name": "a", "data": ""}]}, "Duplicate"),
            ({"code": "1", "files": [{"name": "..", "data": ""}]}, "Invalid file name"),
            ({"code": "1", "files": [{"name": "\u00e9" * 128, "data": ""}]}, "Invalid file name"),
            ({"code": "1", "files": [{"name": "a\ud800", "data": ""}]}, "Invalid file name"),
        ]
        for payload, message in cases:
            with self.subTest(message=message):
                with self.assertRaises(server.RequestError) as raised:
                    server.run(payload)
                self.assertIn(message, str(raised.exception))
        result = run(
            "import os; print(sorted(os.listdir('uploads')))",
            files=[{"name": "../escape.txt", "data": encode("x")}],
        )
        self.assertEqual(result["stdout"].strip(), "['.._escape.txt']")
        long_name = "\u00e9" * 125 + ".csv"
        result = run(
            "import os; print(os.listdir('uploads') == [%r])" % long_name,
            files=[{"name": long_name, "data": encode("x")}],
        )
        self.assertEqual(result["stdout"].strip(), "True")

    def test_lists_packages_tools_and_skills(self):
        packages = server.versions()
        for name in ("numpy", "pandas", "matplotlib", "pillow", "python-docx", "openpyxl"):
            self.assertIn(name, packages)
        names = [skill["name"] for skill in server.skills()]
        self.assertEqual(
            names,
            ["charts", "images", "pdf", "presentations", "spreadsheets", "word-documents"],
        )
        for skill in server.skills():
            self.assertTrue(skill["description"])
            self.assertTrue(Path(skill["path"]).is_file())


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.TOKEN = "test-token"
        server.INFO = {"tier": "slim"}
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.http.server_address[1]
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()

    def request(self, path, body=None, token="test-token"):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_health(self):
        self.assertEqual(self.request("/healthz"), (200, {"status": "ok", "tier": "slim"}))

    def test_requires_the_token(self):
        self.assertEqual(self.request("/run", {"code": "1"}, token="wrong")[0], 401)

    def test_runs_over_http(self):
        status, body = self.request("/run", {"code": "print(6 * 7)"})
        self.assertEqual((status, body["stdout"]), (200, "42\n"))
        self.assertEqual(self.request("/run", {"code": ""})[0], 400)
        self.assertEqual(self.request("/missing", {"code": "1"})[0], 404)


if __name__ == "__main__":
    unittest.main()

"""Exercise a running disposable native service. Pass its private service.json."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import tempfile
import time

import httpx
import imageio_ffmpeg


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    parser.add_argument("--fixture", type=Path, help="Optional spoken WAV; otherwise synthesize the fixture")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    base = f"http://127.0.0.1:{config['port']}"
    results = {}
    with httpx.Client(base_url=base, headers={"Authorization": f"Bearer {config['token']}"}, timeout=120) as client:
        assert client.get("/healthz", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert client.get("/healthz").json()["ready"]
        for fmt in ["pcm", "wav", "mp3", "flac", "opus", "aac"]:
            start = time.monotonic()
            response = client.post("/v1/audio/speech", json={"input": "The quick brown fox jumps over the lazy dog.", "response_format": fmt})
            response.raise_for_status()
            audio = response.content
            assert len(audio) > 1000, (fmt, len(audio))
            if fmt != "pcm":
                decoded = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", "pipe:0", "-f", "null", "-"], input=audio, capture_output=True)
                assert decoded.returncode == 0, (fmt, decoded.stderr)
            if fmt == "wav":
                fixture = audio
            results[f"tts_{fmt}"] = {"seconds": round(time.monotonic() - start, 3), "bytes": len(audio)}
        if args.fixture:
            fixture = args.fixture.read_bytes()

        with tempfile.TemporaryDirectory() as directory:
            wav = Path(directory) / "fixture.wav"
            wav.write_bytes(fixture)
            for extension, codec in [("wav", None), ("webm", "libopus"), ("m4a", "aac")]:
                path = Path(directory) / f"fixture.{extension}"
                if codec:
                    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-i", str(wav), "-c:a", codec, str(path)], check=True)
                start = time.monotonic()
                response = client.post("/v1/audio/transcriptions", files={"file": (path.name, path.read_bytes())})
                response.raise_for_status()
                text = response.json()["text"]
                assert "quick brown fox" in text.lower(), (extension, text)
                results[f"stt_{extension}"] = {"seconds": round(time.monotonic() - start, 3), "text": text}
            response = client.post("/v1/audio/transcriptions", files={"file": ("fixture.wav", fixture)}, data={"response_format": "text"})
            assert response.status_code == 200 and "quick brown fox" in response.text.lower()
            assert client.post("/v1/audio/transcriptions", files={"file": ("invalid.m4a", b"not audio")}).status_code == 400

        # Abort a long response, then submit parallel speech and STT work.
        with client.stream("POST", "/v1/audio/speech", json={"input": "This is a cancellation test. " * 150, "response_format": "pcm"}) as response:
            response.raise_for_status()
            next(response.iter_bytes())
        def request(index):
            if index % 2:
                response = client.post("/v1/audio/transcriptions", files={"file": ("fixture.wav", fixture)})
                assert "quick brown fox" in response.json()["text"].lower()
            else:
                response = client.post("/v1/audio/speech", json={"input": "Speech still works.", "response_format": "pcm"})
                assert len(response.content) > 1000
            assert response.status_code == 200
        start = time.monotonic()
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(request, range(4)))
        results["abort_then_concurrent"] = {"seconds": round(time.monotonic() - start, 3), "requests": 4}
        assert client.get("/healthz").json()["ready"]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

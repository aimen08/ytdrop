"""Optional real yt-dlp benchmark using generated media and a delayed local server.

Run with the helper's Python (yt-dlp installed) and FFmpeg/ffprobe on PATH:
  python tests/benchmark_fragments.py --output-dir path/to/benchmark-results
Results describe this synthetic workload, not promised YouTube transfer rates.
"""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
import host


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    folder = args.output_dir.resolve() / str(time.time_ns())
    folder.mkdir(parents=True)
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    runtime = "deno" if shutil.which("deno") else "node"
    runtime_path = shutil.which(runtime)
    if not all((ffmpeg, ffprobe, runtime_path)):
        raise SystemExit("FFmpeg, ffprobe, and Node.js/Deno must be on PATH.")
    subprocess.run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "8",
        "-c:v", "libx264", "-preset", "ultrafast", "-g", "5", "-sc_threshold", "0",
        "-c:a", "aac", "-f", "hls", "-hls_time", "0.5", "-hls_list_size", "0",
        "-hls_segment_filename", str(folder / "part%03d.ts"), str(folder / "index.m3u8"),
    ], check=True)

    class Handler(SimpleHTTPRequestHandler):
        lock = threading.Lock()
        active = peak = requests = 0
        first = last = None

        def do_GET(self):
            if not self.path.endswith(".ts"):
                return super().do_GET()
            with Handler.lock:
                Handler.active += 1
                Handler.requests += 1
                Handler.peak = max(Handler.peak, Handler.active)
                if Handler.first is None:
                    Handler.first = time.perf_counter()
            try:
                # A controlled latency cost makes concurrency measurable without
                # public servers, a fast WAN connection, or large downloads.
                time.sleep(0.15)
                super().do_GET()
            finally:
                with Handler.lock:
                    Handler.active -= 1
                    Handler.last = time.perf_counter()

        def log_message(self, *args):
            pass

    class Server(ThreadingHTTPServer):
        request_queue_size = 32

    server = Server(("127.0.0.1", 0), functools.partial(Handler, directory=str(folder)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/index.m3u8"
    info = {"id": "fixture0001", "title": "Fragment benchmark", "extractor": "generic",
            "extractor_key": "Generic", "webpage_url": url, "url": url, "ext": "mp4",
            "protocol": "m3u8_native", "is_live": False, "height": 180, "width": 320,
            "vcodec": "h264", "acodec": "aac"}
    info_file = folder / "info.json"
    info_file.write_text(json.dumps(info), encoding="utf-8")
    results = {}
    try:
        for speed in ("standard", "fast"):
            Handler.active = Handler.peak = Handler.requests = 0
            Handler.first = Handler.last = None
            config = {"download_dir": str(folder / speed), "ffmpeg": ffmpeg, "ffprobe": ffprobe,
                      "runtime": runtime, "runtime_path": runtime_path}
            events = []
            bridge = host.Host(config, events.append)
            bridge.job = "benchmark"
            job = {"url": "https://youtu.be/BaW_jenozKc", "mode": "video", "quality": "480", "speed": speed}
            command = host.build_command(job, config)
            # Only this test substitutes local fixture metadata; the production
            # helper continues to reject all non-YouTube input URLs.
            command = command[:-2] + ["--load-info-json", str(info_file)]
            start = time.perf_counter()
            bridge.download("benchmark", command)
            elapsed = time.perf_counter() - start
            assert events[-1].get("status") == "complete", events[-1]
            assert any(e.get("status") == "downloading" for e in events), events
            output = Path(events[-1]["filename"])
            probe = json.loads(subprocess.check_output([
                ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(output)
            ]))
            assert float(probe["format"]["duration"]) >= 8
            results[speed] = {"total_seconds": round(elapsed, 3),
                              "transfer_seconds": round(Handler.last - Handler.first, 3),
                              "peak_parallel_requests": Handler.peak,
                              "fragment_requests": Handler.requests,
                              "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}
            print(speed, json.dumps(results[speed]), flush=True)
        assert results["standard"]["peak_parallel_requests"] == 1
        assert 1 < results["fast"]["peak_parallel_requests"] <= 8
        assert results["standard"]["sha256"] == results["fast"]["sha256"], "Output content differs"
        results["total_speedup"] = round(results["standard"]["total_seconds"] / results["fast"]["total_seconds"], 2)
        results["transfer_speedup"] = round(results["standard"]["transfer_seconds"] / results["fast"]["transfer_seconds"], 2)
        results["note"] = "Synthetic local HLS test, 150 ms delay per fragment. Not a YouTube speed guarantee."
        (folder / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(json.dumps(results, indent=2))
        print("Results:", folder / "results.json")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    main()

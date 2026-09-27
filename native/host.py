"""Chrome native messaging bridge. Stdout is reserved for framed JSON only."""
import importlib.metadata
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import threading
from urllib.parse import parse_qs, urlsplit

MAX_MESSAGE = 65536
WRITE_LOCK = threading.Lock()
CONFIG_FILE = Path(__file__).with_name("config.json")
CREATE_FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            if not data:
                return None
            raise ValueError("Truncated native message")
        data.extend(chunk)
    return bytes(data)


def read_message(stream):
    header = read_exact(stream, 4)
    if header is None:
        return None
    size = struct.unpack("<I", header)[0]
    if not 0 < size <= MAX_MESSAGE:
        raise ValueError("Invalid message length")
    body = read_exact(stream, size)
    if body is None:
        raise ValueError("Missing message body")
    message = json.loads(body)
    if not isinstance(message, dict):
        raise ValueError("Expected an object")
    return message


def send_message(message):
    data = json.dumps(message, ensure_ascii=False).encode("utf-8")
    with WRITE_LOCK:
        sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
        sys.stdout.buffer.flush()


def youtube_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("Invalid video URL")
    url = urlsplit(value.strip())
    if url.scheme != "https" or url.username or url.password or url.port not in (None, 443):
        raise ValueError("Use an HTTPS YouTube video link")
    video_id = None
    if url.hostname == "youtu.be":
        video_id = url.path[1:]
    elif url.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if url.path == "/watch":
            video_id = parse_qs(url.query).get("v", [None])[0]
        else:
            match = re.fullmatch(r"/(?:shorts|live|embed)/([\w-]{11})/?", url.path, re.ASCII)
            video_id = match[1] if match else None
    if not video_id or not re.fullmatch(r"[\w-]{11}", video_id, re.ASCII):
        raise ValueError("Only individual YouTube videos and Shorts are supported")
    return "https://www.youtube.com/watch?v=" + video_id


def build_command(job, config):
    url = youtube_url(job.get("url"))
    mode, quality = job.get("mode"), job.get("quality")
    if mode not in {"video", "audio"} or quality not in {"best", "2160", "1080", "720", "480"}:
        raise ValueError("Invalid download options")
    folder = str(Path(config["download_dir"]).expanduser().resolve())
    command = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-plugin-dirs",
               "--no-playlist", "--no-colors", "--newline", "--progress", "--progress-delta", "0.5",
               "--socket-timeout", "30", "--retries", "3", "--fragment-retries", "3",
               "--windows-filenames", "--trim-filenames", "180", "--no-overwrites", "--no-simulate",
               "--match-filters", "!is_live", "--ffmpeg-location", config["ffmpeg"],
               "--no-js-runtimes", "--js-runtimes", config["runtime"] + ":" + config["runtime_path"],
               "--paths", folder, "--output", "%(title).140B [%(id)s].%(ext)s",
               "--print", 'before_dl:YTDROP_META:%(.{title,id})j',
               "--print", 'after_move:YTDROP_FILE:%(filepath)j',
               "--progress-template", 'download:YTDROP_PROGRESS:%(progress)j',
               "--progress-template", 'postprocess:YTDROP_PROCESS:%(progress.status)j']
    if mode == "audio":
        command += ["--format", "bestaudio/best", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0"]
    else:
        cap = "" if quality == "best" else "[height<=" + quality + "]"
        command += ["--format", f"bv*{cap}+ba/b{cap}", "--merge-output-format", "mkv"]
    return command + ["--", url]


class Host:
    def __init__(self, config, emit=send_message):
        self.config = config
        self.emit = emit
        self.lock = threading.RLock()
        self.job = None
        self.process = None
        self.cancelled = False

    def hello(self):
        try:
            version = importlib.metadata.version("yt-dlp")
            importlib.metadata.version("yt-dlp-ejs")
            for name in ("ffmpeg", "ffprobe", "runtime_path"):
                if not Path(self.config.get(name, "")).is_file():
                    raise ValueError(f"Missing {name}. Run install.ps1 again.")
            self.emit({"type": "hello", "ready": True, "version": version, "folder": self.config["download_dir"]})
        except (importlib.metadata.PackageNotFoundError, ValueError, KeyError) as error:
            self.emit({"type": "hello", "ready": False, "message": str(error) + " Run install.ps1."})

    def start(self, message):
        identifier = message.get("id")
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,64}", identifier):
            raise ValueError("Invalid job ID")
        command = build_command(message, self.config)
        with self.lock:
            if self.job is not None:
                raise ValueError("A download is already running")
            self.job = identifier
            self.cancelled = False
        threading.Thread(target=self.download, args=(identifier, command), daemon=True).start()

    def event(self, identifier, **fields):
        self.emit({"type": "job", "id": identifier, **fields})

    def download(self, identifier, command):
        errors, filename = [], None
        try:
            Path(self.config["download_dir"]).mkdir(parents=True, exist_ok=True)
            with self.lock:
                if self.cancelled:
                    return
                self.process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                                errors="replace", creationflags=CREATE_FLAGS,
                                                start_new_session=(os.name != "nt"))
                process = self.process
            for line in process.stdout:
                line = line.strip()
                if line.startswith("YTDROP_"):
                    prefix, _, payload = line.partition(":")
                    try:
                        data = json.loads(payload)
                        if prefix == "YTDROP_META":
                            self.event(identifier, title=str(data.get("title", "YouTube video"))[:500])
                        elif prefix == "YTDROP_FILE":
                            filename = str(data)
                        elif prefix == "YTDROP_PROCESS":
                            self.event(identifier, status="processing")
                        elif prefix == "YTDROP_PROGRESS":
                            total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
                            done = data.get("downloaded_bytes") or 0
                            percent = min(100, max(0, done / total * 100)) if total else 0
                            speed = data.get("speed")
                            eta = data.get("eta")
                            self.event(identifier, status="processing" if data.get("status") == "finished" else "downloading",
                                       percent=round(percent, 1), speed=f"{speed / 1048576:.1f} MB/s" if speed else "",
                                       eta=f"{int(eta)}s left" if eta is not None else "")
                    except (ValueError, TypeError, AttributeError):
                        continue
                elif line:
                    errors.append(line[-1000:])
                    errors = errors[-8:]
            returncode = process.wait()
            with self.lock:
                if self.cancelled:
                    return
                if returncode != 0:
                    self.event(identifier, status="error", error="\n".join(errors[-4:]) or f"yt-dlp exited with code {returncode}")
                elif not filename:
                    self.event(identifier, status="error", error="No file was saved. The video may be live, unavailable, or filtered out.")
                else:
                    self.event(identifier, status="complete", percent=100, filename=filename)
        except Exception as error:
            if not self.cancelled:
                self.event(identifier, status="error", error=str(error)[:2000])
        finally:
            with self.lock:
                if self.cancelled:
                    self.event(identifier, status="cancelled")
                self.process = None
                self.job = None

    def cancel(self, identifier=None):
        with self.lock:
            if not self.job or (identifier is not None and identifier != self.job):
                return
            self.cancelled = True
            process = self.process
            if process and process.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=CREATE_FLAGS)
                else:
                    import signal
                    os.killpg(process.pid, signal.SIGTERM)

    def dispatch(self, message):
        action = message.get("type")
        if action == "hello":
            self.hello()
        elif action == "download":
            self.start(message)
        elif action == "cancel":
            self.cancel(message.get("id"))
        elif action == "openFolder":
            folder = Path(self.config["download_dir"])
            folder.mkdir(parents=True, exist_ok=True)
            os.startfile(str(folder))
        else:
            raise ValueError("Unknown command")


def main():
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    config = json.loads(CONFIG_FILE.read_text(encoding="utf-8-sig"))
    host = Host(config)
    try:
        while (message := read_message(sys.stdin.buffer)) is not None:
            try:
                host.dispatch(message)
            except Exception as error:
                send_message({"type": "job", "id": message.get("id"), "status": "error", "error": str(error)[:2000]})
    except (ValueError, BrokenPipeError, OSError):
        pass
    finally:
        host.cancel()


if __name__ == "__main__":
    main()

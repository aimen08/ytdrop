import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
import host

CONFIG = {"download_dir": str(Path(tempfile.gettempdir()) / "ytdrop-tests"), "ffmpeg": "C:/tools/ffmpeg.exe", "runtime": "node", "runtime_path": "C:/tools/node.exe"}
JOB = {"id": "test-job", "url": "https://youtu.be/BaW_jenozKc?list=ignored", "mode": "video", "quality": "1080"}


class FramingTests(unittest.TestCase):
    def test_unicode_frame(self):
        body = json.dumps({"title": "日本語 🌍"}, ensure_ascii=False).encode()
        self.assertEqual(host.read_message(io.BytesIO(struct.pack("<I", len(body)) + body))["title"], "日本語 🌍")

    def test_short_reads(self):
        class Partial(io.BytesIO):
            def read(self, size):
                return super().read(min(size, 2))
        self.assertEqual(host.read_message(Partial(b'\x02\0\0\0{}')), {})

    def test_rejects_invalid_frames(self):
        for frame in [b'\x01', b'\0\0\0\0', struct.pack('<I', 1000000), b'\x02\0\0\0{', b'\x02\0\0\0[]', b'\x02\0\0\0']:
            with self.subTest(frame=frame), self.assertRaises((ValueError, json.JSONDecodeError)):
                host.read_message(io.BytesIO(frame))

    def test_eof(self):
        self.assertIsNone(host.read_message(io.BytesIO()))


class ValidationTests(unittest.TestCase):
    def test_speed_modes_keep_quality_and_audio_settings(self):
        for mode in ('video', 'audio'):
            for speed, count in [('standard', '1'), ('fast', '8')]:
                command = host.build_command({**JOB, 'mode': mode, 'speed': speed}, CONFIG)
                with self.subTest(mode=mode, speed=speed):
                    self.assertEqual(command[command.index('--concurrent-fragments') + 1], count)
                    if mode == 'video':
                        self.assertIn('bv*[height<=1080]+ba/b[height<=1080]', command)
                    else:
                        self.assertEqual(command[command.index('--audio-quality') + 1], '0')
                        self.assertIn('mp3', command)

    def test_old_requests_default_to_fast(self):
        command = host.build_command(JOB, CONFIG)
        self.assertEqual(command[command.index('--concurrent-fragments') + 1], '8')

    def test_rejects_arbitrary_speed_arguments(self):
        for speed in ('turbo', '--exec=calc', 1000, None, {}):
            with self.subTest(speed=speed), self.assertRaises(ValueError):
                host.build_command({**JOB, 'speed': speed}, CONFIG)

    def test_video_links(self):
        for link in [JOB['url'], 'https://m.youtube.com/watch?v=BaW_jenozKc&list=x', 'https://youtube.com/shorts/BaW_jenozKc', 'https://music.youtube.com/watch?v=BaW_jenozKc', 'https://youtube.com/live/BaW_jenozKc']:
            self.assertEqual(host.youtube_url(link), 'https://www.youtube.com/watch?v=BaW_jenozKc')

    def test_rejects_untrusted_urls(self):
        for link in ['file:///x', 'https://youtube.com.evil.test/watch?v=BaW_jenozKc', 'https://youtube.com@evil.test/watch?v=BaW_jenozKc', 'https://user@youtube.com/watch?v=BaW_jenozKc', 'https://youtube.com/playlist?list=x', '--exec=calc', None, 'https://youtube.com:1234/watch?v=BaW_jenozKc', 'https://youtube.com/watch?v=日本語語語語語語語語語']:
            with self.subTest(link=link), self.assertRaises(ValueError):
                host.youtube_url(link)

    def test_fixed_args_and_format(self):
        command = host.build_command(JOB, CONFIG)
        self.assertIn('bv*[height<=1080]+ba/b[height<=1080]', command)
        self.assertEqual(command[-2:], ['--', 'https://www.youtube.com/watch?v=BaW_jenozKc'])
        self.assertIn('--ignore-config', command)
        self.assertIn('--no-plugin-dirs', command)
        self.assertNotIn('--exec', command)
        self.assertIn('node:C:/tools/node.exe', command)
        audio = host.build_command({**JOB, 'mode': 'audio'}, CONFIG)
        self.assertIn('--extract-audio', audio)
        self.assertIn('mp3', audio)
        with self.assertRaises(ValueError):
            host.build_command({**JOB, 'quality': '1080];--exec=calc'}, CONFIG)


class FakeProcess:
    pid = 999999
    def __init__(self, lines, code=0):
        self.stdout = io.StringIO('\n'.join(lines))
        self.code = code
    def wait(self):
        return self.code
    def poll(self):
        return None


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.host = host.Host(CONFIG, self.events.append)
        self.host.job = JOB['id']

    def run_download(self, lines, code=0):
        with patch.object(host.subprocess, 'Popen', return_value=FakeProcess(lines, code)), patch.object(Path, 'mkdir'):
            self.host.download(JOB['id'], ['fake'])

    def test_progress_and_final_filename(self):
        self.run_download(['YTDROP_META:{"title":"Example"}', 'YTDROP_PROGRESS:{"downloaded_bytes":50,"total_bytes":100,"speed":1048576,"eta":3}', 'YTDROP_PROCESS:"started"', 'YTDROP_FILE:"C:/Downloads/example.mkv"'])
        self.assertEqual(self.events[0]['title'], 'Example')
        self.assertEqual(self.events[1]['percent'], 50)
        self.assertEqual(self.events[1]['speed'], '1.0 MB/s')
        self.assertEqual(self.events[-1]['status'], 'complete')
        self.assertEqual(self.events[-1]['filename'], 'C:/Downloads/example.mkv')
        self.assertIsNone(self.host.job)

    def test_failure_and_no_file_are_not_success(self):
        self.run_download(['ERROR: Video unavailable'], code=1)
        self.assertEqual(self.events[-1]['status'], 'error')
        self.assertIn('Video unavailable', self.events[-1]['error'])
        self.run_download([])
        self.assertEqual(self.events[-1]['status'], 'error')

    def test_cancel_before_spawn(self):
        self.host.cancel(JOB['id'])
        with patch.object(host.subprocess, 'Popen') as launch, patch.object(Path, 'mkdir'):
            self.host.download(JOB['id'], ['fake'])
            launch.assert_not_called()
        self.assertEqual(self.events[-1]['status'], 'cancelled')

    @unittest.skipUnless(host.os.name == 'nt', 'Windows process-tree termination')
    def test_cancel_kills_tree_only_for_matching_job(self):
        self.host.process = FakeProcess([])
        with patch.object(host.subprocess, 'run') as kill:
            self.host.cancel('wrong-job')
            kill.assert_not_called()
            self.host.cancel(JOB['id'])
            self.assertEqual(kill.call_args.args[0], ['taskkill.exe', '/PID', '999999', '/T', '/F'])
        self.assertTrue(self.host.cancelled)

    def test_rejects_concurrent_download(self):
        with self.assertRaisesRegex(ValueError, 'already running'):
            self.host.start(JOB)


if __name__ == '__main__':
    unittest.main()

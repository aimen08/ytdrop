# Validation — 27 September 2026

- 15 JavaScript tests passed: URL handling and service-worker download lifecycle.
- 12 Python tests passed: message framing, URL validation, fixed command arguments, progress, failures, concurrency, and cancellation.
- Actual yt-dlp 2026.8.19 downloaded a generated video fixture and converted an audio fixture to MP3 using FFmpeg 8.1.1.
- Actual yt-dlp successfully downloaded YouTube's “Me at the zoo” (`jNQXAC9IVRw`) as an MKV file through this helper's download path.
- Installed the per-user Windows helper; verified the registry manifest, exact extension allowlist, CMD launcher, and binary native messaging handshake.
- Browser preview verified audio selection, quality disabling, progress display, and keyboard cancellation using a mock Chrome API.

The complete Chrome-extension-to-native-host connection still needs verification after loading the unpacked extension in Chrome. The browser preview is a UI test, not a recording of the live YouTube download. Private/authenticated content, playlist downloads, and active live broadcasts are outside this build's scope.

# Validation — 27 September 2026

## Version 1.2.0 UI update — 30 September 2026

- 21 JavaScript tests passed, including canonical video/title matching, invalid links, progress bounds, ETA formatting, retry settings after progress updates, and interrupted-job history.
- All 15 existing Python tests passed. The native helper is unchanged.
- Browser-tested the shipped popup files through the local mock-Chrome preview: Video/Audio controls, immediate preference persistence, manual draft persistence, inline validation, preparation, progress, indeterminate conversion, completion, folder commands, cancellation, error details, retry, history reuse, empty next-download state, unavailable current tabs, missing-helper setup, and reconnection.
- Ready state with recent history measures 400 × 581 CSS pixels; its download button and folder shortcut fit within Chrome's 600-pixel popup height. Expanded options/history and setup errors may scroll. The saved screenshot uses sample data.
- No browser console errors or warnings appeared during the preview checks. Setup guide links and text were inspected.
- The Windows desktop-control tool stopped the actual-Chrome check because it could not confidently determine the current URL. No actual Chrome reload or new end-to-end YouTube download is claimed for 1.2.0; reload the installed extension to activate the update.

## Original integration checks

- 15 JavaScript tests passed: URL handling and service-worker download lifecycle.
- 15 Python tests passed: message framing, URL validation, fixed command arguments, speed modes, backwards-compatible defaults, progress, failures, concurrency, and cancellation.
- Actual yt-dlp 2026.8.19 downloaded a generated video fixture and converted an audio fixture to MP3 using FFmpeg 8.1.1.
- Actual yt-dlp successfully downloaded YouTube's “Me at the zoo” (`jNQXAC9IVRw`) as an MKV file through this helper's download path.
- Installed the per-user Windows helper; verified the registry manifest, exact extension allowlist, CMD launcher, and binary native messaging handshake.
- Browser preview verified audio selection, quality disabling, progress display, and keyboard cancellation using a mock Chrome API.

The complete Chrome-extension-to-native-host connection still needs verification after loading the unpacked extension in Chrome. The browser preview is a UI test, not a recording of the live YouTube download. Private/authenticated content, playlist downloads, and active live broadcasts are outside this build's scope.

## Version 1.1.0 speed update

- Verified default Fast and explicit Standard modes, speed validation in both the service worker and host, and preservation of resolution and MP3 quality settings.
- A real yt-dlp HLS benchmark fetched 16 generated fragments from a local server that added 150 ms latency to each request. Standard: 3.979 seconds total, 2.665 seconds transfer, one concurrent request. Fast: 1.488 seconds total, 0.321 seconds transfer, eight concurrent requests. Final output hashes matched and ffprobe verified duration.
- Rechecked a live YouTube download, native handshake, generated video download, and MP3 conversion with the new compact progress messages.
- Browser preview checked the default Fast selection, Standard submission, and persistence of Standard after reopening the preview with a mock Chrome storage API.
- The synthetic benchmark demonstrates concurrency, not guaranteed improvement for every YouTube URL. Single-file HTTP downloads and MP3 conversion are not accelerated by the fragment concurrency setting.

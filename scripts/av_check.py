#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HELP = """Machine checks for a finished video: streams, A/V drift, silent stretches, size.

  python3 scripts/av_check.py final.mp4 [--expect-audio] [--max-drift 0.05] [--max-silence 3.0] [--min-width 1280]

Prints one JSON report. Exit code 0 = all checks passed, 2 = at least one failed.
Silent stretches are reported with timestamps so you can match them to scenes."""


def tools_env():
    env_file = Path(__file__).resolve().parent.parent / ".tools" / "env.sh"
    values = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            match = re.match(r'^export\s+([A-Z_]+)="?([^"]*)"?$', line.strip())
            if match:
                values[match.group(1)] = match.group(2)
    return values


def runnable(path):
    try:
        return subprocess.run([path, "-hide_banner", "-version"], capture_output=True).returncode == 0
    except OSError:
        return False


def binary(name):
    configured = os.environ.get(name.upper()) or tools_env().get(name.upper())
    if configured and Path(configured).exists() and runnable(configured):
        return configured
    found = shutil.which(name)
    return found if found and runnable(found) else None


def probe(ffprobe, path):
    output = subprocess.check_output([
        ffprobe, "-v", "error", "-show_entries",
        "format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,duration,sample_rate,channels,r_frame_rate,pix_fmt",
        "-of", "json", str(path),
    ], text=True)
    return json.loads(output)


def probe_with_ffmpeg(ffmpeg, path):
    header = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", header)
    seconds = int(duration.group(1)) * 3600 + int(duration.group(2)) * 60 + float(duration.group(3)) if duration else 0
    streams = []
    for index, kind, codec, rest in re.findall(r"Stream #\d+:(\d+)[^:]*: (Video|Audio): (\w+)([^\n]*)", header):
        size = re.search(r", (\d{2,5})x(\d{2,5})", rest)
        rate = re.search(r"(\d+) Hz", rest)
        pix = re.search(r"\), (\w+)\(|, (yuv\w+|rgb\w+|nv12)", rest)
        selector = "0:v:0" if kind == "Video" else "0:a:0"
        decoded = subprocess.run([ffmpeg, "-hide_banner", "-nostats", "-i", str(path), "-map", selector, "-f", "null", "-"], capture_output=True, text=True).stderr
        times = re.findall(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)", decoded)
        stream_seconds = int(times[-1][0]) * 3600 + int(times[-1][1]) * 60 + float(times[-1][2]) if times else seconds
        streams.append({
            "codec_type": kind.lower(),
            "codec_name": codec,
            "width": int(size.group(1)) if size else None,
            "height": int(size.group(2)) if size else None,
            "pix_fmt": (pix.group(1) or pix.group(2)) if pix else None,
            "sample_rate": rate.group(1) if rate else None,
            "channels": 2 if "stereo" in rest else 1 if "mono" in rest else None,
            "duration": stream_seconds,
        })
    size_bytes = Path(path).stat().st_size
    return {"streams": streams, "format": {"duration": seconds, "size": size_bytes}}


def silences(ffmpeg, path, min_seconds, noise_db):
    result = subprocess.run([
        ffmpeg, "-hide_banner", "-nostats", "-i", str(path), "-af",
        f"silencedetect=noise={noise_db}dB:d={min_seconds}", "-f", "null", "-",
    ], capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", result.stderr)]
    ends = re.findall(r"silence_end: ([\d.]+) \| silence_duration: ([\d.]+)", result.stderr)
    windows = []
    for index, start in enumerate(starts):
        end, length = (float(ends[index][0]), float(ends[index][1])) if index < len(ends) else (None, None)
        windows.append({"start": round(max(start, 0), 2), "end": round(end, 2) if end else None, "seconds": round(length, 2) if length else None})
    return windows


def main():
    parser = argparse.ArgumentParser(description=HELP, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video")
    parser.add_argument("--expect-audio", action="store_true")
    parser.add_argument("--max-drift", type=float, default=0.05)
    parser.add_argument("--max-silence", type=float, default=3.0)
    parser.add_argument("--noise-db", type=float, default=-45.0)
    parser.add_argument("--min-width", type=int, default=0)
    args = parser.parse_args()

    ffprobe, ffmpeg = binary("ffprobe"), binary("ffmpeg")
    if not ffmpeg:
        print(json.dumps({"ok": False, "error": "ffmpeg is required (bash scripts/setup-tools.sh)"}))
        sys.exit(2)

    info = probe(ffprobe, args.video) if ffprobe else probe_with_ffmpeg(ffmpeg, args.video)
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    container = float(info.get("format", {}).get("duration") or 0)
    video_duration = float(video.get("duration") or container) if video else None
    audio_duration = float(audio.get("duration") or container) if audio else None

    checks = []
    checks.append({"check": "video stream", "ok": video is not None, "detail": f"{video.get('codec_name')} {video.get('width')}x{video.get('height')} {video.get('pix_fmt')}" if video else "missing"})
    if video and args.min_width:
        checks.append({"check": "resolution", "ok": int(video.get("width") or 0) >= args.min_width, "detail": f"width {video.get('width')} >= {args.min_width}"})
    if args.expect_audio or audio:
        checks.append({"check": "audio stream", "ok": audio is not None, "detail": f"{audio.get('codec_name')} {audio.get('sample_rate')}Hz {audio.get('channels')}ch" if audio else "missing"})
    drift = None
    if video_duration and audio_duration:
        drift = abs(video_duration - audio_duration)
        checks.append({"check": "a/v drift", "ok": drift <= args.max_drift, "detail": f"{drift:.3f}s (video {video_duration:.2f}s, audio {audio_duration:.2f}s)"})
    quiet = []
    if audio:
        quiet = silences(ffmpeg, args.video, args.max_silence, args.noise_db)
        checks.append({"check": f"no silence > {args.max_silence}s", "ok": not quiet, "detail": quiet or "none"})

    ok = all(c["ok"] for c in checks)
    print(json.dumps({
        "ok": ok,
        "file": str(Path(args.video).resolve()),
        "duration": round(container, 3),
        "size_mb": round(int(info.get("format", {}).get("size") or 0) / 1048576, 2),
        "checks": checks,
    }, indent=2))
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()

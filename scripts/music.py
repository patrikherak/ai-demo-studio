#!/usr/bin/env python3
import argparse
import math
import os
import random
import struct
import subprocess
import sys
import tempfile
import wave
from array import array

HELP = """Generate a royalty-free background music bed and UI sound effects, offline.

  python3 scripts/music.py --duration 95 --out work/<slug>/audio/music.wav [--bpm 100] [--mood bright|calm] [--seed 7]
  python3 scripts/music.py --sfx-dir work/<slug>/audio/sfx

The bed is a gentle corporate groove (FM electric piano, pad, plucked arpeggio,
sub bass, soft drums) with an intro, a build, a steady middle and a ring-out that
ends exactly at --duration. Tempo is exact, so scenes can be cut on the beat
(fit-scenes.mjs --bpm). Sound effects: whoosh, pop, click, chime (.wav).
Needs ffmpeg (FFMPEG env or PATH) for reverb and loudness normalisation.
"""

RATE = 44100
NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(name):
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[pitch] + 12 * (octave + 1) - 69) / 12)


def buffer(seconds):
    return array("d", bytes(8 * int(seconds * RATE)))


def add(mix, buf, start, gain=1.0):
    offset = int(start * RATE)
    if offset >= len(mix):
        return
    end = min(len(buf), len(mix) - offset)
    for i in range(end):
        mix[offset + i] += buf[i] * gain


def pad_voice(freq, seconds, rng):
    out = buffer(seconds + 1.4)
    detune = [1.0, 1.0035, 0.9968]
    phases = [rng.random() * 2 * math.pi for _ in detune]
    attack, release = 0.9, 1.3
    n = len(out)
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / attack) * (1.0 if t < seconds else max(0.0, 1 - (t - seconds) / release))
        if env <= 0:
            continue
        s = 0.0
        for d, p in zip(detune, phases):
            w = 2 * math.pi * freq * d * t + p
            s += math.sin(w) + 0.22 * math.sin(2 * w) + 0.08 * math.sin(3 * w)
        out[i] = s * env / 3.6
    return out


def ep_note(freq, seconds=2.2):
    out = buffer(seconds)
    for i in range(len(out)):
        t = i / RATE
        index = 1.8 * math.exp(-t * 3.2)
        tine = 0.35 * math.exp(-t * 9.0) * math.sin(2 * math.pi * freq * 14 * t)
        carrier = math.sin(2 * math.pi * freq * t + index * math.sin(2 * math.pi * freq * t) + tine)
        env = min(1.0, t / 0.004) * math.exp(-t * 1.9)
        out[i] = carrier * env
    return out


def pluck(freq, seconds, rng):
    period = max(2, int(RATE / freq))
    ring = [rng.uniform(-1, 1) for _ in range(period)]
    out = buffer(seconds)
    idx = 0
    prev = 0.0
    for i in range(len(out)):
        cur = ring[idx]
        nxt = ring[(idx + 1) % period]
        value = 0.4985 * (cur + nxt)
        ring[idx] = value
        idx = (idx + 1) % period
        prev = 0.7 * prev + 0.3 * cur
        out[i] = prev
    peak = max(1e-9, max(abs(v) for v in out[: min(len(out), 2000)]))
    for i in range(len(out)):
        out[i] /= peak
    return out


def bass_note(freq, seconds):
    out = buffer(seconds)
    for i in range(len(out)):
        t = i / RATE
        env = min(1.0, t / 0.01) * math.exp(-t * 2.2)
        out[i] = (math.sin(2 * math.pi * freq * t) + 0.18 * math.sin(4 * math.pi * freq * t)) * env
    return out


def kick():
    out = buffer(0.35)
    phase = 0.0
    for i in range(len(out)):
        t = i / RATE
        f = 45 + 75 * math.exp(-t * 28)
        phase += 2 * math.pi * f / RATE
        out[i] = math.sin(phase) * math.exp(-t * 11) * min(1.0, t / 0.002)
    return out


def noise_hit(seconds, decay, rng, hp=0.85):
    out = buffer(seconds)
    last_in = last_out = 0.0
    for i in range(len(out)):
        t = i / RATE
        x = rng.uniform(-1, 1)
        y = hp * (last_out + x - last_in)
        last_in, last_out = x, y
        out[i] = y * math.exp(-t * decay)
    return out


def snare(rng):
    body = buffer(0.25)
    for i in range(len(body)):
        t = i / RATE
        body[i] = math.sin(2 * math.pi * 190 * t) * math.exp(-t * 30) * 0.5
    noise = noise_hit(0.25, 22, rng, hp=0.6)
    return array("d", [a + 0.7 * b for a, b in zip(body, noise)])


def write_wav(path, left, right):
    peak = max(1e-9, max(max(abs(v) for v in left), max(abs(v) for v in right)))
    scale = 0.89 / peak
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        frames = bytearray()
        for l, r in zip(left, right):
            frames += struct.pack("<hh", int(max(-1, min(1, l * scale)) * 32767), int(max(-1, min(1, r * scale)) * 32767))
        w.writeframes(bytes(frames))


def ffmpeg_bin():
    configured = os.environ.get("FFMPEG")
    return configured if configured and os.path.exists(configured) else "ffmpeg"


PROGRESSIONS = {
    "bright": [("C", ["C3", "G3", "D4", "E4"]), ("G", ["G2", "D3", "B3", "D4"]), ("A", ["A2", "E3", "G3", "C4"]), ("F", ["F2", "C3", "E3", "A3"])],
    "calm": [("F", ["F2", "C3", "E3", "A3"]), ("C", ["C3", "G3", "D4", "E4"]), ("A", ["A2", "E3", "G3", "C4"]), ("G", ["G2", "D3", "B3", "D4"])],
}


def render_bed(duration, bpm, mood, seed):
    rng = random.Random(seed)
    beat = 60.0 / bpm
    bar = 4 * beat
    bars = max(4, math.ceil(duration / bar))
    left, right = buffer(duration + 3), buffer(duration + 3)
    progression = PROGRESSIONS.get(mood, PROGRESSIONS["bright"])
    pad_cache, ep_cache, pluck_cache, bass_cache = {}, {}, {}, {}
    k, hat, sn = kick(), noise_hit(0.05, 90, rng), snare(rng)
    last_full_bar = bars - 2
    for b in range(bars):
        start = b * bar
        if start >= duration:
            break
        root, voicing = progression[b % len(progression)]
        key = (root, tuple(voicing))
        if key not in pad_cache:
            voices = [pad_voice(hz(n), bar, rng) for n in voicing]
            pad_cache[key] = array("d", [sum(v[i] for v in voices) / len(voices) for i in range(len(voices[0]))])
        intro = b < 2
        outro = b >= last_full_bar
        add(left, pad_cache[key], start, 0.34)
        add(right, pad_cache[key], start + 0.012, 0.34)
        if not intro:
            if key not in ep_cache:
                notes = [ep_note(hz(n[:-1] + str(int(n[-1]) + 1))) for n in voicing[1:]]
                ep_cache[key] = array("d", [sum(v[i] for v in notes) / len(notes) for i in range(len(notes[0]))])
            for hit, gain in ((0.0, 0.5), (1.5 * beat, 0.34), (3.0 * beat, 0.3)):
                if outro and hit > 0:
                    continue
                add(left, ep_cache[key], start + hit, gain * 0.9)
                add(right, ep_cache[key], start + hit + 0.006, gain)
            bass_freq = hz(voicing[0][:-1] + str(max(1, int(voicing[0][-1]) - 1)))
            if bass_freq not in bass_cache:
                bass_cache[bass_freq] = bass_note(bass_freq, 1.4 * beat)
            for step in ((0, 1.0), (2.5 * beat, 0.7)) if not outro else ((0, 1.0),):
                add(left, bass_cache[bass_freq], start + step[0], 0.42 * step[1])
                add(right, bass_cache[bass_freq], start + step[0], 0.42 * step[1])
        if b >= 4 and not outro:
            pattern = [voicing[1], voicing[2], voicing[3], voicing[2], voicing[1], voicing[3], voicing[2], voicing[3]]
            for i, n in enumerate(pattern):
                note = n[:-1] + str(int(n[-1]) + 1)
                if note not in pluck_cache:
                    pluck_cache[note] = pluck(hz(note), 0.9, rng)
                pan = 0.35 if i % 2 else 0.65
                t = start + i * beat / 2
                add(left, pluck_cache[note], t, 0.16 * (1 - pan) * 2)
                add(right, pluck_cache[note], t, 0.16 * pan * 2)
        if b >= 4 and not outro:
            for i in range(4):
                if i in (0, 2):
                    add(left, k, start + i * beat, 0.55)
                    add(right, k, start + i * beat, 0.55)
                if b >= 8 and i in (1, 3):
                    add(left, sn, start + i * beat, 0.16)
                    add(right, sn, start + i * beat, 0.16)
            for i in range(8):
                if i % 2:
                    add(left, hat, start + i * beat / 2, 0.08)
                    add(right, hat, start + i * beat / 2 + 0.004, 0.1)
    fade = 3.0
    n = int(duration * RATE)
    for i in range(len(left)):
        t = i / RATE
        g = 1.0 if t < duration - fade else max(0.0, (duration - t) / fade)
        g *= min(1.0, t / 1.2)
        left[i] *= g
        right[i] *= g
    return left[:n], right[:n]


def impulse_response(path, seconds=2.4, seed=3):
    rng = random.Random(seed)
    left, right = buffer(seconds), buffer(seconds)
    lp_l = lp_r = 0.0
    for i in range(len(left)):
        t = i / RATE
        env = math.exp(-t * 3.1)
        lp_l = 0.55 * lp_l + 0.45 * rng.uniform(-1, 1)
        lp_r = 0.55 * lp_r + 0.45 * rng.uniform(-1, 1)
        left[i] = lp_l * env
        right[i] = lp_r * env
    left[0] = right[0] = 1.0
    write_wav(path, left, right)


def measured_loudness(path):
    result = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", path, "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True)
    for line in reversed(result.stderr.splitlines()):
        line = line.strip()
        if line.startswith("I:"):
            return float(line.split()[1])
    return -23.0


def build_bed(args):
    with tempfile.TemporaryDirectory() as tmp:
        dry = os.path.join(tmp, "dry.wav")
        ir = os.path.join(tmp, "ir.wav")
        wet = os.path.join(tmp, "wet.wav")
        left, right = render_bed(args.duration, args.bpm, args.mood, args.seed)
        write_wav(dry, left, right)
        impulse_response(ir)
        subprocess.run([
            ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", "-i", dry, "-i", ir,
            "-filter_complex", "[0:a]asplit[a][b];[b][1:a]afir=dry=10:wet=10:length=1[wet];[a][wet]amix=inputs=2:weights='1 0.45':normalize=0,highpass=f=35",
            "-ar", str(RATE), "-ac", "2", wet,
        ], check=True)
        gain = args.loudness - measured_loudness(wet)
        fade = min(3.0, args.duration / 4)
        subprocess.run([
            ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", "-i", wet,
            "-af", "volume=%.2fdB,alimiter=limit=0.79:level=disabled,atrim=0:%.3f,afade=t=out:st=%.3f:d=%.3f" % (gain, args.duration, args.duration - fade, fade),
            "-ar", str(RATE), "-ac", "2", args.out,
        ], check=True)
    print(f"MUSIC {args.out} duration={args.duration:.2f}s bpm={args.bpm} mood={args.mood} loudness={args.loudness} LUFS")


def sweep_noise(seconds, rng, rise=True):
    out_l, out_r = buffer(seconds), buffer(seconds)
    lp = 0.0
    for i in range(len(out_l)):
        t = i / RATE
        p = t / seconds
        cutoff = 0.03 + 0.5 * (p if rise else 1 - p)
        lp += cutoff * (rng.uniform(-1, 1) - lp)
        env = math.sin(math.pi * p) ** 1.6
        out_l[i] = lp * env * (1 - p * 0.6)
        out_r[i] = lp * env * (0.4 + p * 0.6)
    return out_l, out_r


def build_sfx(directory, seed):
    rng = random.Random(seed)
    os.makedirs(directory, exist_ok=True)
    l, r = sweep_noise(0.55, rng)
    write_wav(os.path.join(directory, "whoosh.wav"), l, r)
    pop = buffer(0.14)
    phase = 0.0
    for i in range(len(pop)):
        t = i / RATE
        phase += 2 * math.pi * (520 + 700 * math.exp(-t * 40)) / RATE
        pop[i] = math.sin(phase) * math.exp(-t * 34) * min(1.0, t / 0.001)
    write_wav(os.path.join(directory, "pop.wav"), pop, pop)
    click = noise_hit(0.03, 260, rng, hp=0.92)
    for i in range(len(click)):
        click[i] = 0.6 * click[i] + 0.4 * math.sin(2 * math.pi * 2400 * i / RATE) * math.exp(-i / RATE * 320)
    write_wav(os.path.join(directory, "click.wav"), click, click)
    chime = buffer(1.2)
    for f, delay, gain in ((hz("E6"), 0.0, 1.0), (hz("B6"), 0.09, 0.8)):
        start = int(delay * RATE)
        for i in range(start, len(chime)):
            t = (i - start) / RATE
            chime[i] += gain * math.sin(2 * math.pi * f * t + 1.2 * math.exp(-t * 6) * math.sin(2 * math.pi * f * 3.5 * t)) * math.exp(-t * 4.2)
    write_wav(os.path.join(directory, "chime.wav"), chime, chime)
    print(f"SFX {directory} whoosh.wav pop.wav click.wav chime.wav")


def main():
    if len(sys.argv) == 1 or "-h" in sys.argv or "--help" in sys.argv:
        print(HELP)
        sys.exit(0 if len(sys.argv) > 1 else 1)
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--duration", type=float)
    parser.add_argument("--out")
    parser.add_argument("--bpm", type=float, default=100)
    parser.add_argument("--mood", default="bright")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--sfx-dir")
    parser.add_argument("--loudness", type=float, default=-18.0)
    args = parser.parse_args()
    if args.sfx_dir:
        build_sfx(args.sfx_dir, args.seed)
    if args.out:
        if not args.duration:
            sys.exit("ERROR --duration is required with --out")
        build_bed(args)


if __name__ == "__main__":
    main()

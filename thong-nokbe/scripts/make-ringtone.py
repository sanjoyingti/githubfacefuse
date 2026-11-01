# Original ringtone for Thong Nokbe Gym (synthesised, no third-party audio). ~30 s, mono 22.05 kHz WAV.
import math, struct, wave, sys
out = sys.argv[1] if len(sys.argv) > 1 else 'assets/sounds/ringtone.wav'
SR = 22050
def note(freq, dur, vol=0.5):
    n = int(SR * dur); s = []
    for i in range(n):
        t = i / SR
        env = math.exp(-6 * t) * min(1, t * 200)          # quick attack, marimba-like decay
        v = math.sin(2 * math.pi * freq * t) + 0.35 * math.sin(2 * math.pi * freq * 4 * t) * math.exp(-14 * t)
        s.append(vol * env * v)
    return s
def silence(d): return [0.0] * int(SR * d)
E5, G5, A5, C6, D6 = 659.25, 783.99, 880.0, 1046.5, 1174.66
phrase = []
for f in (E5, G5, C6, G5, D6, C6):
    phrase += note(f, 0.17)
phrase += note(C6, 0.45) + silence(0.9)
samples = []
while len(samples) < SR * 30:
    samples += phrase
peak = max(abs(x) for x in samples) or 1
with wave.open(out, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(32000 * x / peak * 0.8)) for x in samples))
print(out, round(len(samples) / SR, 1), 's')

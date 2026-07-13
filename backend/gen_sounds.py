import numpy as np, wave, os

SR = 44100
OUT = "/app/frontend/assets/sounds/lab"
os.makedirs(OUT, exist_ok=True)

def env_ad(n, a=0.005, d=0.3):
    """Attack-decay exponential envelope."""
    t = np.arange(n) / SR
    at = np.clip(t / a, 0, 1)
    de = np.exp(-np.maximum(t - a, 0) / d)
    return at * de

def tone(freq, dur, decay=0.3, harm=(1.0,), amps=(1.0,)):
    n = int(SR * dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for h, am in zip(harm, amps):
        y += am * np.sin(2 * np.pi * freq * h * t)
    return y * env_ad(n, 0.004, decay)

def fm_bell(freq, dur, decay=0.35, mod=2.0, idx=3.0):
    n = int(SR * dur)
    t = np.arange(n) / SR
    e = np.exp(-t / decay)
    y = np.sin(2 * np.pi * freq * t + idx * e * np.sin(2 * np.pi * freq * mod * t))
    return y * env_ad(n, 0.003, decay)

def noise_sweep(dur, f0, f1, decay=0.4):
    n = int(SR * dur)
    t = np.arange(n) / SR
    nz = np.random.randn(n)
    # simple one-pole time-varying lowpass to create a sweep feel
    cutoff = f0 + (f1 - f0) * (t / dur)
    alpha = np.clip(cutoff / (SR / 2), 0.001, 0.99)
    y = np.zeros(n); prev = 0.0
    for i in range(n):
        prev = prev + alpha[i] * (nz[i] - prev)
        y[i] = prev
    env = np.sin(np.pi * t / dur) ** 1.2
    return y * env

def place(buf, seg, start):
    s = int(start * SR)
    e = min(len(buf), s + len(seg))
    buf[s:e] += seg[: e - s]

def norm_write(name, y, peak=0.85):
    y = y / (np.max(np.abs(y)) + 1e-9) * peak
    # gentle overall fade-out tail to avoid clicks
    tail = min(len(y), int(0.01 * SR))
    y[-tail:] *= np.linspace(1, 0, tail)
    data = (y * 32767).astype(np.int16)
    with wave.open(os.path.join(OUT, name), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(data.tobytes())
    print("wrote", name, f"{len(y)/SR:.2f}s")

# ---------- CASH / BIG WIN (3 variants) ----------
# A: Cash register ding — short "cha" transient + bright two-bell "ching"
buf = np.zeros(int(SR * 0.8))
cha = noise_sweep(0.09, 4000, 1200, 0.05) * 0.6
place(buf, cha, 0.0)
place(buf, fm_bell(1318.5, 0.5, 0.32, 3.0, 2.5) * 0.9, 0.08)   # E6
place(buf, fm_bell(1760.0, 0.55, 0.4, 3.0, 2.2) * 0.8, 0.12)   # A6
norm_write("cash_a.wav", buf)

# B: Arcade win — ascending bright arpeggio C5-E5-G5-C6
buf = np.zeros(int(SR * 0.85))
notes = [523.25, 659.25, 783.99, 1046.5]
for i, f in enumerate(notes):
    place(buf, tone(f, 0.3, 0.22, harm=(1, 2, 3), amps=(1, 0.5, 0.25)) * 0.9, 0.09 * i)
place(buf, fm_bell(1046.5, 0.5, 0.4) * 0.7, 0.09 * 3)
norm_write("cash_b.wav", buf)

# C: Sparkle chimes — layered high bells shimmering
buf = np.zeros(int(SR * 1.0))
for i, f in enumerate([1568, 2093, 2637, 3136]):
    place(buf, fm_bell(f, 0.7 - i * 0.05, 0.5, 1.5, 2.0) * (0.9 - i * 0.12), 0.06 * i)
norm_write("cash_c.wav", buf)

# ---------- COIN (profitable trade) ----------
# A: single crisp ting
buf = np.zeros(int(SR * 0.45))
place(buf, fm_bell(1568, 0.4, 0.28, 3.0, 2.0), 0.0)
norm_write("coin_a.wav", buf)

# B: coin bounce — two quick tings rising
buf = np.zeros(int(SR * 0.5))
place(buf, fm_bell(1568, 0.22, 0.16), 0.0)
place(buf, fm_bell(2093, 0.3, 0.22), 0.11)
norm_write("coin_b.wav", buf)

# C: coin clink — metallic FM with faint noise tick
buf = np.zeros(int(SR * 0.5))
place(buf, noise_sweep(0.04, 6000, 3000, 0.03) * 0.4, 0.0)
place(buf, fm_bell(1975, 0.42, 0.3, 3.5, 4.0), 0.02)
norm_write("coin_c.wav", buf)

# ---------- REFRESH (pull-to-refresh) ----------
# A: soft swoosh
buf = noise_sweep(0.45, 500, 3500, 0.4) * 0.9
norm_write("refresh_a.wav", buf, peak=0.7)

# B: bubble pop — quick pitch-rising blip
n = int(SR * 0.18); t = np.arange(n) / SR
f = 500 + 700 * (t / 0.18)
pop = np.sin(2 * np.pi * f * t) * env_ad(n, 0.004, 0.09)
norm_write("refresh_b.wav", pop, peak=0.7)

# C: gentle two-note blip
buf = np.zeros(int(SR * 0.32))
place(buf, tone(880, 0.14, 0.09, harm=(1, 2), amps=(1, 0.3)), 0.0)
place(buf, tone(1174.7, 0.18, 0.12, harm=(1, 2), amps=(1, 0.3)), 0.09)
norm_write("refresh_c.wav", buf, peak=0.7)

print("done")

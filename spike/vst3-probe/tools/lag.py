"""Measure the actual delay between an input WAV and a processed WAV (cross-correlation over a window).
Usage: python -I lag.py <in.wav> <out.wav> [max_lag]
Supports PCM16 and float32 mono files. Stdlib only."""
import struct, sys, array

def read(path):
    d = open(path, 'rb').read()
    i, fmt, data = 12, None, None
    while i < len(d) - 8:
        cid, sz = d[i:i+4], struct.unpack('<I', d[i+4:i+8])[0]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', d[i+8:i+24])
        elif cid == b'data':
            data = d[i+8:i+8+sz]
        i += 8 + sz + (sz & 1)
    tag, ch, sr, _, _, bits = fmt
    if tag == 1 and bits == 16:
        a = array.array('h'); a.frombytes(data); return [x / 32768.0 for x in a], sr
    if tag in (3, 0xFFFE) and bits == 32:
        a = array.array('f'); a.frombytes(data); return list(a), sr
    raise SystemExit(f'unsupported format {fmt}')

x, sr = read(sys.argv[1]); y, _ = read(sys.argv[2])
maxlag = int(sys.argv[3]) if len(sys.argv) > 3 else 1500
# Use the loudest 1 s window of the input.
win = sr
best_start, best_e = 0, -1
for s in range(0, len(x) - win, win // 4):
    e = sum(v * v for v in x[s:s+win:8])
    if e > best_e: best_e, best_start = e, s
s0 = best_start + maxlag
seg = x[s0:s0+win]
def corr(lag):
    ys = y[s0+lag:s0+lag+win]
    num = sum(a * b for a, b in zip(seg, ys))
    den = (sum(a*a for a in seg) * sum(b*b for b in ys)) ** 0.5 or 1
    return num / den
cands = sorted(((corr(l), l) for l in range(-maxlag, maxlag + 1, 1)), reverse=True)[:3]
print(f'window at {s0/sr:.2f}s; best lags (corr, samples): ' + ', '.join(f'({c:.3f}, {l})' for c, l in cands))

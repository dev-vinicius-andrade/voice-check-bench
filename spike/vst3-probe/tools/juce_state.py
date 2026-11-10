"""Decode a Wave Link (JUCE host) ParameterState blob for a VST3 plugin.

Layout: 'VC2!' + u32le(len) + XML(<VST3PluginState><IComponent>N.juceb64</IComponent>[<IEditController>..]) + NUL
Usage: python -I juce_state.py <state.bin> [outprefix]
"""
import re, struct, sys

TABLE = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+"

def juce_b64_decode(s: str) -> bytes:
    size_str, data = s.split('.', 1)
    size = int(size_str)
    out = bytearray(size)
    for i, ch in enumerate(data):
        v = TABLE.index(ch)
        bit = i * 6
        for b in range(6):
            pos = bit + b
            if pos // 8 >= size:
                break
            if v & (1 << b):
                out[pos // 8] |= 1 << (pos % 8)
    return bytes(out)

def juce_b64_encode(b: bytes) -> str:
    n = (len(b) * 8 + 5) // 6
    chars = []
    for i in range(n):
        v = 0
        for k in range(6):
            pos = i * 6 + k
            if pos // 8 < len(b) and (b[pos // 8] >> (pos % 8)) & 1:
                v |= 1 << k
        chars.append(TABLE[v])
    return f"{len(b)}." + ''.join(chars)

if __name__ == '__main__':
    raw = open(sys.argv[1], 'rb').read()
    assert raw[:4] == b'VC2!', raw[:4]
    n = struct.unpack('<I', raw[4:8])[0]
    xml = raw[8:8 + n].decode('utf-8')
    print('outer len field', n, 'total', len(raw), 'tail bytes', raw[8 + n:].hex())
    for tag in ('IComponent', 'IEditController'):
        m = re.search(f'<{tag}>([^<]*)</{tag}>', xml)
        if not m:
            print(tag, ': absent')
            continue
        inner = juce_b64_decode(m.group(1))
        assert juce_b64_encode(inner) == m.group(1), 'roundtrip mismatch'
        print(tag, ':', len(inner), 'bytes, juce-b64 roundtrip OK')
        print('  head hex:', inner[:16].hex())
        if inner[:4] == b'VC2!':
            n2 = struct.unpack('<I', inner[4:8])[0]
            print('  inner VC2! len', n2, 'total', len(inner))
            print('  ', inner[8:8 + n2].decode('utf-8', 'replace'))
            print('  after xml:', inner[8 + n2:].hex())
        else:
            print('  ', inner[:400])
        if len(sys.argv) > 2:
            open(f'{sys.argv[2]}.{tag}.bin', 'wb').write(inner)

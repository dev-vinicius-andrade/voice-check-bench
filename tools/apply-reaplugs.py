"""Apply Voice Check Bench suggested settings to Elgato Wave Link's ReaPlugs.

Usage:
  python apply-reaplugs.py --show                      # print current ReaGate / ReaEQ / ReaComp values
  python apply-reaplugs.py reaplugs-settings.json      # preview the change (nothing is written)
  python apply-reaplugs.py reaplugs-settings.json --write
  python apply-reaplugs.py --self-test                 # check decode -> encode is byte-identical
Options:
  --settings PATH   Settings.json to use (default: the real Wave Link file)
  --input TEXT      pick the input whose key contains TEXT (default: the one with PCM_IN)

Close Wave Link completely (tray icon -> Quit) before --write, otherwise it
overwrites Settings.json on exit. --write refuses to touch the real Wave Link
file while Elgato.WaveLink.exe is running (copies passed with --settings are
not checked). A timestamped backup is saved next to the file before anything
is changed, the round-trip self-test must pass first, and the file is written
back with its original line endings, indentation, BOM and string escaping.

Wave Link stores each plugin's state as a base64 VST preset (FXP, magic CcnK) in
MixerConfiguration.InputSettings[<input>].AudioPluginConfigurations[].ParameterState:
  ReaGate / ReaComp: an FxBk bank (156-byte header) holding one FxCk program
         (56-byte header) of 19 big-endian normalized floats.
  ReaEQ: an FBCh chunk: 156-byte header, big-endian int32 chunk size at offset 156,
         then little-endian: int32 version, int32 band count, per band
         int32 type, int32 enabled, f64 freq Hz, f64 gain (linear), f64 bandwidth oct,
         u8 flag, then a tail kept as is. The FXP byteSize field (offset 4) is 0 in
         Wave Link's blobs and is only updated when it is non-zero.
The hardware Lowcut of the Wave XLR is not stored here; set it in Wave Link by hand.

Python 3 standard library only.
"""
import argparse
import base64
import datetime
import json
import math
import numbers
import os
import shutil
import struct
import subprocess
import sys

SETTINGS = os.path.expandvars(r"%LOCALAPPDATA%\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json")
EQ_TYPES = {"Low Shelf": 0, "High Shelf": 1, "Band": 8}
EQ_NAMES = {v: k for k, v in EQ_TYPES.items()}
COCKOS = ("ReaGate", "ReaEQ", "ReaComp")
TAGS = COCKOS + ("Elgato De-Esser",)

db2a = lambda d: 10 ** (d / 20)
a2db = lambda a: 20 * math.log10(a) if a > 0 else float("-inf")

# normalized-parameter maps (index: (name, to_value, from_value)), verified against values set in the plugin UI
GATE = {
    0: ("Threshold dB", a2db, db2a),
    1: ("Attack ms", lambda v: v * 500, lambda v: v / 500),
    2: ("Release ms", lambda v: v * 5000, lambda v: v / 5000),
    4: ("Hold ms", lambda v: v * 1000, lambda v: v / 1000),
    9: ("Dry dB", a2db, db2a),
    10: ("Wet dB", a2db, db2a),
    12: ("Hysteresis dB", a2db, db2a),
}
COMP = {
    0: ("Threshold dB", a2db, db2a),
    1: ("Ratio :1", lambda v: v * 99 + 1, lambda v: (v - 1) / 99),
    2: ("Attack ms", lambda v: v * 500, lambda v: v / 500),
    3: ("Release ms", lambda v: v * 5000, lambda v: v / 5000),
    11: ("Wet dB", a2db, db2a),
    17: ("Limit output", lambda v: v >= 0.5, lambda v: 1.0 if v else 0.0),
}
GATE_KEYS = ((0, "threshold"), (1, "attack"), (2, "release"), (4, "hold"), (9, "dry"), (10, "wet"), (12, "hysteresis"))
COMP_KEYS = ((0, "threshold"), (1, "ratio"), (2, "attack"), (3, "release"), (11, "wet"), (17, "limit"))


# ---------------------------------------------------------------- FXP codecs

def read_bank(blob):
    """FxBk -> (prefix bytes up to the param floats, list of floats, bytes after the floats)."""
    inner = blob[156:]
    num = struct.unpack(">i", inner[24:28])[0]
    end = 156 + 56 + 4 * num
    vals = list(struct.unpack(">%df" % num, blob[156 + 56:end]))
    return blob[:156 + 56], vals, blob[end:]


def write_bank(prefix, vals, suffix=b""):
    return prefix + struct.pack(">%df" % len(vals), *vals) + suffix


def read_eq(blob):
    """FBCh -> (156-byte header, version, bands, tail)."""
    size = struct.unpack(">i", blob[156:160])[0]
    ch = blob[160:160 + size]
    ver, n = struct.unpack("<ii", ch[:8])
    bands, o = [], 8
    for _ in range(n):
        t, en, f, g, bw, flag = struct.unpack("<iidddB", ch[o:o + 33])
        bands.append({"type": t, "enabled": en, "freq": f, "gain": g, "bw": bw, "flag": flag})
        o += 33
    return blob[:156], ver, bands, ch[o:]


def write_eq(header, ver, bands, tail):
    ch = struct.pack("<ii", ver, len(bands))
    for b in bands:
        ch += struct.pack("<iidddB", b["type"], b["enabled"], b["freq"], b["gain"], b["bw"], b["flag"])
    ch += tail
    blob = header + struct.pack(">i", len(ch)) + ch  # chunk size (big-endian, offset 156)
    # FXP byteSize (offset 4) = total length - 8; Wave Link leaves it 0, so keep 0 when it was 0.
    if struct.unpack(">i", header[4:8])[0]:
        blob = blob[:4] + struct.pack(">i", len(blob) - 8) + blob[8:]
    return blob


# ---------------------------------------------------------------- Settings.json text

def detect_format(raw):
    """Line ending, indent and escaping style of the original Settings.json text."""
    nl = "\r\n" if "\r\n" in raw else "\n"
    indent = None
    first = raw.find("\n")
    if first != -1:
        line = raw[first + 1:].split("\n", 1)[0]
        ws = line[:len(line) - len(line.lstrip(" \t"))]
        indent = ws if ws else None
    dotnet = "\\u0022" in raw or "\\u002B" in raw  # System.Text.Json default escaping
    return {"nl": nl, "indent": indent, "dotnet": dotnet, "trailing_nl": raw.endswith("\n")}


_SHORT = {'"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f"}
_DOTNET_ESCAPED = set("\"'+<>&`")


def _dotnet_str(s):
    """Encode a string the way .NET System.Text.Json does by default (\\u0022, \\u002B, non-ASCII as \\uXXXX)."""
    out = ['"']
    for c in s:
        o = ord(c)
        if c in _DOTNET_ESCAPED:
            out.append("\\u%04X" % o)
        elif c in _SHORT:
            out.append(_SHORT[c])
        elif o < 0x20 or o >= 0x7F:
            if o > 0xFFFF:
                o -= 0x10000
                out.append("\\u%04X\\u%04X" % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
            else:
                out.append("\\u%04X" % o)
        else:
            out.append(c)
    out.append('"')
    return "".join(out)


def dump_settings(cfg, fmt):
    if not fmt["dotnet"]:
        text = json.dumps(cfg, indent=fmt["indent"], ensure_ascii=False)
        text = text.replace("\n", fmt["nl"])
    else:
        nl, ind = fmt["nl"], fmt["indent"]

        def rec(o, level):
            if isinstance(o, str):
                return _dotnet_str(o)
            if isinstance(o, dict) or isinstance(o, list):
                items = list(o.items()) if isinstance(o, dict) else list(o)
                op, cl = ("{", "}") if isinstance(o, dict) else ("[", "]")
                if not items:
                    return op + cl
                sep = ":" if ind is None else ": "
                parts = [_dotnet_str(k) + sep + rec(v, level + 1) for k, v in items] if isinstance(o, dict) \
                    else [rec(v, level + 1) for v in items]
                if ind is None:
                    return op + ",".join(parts) + cl
                pad = ind * (level + 1)
                return op + nl + ("," + nl).join(pad + p for p in parts) + nl + ind * level + cl
            return json.dumps(o)

        text = rec(cfg, 0)
    return text + (fmt["nl"] if fmt["trailing_nl"] else "")


# ---------------------------------------------------------------- plugins

def find_plugins(cfg):
    found = {}
    for key, inp in cfg["MixerConfiguration"]["InputSettings"].items():
        for p in inp.get("AudioPluginConfigurations", []):
            for tag in TAGS:
                if p["Name"].startswith(tag):
                    found.setdefault(key, {})[tag] = p
    return {k: v for k, v in found.items() if any(t in v for t in COCKOS)}


def pick_input(found, wanted):
    if wanted:
        hits = [k for k in found if wanted.lower() in k.lower()]
        if len(hits) != 1:
            what = "No" if not hits else "More than one"
            sys.exit(f"{what} input with ReaPlugs matches --input {wanted!r}. Inputs with ReaPlugs:\n  " + "\n  ".join(found))
        return hits[0]
    pcm = [k for k in found if "PCM_IN" in k]
    return pcm[0] if pcm else next(iter(found))


def describe(plugs):
    out = []
    if "ReaGate" in plugs:
        _, v, _ = read_bank(base64.b64decode(plugs["ReaGate"]["ParameterState"]))
        out.append("ReaGate: " + ", ".join(f"{n} {f(v[i]):.1f}" for i, (n, f, _) in GATE.items()))
    if "ReaEQ" in plugs:
        _, _, bands, _ = read_eq(base64.b64decode(plugs["ReaEQ"]["ParameterState"]))
        for i, b in enumerate(bands, 1):
            out.append(f"ReaEQ band {i}: {EQ_NAMES.get(b['type'], b['type'])} {b['freq']:.0f} Hz {a2db(b['gain']):+.1f} dB bw {b['bw']:.2f}" + ("" if b["enabled"] else " (off)"))
    if "ReaComp" in plugs:
        _, v, _ = read_bank(base64.b64decode(plugs["ReaComp"]["ParameterState"]))
        out.append("ReaComp: " + ", ".join(f"{n} {f(v[i]):.1f}" if not isinstance(f(v[i]), bool) else f"{n} {'on' if f(v[i]) else 'off'}" for i, (n, f, _) in COMP.items()))
    if "Elgato De-Esser" in plugs:
        out.append("Elgato De-Esser: " + ("off" if plugs["Elgato De-Esser"]["BypassState"] else "on"))
    return "\n".join(out)


def roundtrip(tag, state):
    """Decode and re-encode a Cockos plugin state with unchanged values via the apply code paths."""
    blob = base64.b64decode(state)
    if tag == "ReaEQ":
        header, ver, bands, tail = read_eq(blob)
        new = write_eq(header, ver, [dict(b) for b in bands], tail)
    else:
        prefix, vals, suffix = read_bank(blob)
        new = write_bank(prefix, list(vals), suffix)
    return base64.b64encode(new).decode()


def self_test(cfg, plugs, raw, fmt, verbose=True):
    ok = True
    for tag in COCKOS:
        if tag not in plugs:
            continue
        state = plugs[tag]["ParameterState"]
        try:
            same = roundtrip(tag, state) == state
            why = "" if same else " (re-encoded base64 differs)"
        except Exception as e:  # malformed blob
            same, why = False, f" ({type(e).__name__}: {e})"
        ok &= same
        if verbose:
            print(f"{'PASS' if same else 'FAIL'}  {tag} round-trip byte-identical{why}")
    text = dump_settings(cfg, fmt)
    same = json.loads(text) == cfg
    ok &= same
    if verbose:
        print(f"{'PASS' if same else 'FAIL'}  Settings.json re-parses to the same object")
        ident = "identical to" if text == raw else "differs in formatting from"
        print(f"info  re-serialized text is {ident} the original ({'CRLF' if fmt['nl'] == chr(13) + chr(10) else 'LF'}, "
              f"indent {len(fmt['indent']) if fmt['indent'] else 0}, {'.NET' if fmt['dotnet'] else 'plain'} escaping)")
    return ok


# ---------------------------------------------------------------- suggestion JSON

def validate(s):
    """Return a list of problems with the suggestion JSON (empty when it is fine)."""
    errs = []
    if not isinstance(s, dict):
        return ["the file must contain a JSON object"]

    def num(where, v, lo, hi):
        if isinstance(v, bool) or not isinstance(v, numbers.Real) or not math.isfinite(v):
            errs.append(f"{where} must be a number, got {v!r}")
        elif not lo <= v <= hi:
            errs.append(f"{where} = {v} is outside {lo}..{hi}")

    def section(name, spec):
        sec = s[name]
        if not isinstance(sec, dict):
            errs.append(f"'{name}' must be an object")
            return
        for key, lo, hi in spec:
            if key not in sec:
                errs.append(f"'{name}.{key}' is missing")
            elif lo is None:
                if not isinstance(sec[key], bool):
                    errs.append(f"'{name}.{key}' must be true or false, got {sec[key]!r}")
            else:
                num(f"'{name}.{key}'", sec[key], lo, hi)

    if not any(k in s for k in ("gate", "eq", "comp", "deess")):
        errs.append("none of 'gate', 'eq', 'comp', 'deess' is present; is this a Voice Check Bench settings export?")
    if "gate" in s:
        section("gate", (("threshold", -100, 0), ("attack", 0, 500), ("release", 0, 5000), ("hold", 0, 1000),
                         ("hysteresis", -100, 0), ("wet", -100, 24), ("dry", -100, 24)))
    if "comp" in s:
        section("comp", (("threshold", -100, 0), ("ratio", 1, 100), ("attack", 0, 500), ("release", 0, 5000),
                         ("wet", -100, 24), ("limit", None, None)))
    if "eq" in s:
        if not isinstance(s["eq"], list):
            errs.append("'eq' must be a list of bands")
        else:
            for i, e in enumerate(s["eq"], 1):
                if not isinstance(e, dict):
                    errs.append(f"'eq' band {i} must be an object")
                    continue
                for key in ("type", "freq", "gain", "bw"):
                    if key not in e:
                        errs.append(f"'eq' band {i}: '{key}' is missing")
                if "type" in e and e["type"] not in EQ_TYPES:
                    errs.append(f"'eq' band {i}: type {e['type']!r} must be one of 'Low Shelf', 'Band', 'High Shelf'")
                if "freq" in e:
                    num(f"'eq' band {i} freq", e["freq"], 20, 20000)
                if "gain" in e:
                    num(f"'eq' band {i} gain", e["gain"], -40, 40)
                if "bw" in e:
                    num(f"'eq' band {i} bw", e["bw"], 0.05, 8)
    if "deess" in s and not isinstance(s["deess"], bool):
        errs.append(f"'deess' must be true or false, got {s['deess']!r}")
    if s.get("lowcut") is not None:
        num("'lowcut'", s["lowcut"], 0, 1000)
    return errs


def apply(plugs, s):
    if "ReaGate" in plugs and "gate" in s:
        g = s["gate"]
        prefix, v, suffix = read_bank(base64.b64decode(plugs["ReaGate"]["ParameterState"]))
        for i, key in GATE_KEYS:
            v[i] = GATE[i][2](g[key])
        plugs["ReaGate"]["ParameterState"] = base64.b64encode(write_bank(prefix, v, suffix)).decode()
    if "ReaEQ" in plugs and "eq" in s:
        header, ver, old, tail = read_eq(base64.b64decode(plugs["ReaEQ"]["ParameterState"]))
        flag = old[0]["flag"] if old else 1
        bands = [{"type": EQ_TYPES[e["type"]], "enabled": 1, "freq": float(e["freq"]), "gain": db2a(e["gain"]), "bw": float(e["bw"]), "flag": flag} for e in s["eq"]]
        if not bands:  # keep one flat band so the plugin has a valid state
            bands = [{"type": 8, "enabled": 1, "freq": 1000.0, "gain": 1.0, "bw": 1.0, "flag": flag}]
        plugs["ReaEQ"]["ParameterState"] = base64.b64encode(write_eq(header, ver, bands, tail)).decode()
    if "ReaComp" in plugs and "comp" in s:
        c = s["comp"]
        prefix, v, suffix = read_bank(base64.b64decode(plugs["ReaComp"]["ParameterState"]))
        for i, key in COMP_KEYS:
            v[i] = COMP[i][2](c[key])
        plugs["ReaComp"]["ParameterState"] = base64.b64encode(write_bank(prefix, v, suffix)).decode()
    if "Elgato De-Esser" in plugs and "deess" in s:
        plugs["Elgato De-Esser"]["BypassState"] = not s["deess"]


# ---------------------------------------------------------------- main

def wavelink_running():
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True).stdout.lower()
        return "elgato.wavelink.exe" in out
    except Exception:
        return False


def same_path(a, b):
    return os.path.normcase(os.path.realpath(os.path.abspath(a))) == os.path.normcase(os.path.realpath(os.path.abspath(b)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("suggestion", nargs="?", help="reaplugs-settings.json exported from Voice Check Bench")
    ap.add_argument("--write", action="store_true", help="write the change (Wave Link must be closed)")
    ap.add_argument("--show", action="store_true", help="print the current values and exit")
    ap.add_argument("--self-test", action="store_true", help="check that decode -> encode is byte-identical and exit")
    ap.add_argument("--settings", default=SETTINGS, help="path to Wave Link Settings.json")
    ap.add_argument("--input", help="choose the input whose key contains this text (default: the one with PCM_IN)")
    args = ap.parse_args()

    if not os.path.isfile(args.settings):
        sys.exit(f"Settings file not found: {args.settings}")
    with open(args.settings, "rb") as f:
        data = f.read()
    bom = data.startswith(b"\xef\xbb\xbf")
    raw = data.decode("utf-8-sig")
    cfg = json.loads(raw)
    fmt = detect_format(raw)
    found = find_plugins(cfg)
    if not found:
        sys.exit("No ReaPlugs found on any Wave Link input.")
    key = pick_input(found, args.input)
    plugs = found[key]
    print(f"Input: {key}")
    if len(found) > 1:
        print("Other inputs with ReaPlugs (use --input): " + ", ".join(k for k in found if k != key))

    if args.self_test:
        print()
        sys.exit(0 if self_test(cfg, plugs, raw, fmt) else 1)

    print(f"\nCurrent:\n{describe(plugs)}")
    if args.show or not args.suggestion:
        return

    try:
        with open(args.suggestion, encoding="utf-8-sig") as f:
            s = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit(f"\nCannot read {args.suggestion}: {e}")
    errs = validate(s)
    if errs:
        sys.exit(f"\n{os.path.basename(args.suggestion)} is not a valid settings export:\n  - " + "\n  - ".join(errs))
    if not self_test(cfg, plugs, raw, fmt, verbose=False):
        sys.exit("\nRound-trip self-test failed on this Settings.json; refusing to change it. Run with --self-test for details.")

    apply(plugs, s)
    print(f"\nNew (from {os.path.basename(args.suggestion)}):\n{describe(plugs)}")
    if s.get("lowcut"):
        print(f"\nSet the Wave XLR Lowcut to {s['lowcut']} Hz in Wave Link by hand (hardware setting).")

    if not args.write:
        print("\nPreview only. Close Wave Link (tray icon -> Quit) and run again with --write to apply.")
        return
    if same_path(args.settings, SETTINGS) and wavelink_running():
        sys.exit("\nWave Link is still running. Quit it from the tray icon first, then run again with --write.")
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    root, ext = os.path.splitext(args.settings)
    backup = f"{root}.before-voicecheck-{stamp}{ext or '.json'}"
    shutil.copy2(args.settings, backup)
    out = (b"\xef\xbb\xbf" if bom else b"") + dump_settings(cfg, fmt).encode("utf-8")
    tmp = args.settings + ".tmp"
    with open(tmp, "wb") as f:
        f.write(out)
    os.replace(tmp, args.settings)
    print(f"\nWritten. Backup: {backup}\nOpen Wave Link and check the plugin windows. To undo, copy the backup over Settings.json with Wave Link closed.")


if __name__ == "__main__":
    main()

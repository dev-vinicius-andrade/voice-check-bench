"""Apply Voice Check Bench suggested settings to Elgato Wave Link's ReaPlugs.

Usage:
  python apply-reaplugs.py --show                      # print current ReaGate / ReaEQ / ReaComp values
  python apply-reaplugs.py reaplugs-settings.json      # preview the change (nothing is written)
  python apply-reaplugs.py reaplugs-settings.json --write

Close Wave Link completely (tray icon -> Quit) before --write, otherwise it
overwrites Settings.json on exit. A timestamped backup is saved next to the
file before anything is changed.

Wave Link stores each plugin's state as a base64 VST preset (FXP) in
MixerConfiguration.InputSettings[<input>].AudioPluginConfigurations[].ParameterState:
  ReaGate / ReaComp: an FxBk bank holding one FxCk program of 19 normalized floats.
  ReaEQ: an FBCh chunk: int32 version, int32 band count, then per band
         int32 type, int32 enabled, f64 freq Hz, f64 gain (linear), f64 bandwidth oct, u8 flag.
"""
import argparse
import base64
import datetime
import json
import math
import os
import shutil
import struct
import subprocess
import sys

SETTINGS = os.path.expandvars(r"%LOCALAPPDATA%\Packages\Elgato.WaveLink_g54w8ztgkx496\LocalState\Settings.json")
EQ_TYPES = {"Low Shelf": 0, "High Shelf": 1, "Band": 8}
EQ_NAMES = {v: k for k, v in EQ_TYPES.items()}

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


def read_bank(blob):
    """FxBk -> (prefix bytes up to the param floats, list of floats)."""
    inner = blob[156:]
    num = struct.unpack(">i", inner[24:28])[0]
    vals = list(struct.unpack(">%df" % num, inner[56:56 + 4 * num]))
    return blob[:156 + 56], vals


def write_bank(prefix, vals):
    return prefix + struct.pack(">%df" % len(vals), *vals)


def read_eq(blob):
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
    blob = header + struct.pack(">i", len(ch)) + ch
    # FXP header byteSize field (offset 4) = total length - 8
    return blob[:4] + struct.pack(">i", len(blob) - 8) + blob[8:] if struct.unpack(">i", blob[4:8])[0] else blob


def find_plugins(cfg):
    found = {}
    for key, inp in cfg["MixerConfiguration"]["InputSettings"].items():
        for p in inp.get("AudioPluginConfigurations", []):
            for tag in ("ReaGate", "ReaEQ", "ReaComp", "Elgato De-Esser"):
                if p["Name"].startswith(tag):
                    found.setdefault(key, {})[tag] = p
    return found


def describe(plugs):
    out = []
    if "ReaGate" in plugs:
        _, v = read_bank(base64.b64decode(plugs["ReaGate"]["ParameterState"]))
        out.append("ReaGate: " + ", ".join(f"{n} {f(v[i]):.1f}" for i, (n, f, _) in GATE.items()))
    if "ReaEQ" in plugs:
        _, _, bands, _ = read_eq(base64.b64decode(plugs["ReaEQ"]["ParameterState"]))
        for i, b in enumerate(bands, 1):
            out.append(f"ReaEQ band {i}: {EQ_NAMES.get(b['type'], b['type'])} {b['freq']:.0f} Hz {a2db(b['gain']):+.1f} dB bw {b['bw']:.2f}" + ("" if b["enabled"] else " (off)"))
    if "ReaComp" in plugs:
        _, v = read_bank(base64.b64decode(plugs["ReaComp"]["ParameterState"]))
        out.append("ReaComp: " + ", ".join(f"{n} {f(v[i]):.1f}" if not isinstance(f(v[i]), bool) else f"{n} {'on' if f(v[i]) else 'off'}" for i, (n, f, _) in COMP.items()))
    if "Elgato De-Esser" in plugs:
        out.append("Elgato De-Esser: " + ("off" if plugs["Elgato De-Esser"]["BypassState"] else "on"))
    return "\n".join(out)


def apply(plugs, s):
    if "ReaGate" in plugs and "gate" in s:
        g = s["gate"]
        prefix, v = read_bank(base64.b64decode(plugs["ReaGate"]["ParameterState"]))
        for i, key in ((0, "threshold"), (1, "attack"), (2, "release"), (4, "hold"), (9, "dry"), (10, "wet"), (12, "hysteresis")):
            v[i] = GATE[i][2](g[key])
        plugs["ReaGate"]["ParameterState"] = base64.b64encode(write_bank(prefix, v)).decode()
    if "ReaEQ" in plugs and "eq" in s:
        header, ver, old, tail = read_eq(base64.b64decode(plugs["ReaEQ"]["ParameterState"]))
        flag = old[0]["flag"] if old else 1
        bands = [{"type": EQ_TYPES[e["type"]], "enabled": 1, "freq": float(e["freq"]), "gain": db2a(e["gain"]), "bw": float(e["bw"]), "flag": flag} for e in s["eq"]]
        if not bands:  # keep one flat band so the plugin has a valid state
            bands = [{"type": 8, "enabled": 1, "freq": 1000.0, "gain": 1.0, "bw": 1.0, "flag": flag}]
        plugs["ReaEQ"]["ParameterState"] = base64.b64encode(write_eq(header, ver, bands, tail)).decode()
    if "ReaComp" in plugs and "comp" in s:
        c = s["comp"]
        prefix, v = read_bank(base64.b64decode(plugs["ReaComp"]["ParameterState"]))
        for i, key in ((0, "threshold"), (1, "ratio"), (2, "attack"), (3, "release"), (11, "wet"), (17, "limit")):
            v[i] = COMP[i][2](c[key])
        plugs["ReaComp"]["ParameterState"] = base64.b64encode(write_bank(prefix, v)).decode()
    if "Elgato De-Esser" in plugs and "deess" in s:
        plugs["Elgato De-Esser"]["BypassState"] = not s["deess"]


def wavelink_running():
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True).stdout.lower()
        return "elgato.wavelink.exe" in out
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("suggestion", nargs="?", help="reaplugs-settings.json exported from Voice Check Bench")
    ap.add_argument("--write", action="store_true", help="write the change (Wave Link must be closed)")
    ap.add_argument("--show", action="store_true", help="print the current values and exit")
    ap.add_argument("--settings", default=SETTINGS, help="path to Wave Link Settings.json")
    args = ap.parse_args()

    with open(args.settings, encoding="utf-8-sig") as f:
        raw = f.read()
    cfg = json.loads(raw)
    found = find_plugins(cfg)
    if not found:
        sys.exit("No ReaPlugs found on any Wave Link input.")
    key = next(k for k in found if "PCM_IN" in k) if any("PCM_IN" in k for k in found) else next(iter(found))
    plugs = found[key]
    print(f"Input: {key}\n\nCurrent:\n{describe(plugs)}")
    if args.show or not args.suggestion:
        return

    with open(args.suggestion, encoding="utf-8") as f:
        s = json.load(f)
    apply(plugs, s)
    print(f"\nNew (from {os.path.basename(args.suggestion)}):\n{describe(plugs)}")
    if s.get("lowcut"):
        print(f"\nSet the Wave XLR Lowcut to {s['lowcut']} Hz in Wave Link by hand (hardware setting).")

    if not args.write:
        print("\nPreview only. Close Wave Link (tray icon -> Quit) and run again with --write to apply.")
        return
    if wavelink_running():
        sys.exit("\nWave Link is still running. Quit it from the tray icon first, then run again with --write.")
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = args.settings.replace(".json", f".before-voicecheck-{stamp}.json")
    shutil.copy2(args.settings, backup)
    with open(args.settings, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2 if "\n  " in raw[:200] else None, ensure_ascii=False)
    print(f"\nWritten. Backup: {backup}\nOpen Wave Link and check the plugin windows. To undo, copy the backup over Settings.json with Wave Link closed.")


if __name__ == "__main__":
    main()

"""Inspect AudioPluginConfigurations in the Settings.json COPY (never the live file).

Usage: python -I inspect_settings.py <Settings.copy.json> [outdir]
Prints every plugin entry (keys, name, vendor, bypass) and dumps the decoded ParameterState
of Elgato plugins to <outdir>/state_<idx>_<name>.bin.
"""
import base64, json, os, re, sys

path = sys.argv[1]
outdir = sys.argv[2] if len(sys.argv) > 2 else None
with open(path, 'r', encoding='utf-8-sig') as f:
    data = json.load(f)

found = []
def walk(node, trail):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == 'AudioPluginConfigurations' and isinstance(v, list):
                found.append(('/'.join(trail), v))
            walk(v, trail + [k])
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, trail + [str(i)])

walk(data, [])
for where, confs in found:
    print('==', where, len(confs), 'plugins')
    for i, c in enumerate(confs):
        keys = list(c.keys())
        name = c.get('Name') or c.get('PluginName')
        print(f'  [{i}] keys={keys}')
        for k, v in c.items():
            if k == 'ParameterState':
                continue
            s = json.dumps(v)
            print(f'      {k} = {s[:200]}')
        ps = c.get('ParameterState')
        if isinstance(ps, str):
            raw = base64.b64decode(ps)
            print(f'      ParameterState: {len(ps)} b64 chars -> {len(raw)} bytes; head={raw[:48].hex()}')
            print(f'      ascii head: {raw[:120]!r}')
            if outdir and ('Elgato' in json.dumps(c)):
                os.makedirs(outdir, exist_ok=True)
                safe = re.sub(r'[^A-Za-z0-9]+', '_', str(name))
                tag = re.sub(r'[^A-Za-z0-9]+', '_', where)[-40:]
                fn = os.path.join(outdir, f'state_{tag}_{i}_{safe}.bin')
                with open(fn, 'wb') as f:
                    f.write(raw)
                print('      ->', fn)

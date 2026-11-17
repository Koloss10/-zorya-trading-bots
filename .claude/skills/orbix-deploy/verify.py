#!/usr/bin/env python3
"""Побайтна звірка розгорнутої Edge Function з локальними файлами.

Використання: python3 verify.py <збережена відповідь get_edge_function> <runner|exchange|tg-notify>
Код виходу 0 — усі файли збігаються і жодного не бракує.
"""
import json
import pathlib
import sys

if len(sys.argv) != 3:
    sys.exit(__doc__)
saved, fn = sys.argv[1], sys.argv[2]
root = pathlib.Path(__file__).resolve().parents[3] / "supabase" / "functions" / fn

j = json.loads(pathlib.Path(saved).read_text())
if isinstance(j, list):
    j = j[0]
if "text" in j:
    j = json.loads(j["text"])

remote = {f["name"].split("/")[-1]: f["content"] for f in j["files"]}
local = {p.name: p.read_text() for p in root.iterdir() if p.is_file()}
print(f"{fn}: версія {j.get('version')}, verify_jwt {j.get('verify_jwt')}")
ok = True
for name in sorted(set(remote) | set(local)):
    if name not in remote:
        print(f"  {name}: НЕМАЄ на сервері"); ok = False
    elif name not in local:
        print(f"  {name}: є лише на сервері"); ok = False
    else:
        same = remote[name] == local[name]
        print(f"  {name}: {same}"); ok &= same
sys.exit(0 if ok else 1)

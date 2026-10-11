# -*- coding: utf-8 -*-
"""把插件目录打包成 .xpi（Zotero 插件就是改了后缀的 zip）。
用法 / Usage:  python build.py
"""
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(HERE, "manifest.json"), encoding="utf-8"))
addon_id = manifest["applications"]["zotero"]["id"]
out = os.path.join(HERE, "dist", "%s-%s.xpi" % (addon_id.split("@")[0], manifest["version"]))
os.makedirs(os.path.dirname(out), exist_ok=True)

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(HERE):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, HERE).replace("\\", "/")
            if rel.startswith("dist/") or rel in ("build.py", ".gitignore"):
                continue
            z.write(full, rel)

print("built:", out, os.path.getsize(out), "bytes")

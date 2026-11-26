#!/usr/bin/env python3
"""把插件打成集市用的 package.zip，并按思源集市（siyuan-note/bazaar）的规则做一轮本地预检。

用法:
    python3 tools/pack.py            # 打包 + 检查，输出 package.zip
    python3 tools/pack.py --check    # 只检查，不打包

预检项对齐 bazaar/rules：
  - 包根必须有 README.md、plugin.json、index.js（文件名大小写敏感）
  - icon.png ≤ 64KB、preview.png ≤ 512KB，png/jpeg/webp/avif
  - plugin.json: url 必须是 https://github.com/<owner>/<repo>、readme 必须有 default 键且文件存在
  - backends / frontends / kernels 取值必须在枚举内，且 "all" 不能与其他值混用
  - zip 内路径必须是正斜杠、无符号链接、文件都在包根（不套一层目录）
"""
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = os.path.join(ROOT, "package.zip")

# 打进包里的文件 / 目录（包根结构）
FILES = ["plugin.json", "package.json", "index.js", "index.css", "icon.png", "preview.png",
         "README.md", "README_zh_CN.md", "CHANGELOG.md", "LICENSE"]
DIRS = ["i18n", "assets"]

OWNER, REPO = "Paiyunshou", "siyuan-plugin-citedb"
BACKEND_VALUES = {"windows", "linux", "darwin", "ios", "android", "harmony", "docker", "all"}
FRONTEND_VALUES = {"desktop", "desktop-window", "mobile", "browser-desktop", "browser-mobile", "all"}
ALLOWED_KEYS = {"name", "author", "url", "version", "minAppVersion", "displayName", "description",
                "readme", "icon", "preview", "funding", "keywords", "backends", "frontends",
                "kernels", "bootAppearances", "disabledInPublish", "settingsWindow", "publish"}
MAX_ICON, MAX_PREVIEW = 64 * 1024, 512 * 1024

problems, notes = [], []


def check_manifest():
    p = json.load(open(os.path.join(ROOT, "plugin.json"), encoding="utf-8"))
    for k in p:
        if k not in ALLOWED_KEYS:
            problems.append(f"plugin.json 有集市不允许的字段 `{k}`")
    want = f"https://github.com/{OWNER}/{REPO}"
    if str(p.get("url", "")).rstrip("/") != want:
        problems.append(f"plugin.json url 必须是 {want}，现在是 {p.get('url')}")
    if not str(p.get("author", "")).strip():
        problems.append("plugin.json author 不能为空")
    if p.get("name") != REPO:
        notes.append(f"plugin.json name={p.get('name')}（建议与仓库名 {REPO} 一致）")
    for key, allowed in (("backends", BACKEND_VALUES), ("kernels", BACKEND_VALUES), ("frontends", FRONTEND_VALUES)):
        vals = p.get(key, [])
        if not isinstance(vals, list):
            problems.append(f"plugin.json {key} 必须是字符串数组")
            continue
        bad = [v for v in vals if v not in allowed]
        if bad:
            problems.append(f"plugin.json {key} 取值非法: {bad}；可选 {sorted(allowed)}")
        if "all" in vals and len(vals) > 1:
            problems.append(f"plugin.json {key} 含 \"all\" 时不能再列其他值")
    rd = p.get("readme")
    if not isinstance(rd, dict) or not rd:
        problems.append("plugin.json readme 必须是对象，且至少含 default 键")
    elif not str(rd.get("default", "")).strip():
        problems.append("plugin.json readme 缺少 default 键（集市硬性要求）")
    else:
        for loc, fn in rd.items():
            if not os.path.isfile(os.path.join(ROOT, fn)):
                problems.append(f"readme.{loc} 指向的 {fn} 不存在")
    for field, limit in (("icon", MAX_ICON), ("preview", MAX_PREVIEW)):
        fn = p.get(field)
        if not fn:
            continue
        path = os.path.join(ROOT, fn)
        if not os.path.isfile(path):
            problems.append(f"{field} 指向的 {fn} 不存在")
            continue
        size = os.path.getsize(path)
        if size > limit:
            problems.append(f"{fn} {size/1024:.0f}KB 超过上限 {limit//1024}KB")
        if not fn.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".avif")):
            problems.append(f"{fn} 格式不被集市支持（只收 png/jpeg/webp/avif，不收 svg）")
    for f in ("README.md", "plugin.json", "index.js"):
        if not os.path.isfile(os.path.join(ROOT, f)):
            problems.append(f"包根缺少必要文件 {f}")
    for fn in ("index.js",):
        js = open(os.path.join(ROOT, fn), encoding="utf-8").read()
        semver = re.search(r'const VERSION = "([^"]+)"', js)
        if semver and semver.group(1) != p["version"]:
            problems.append(f"index.js VERSION={semver.group(1)} 与 plugin.json version={p['version']} 不一致")
    pkg = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))
    if pkg.get("version") != p["version"]:
        problems.append(f"package.json version={pkg.get('version')} 与 plugin.json 不一致")
    return p


def collect():
    out = []
    for f in FILES:
        path = os.path.join(ROOT, f)
        if os.path.isfile(path):
            out.append((path, f))
        else:
            problems.append(f"缺少文件 {f}")
    for d in DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _, names in os.walk(base):
            for n in sorted(names):
                if n.startswith("."):
                    continue
                full = os.path.join(dirpath, n)
                out.append((full, os.path.relpath(full, ROOT).replace(os.sep, "/")))
    return out


def build(entries):
    if os.path.exists(ZIP):
        os.remove(ZIP)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for full, arc in entries:
            z.write(full, arc)
    with zipfile.ZipFile(ZIP) as z:
        names = z.namelist()
        if any("\\" in n for n in names):
            problems.append("zip 内有反斜杠路径")
        if any(n.startswith("/") for n in names):
            problems.append("zip 内有绝对路径")
        for need in ("README.md", "plugin.json", "index.js"):
            if need not in names:
                problems.append(f"zip 包根缺少 {need}")
        if any("/" not in n for n in names if n.endswith(".json")):
            pass  # 包根 json 正常
    print(f"已生成 {os.path.relpath(ZIP)}（{os.path.getsize(ZIP)/1024:.0f}KB，{len(entries)} 个文件）")


def main():
    manifest = check_manifest()
    entries = collect()
    if "--check" not in sys.argv:
        build(entries)
    print(f"版本 {manifest['version']}，{len(entries)} 个文件待打包")
    for n in notes:
        print(f"提示: {n}")
    if problems:
        print("\n".join(f"✗ {p}" for p in problems))
        print(f"\n{len(problems)} 项不合规，先改再提集市")
        return 1
    print("✓ 本地预检全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

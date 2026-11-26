#!/usr/bin/env python3
"""把本仓库的插件文件部署到思源工作空间 data/plugins/ 下（走思源 HTTP API，无需文件系统权限）。

用法: python3 tools/deploy.py            # 全量部署
      python3 tools/deploy.py index.js   # 只部署指定文件
凭据来自 /opt/data/.env 的 SIYUAN_URL / SIYUAN_TOKEN。
"""
import json, os, sys, uuid, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = "siyuan-plugin-citedb"
TARGET = f"data/plugins/{PLUGIN}"
FILES = ["plugin.json", "package.json", "index.js", "index.css", "icon.png",
         "preview.png", "README.md", "README_zh_CN.md", "CHANGELOG.md", "LICENSE",
         "i18n/zh_CN.json", "i18n/en_US.json",
         "assets/panel.png", "assets/settings.png", "assets/slash.png", "assets/search.png"]


def env():
    d = {}
    for line in open("/opt/data/.env"):
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    return d["SIYUAN_URL"].rstrip("/"), d["SIYUAN_TOKEN"]


URL, TOKEN = env()


def post(path, body):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Token " + TOKEN})
    return json.loads(urllib.request.urlopen(req, timeout=120).read())


def put(relpath, content, isdir=False):
    b = "----hermes" + uuid.uuid4().hex
    parts = []

    def fld(n, v):
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{n}"\r\n\r\n{v}\r\n'.encode())

    fld("path", relpath)
    fld("isDir", "true" if isdir else "false")
    fld("modTime", "")
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; '
                 f'filename="{os.path.basename(relpath)}"\r\n'
                 f'Content-Type: application/octet-stream\r\n\r\n'.encode() + content + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    req = urllib.request.Request(URL + "/api/file/putFile", data=b"".join(parts),
                                 headers={"Content-Type": "multipart/form-data; boundary=" + b,
                                          "Authorization": "Token " + TOKEN})
    return urllib.request.urlopen(req, timeout=120).read().decode()


def main():
    only = sys.argv[1:]
    files = [f for f in FILES if not only or f in only]
    put(TARGET + "/", b"", isdir=True)
    if any("/" in f for f in files):
        for d in sorted({os.path.dirname(f) for f in files if "/" in f}):
            put(f"{TARGET}/{d}/", b"", isdir=True)
    for f in files:
        src = os.path.join(ROOT, f)
        if not os.path.exists(src):
            print("skip (missing)", f)
            continue
        print("put", f, put(f"{TARGET}/{f}", open(src, "rb").read()))
    got = post("/api/file/readDir", {"path": "/" + TARGET})
    print("部署结果:", sorted(x["name"] for x in (got.get("data") or [])))


if __name__ == "__main__":
    main()

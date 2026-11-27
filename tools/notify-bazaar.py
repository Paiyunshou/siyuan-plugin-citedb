#!/usr/bin/env python3
"""Watch siyuan-note/bazaar PR and send one Feishu message when it is merged.

Usage:
  python3 tools/notify-bazaar.py            # check + notify if merged (cron entry point)
  python3 tools/notify-bazaar.py --status   # print state, never notify/test-send
  python3 tools/notify-bazaar.py --test     # send a test message to verify wiring

Idempotent: after the merge message is sent a state file is written, so later runs
stay silent. Exit code 0 = nothing to do, 10 = message just sent, 1 = error.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

PR = "siyuan-note/bazaar#2596"
PR_API = "https://api.github.com/repos/siyuan-note/bazaar/pulls/2596"
STATE = Path("/opt/data/cache/bazaar-pr-2596.json")
ENV = Path("/opt/data/.env")
PYLIBS = "/opt/data/pylibs"


def env(name, default=""):
    """Read a key from the process env, falling back to /opt/data/.env."""
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in ENV.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return default


def gh_get(url):
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + env("GITHUB_TOKEN"),
        "Accept": "application/vnd.github+json",
        "User-Agent": "hermes-bazaar-watch",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def feishu_send(text):
    if PYLIBS not in sys.path:
        sys.path.insert(0, PYLIBS)
    import lark_oapi as lark

    chat = env("FEISHU_HOME_CHANNEL")
    domain = env("FEISHU_DOMAIN")
    if not domain.startswith("http"):
        domain = "https://open.feishu.cn"
    cli = lark.Client.builder().app_id(env("FEISHU_APP_ID")) \
        .app_secret(env("FEISHU_APP_SECRET")).domain(domain).build()
    req = lark.api.im.v1.CreateMessageRequest.builder() \
        .receive_id_type("chat_id").request_body(
            lark.api.im.v1.CreateMessageRequestBody.builder()
            .receive_id(chat).msg_type("text")
            .content(json.dumps({"text": text}, ensure_ascii=False)).build()).build()
    resp = cli.im.v1.message.create(req)
    ok = resp.success()
    print("feishu:", "sent" if ok else f"FAILED {resp.code} {resp.msg}")
    return ok


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "--test":
        return 0 if feishu_send(f"[测试] {PR} 监控已就绪，合并后我会通知你。") else 1

    try:
        pr = gh_get(PR_API)
    except Exception as e:  # noqa: BLE001 - cron must not crash the scheduler
        if arg == "--cron":
            return 0  # transient network/GitHub error: stay quiet, retry next tick
        raise

    merged = bool(pr.get("merged"))
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    quiet = arg in ("", "--cron")  # default/cron entry point: no stdout unless there is something to say
    if not quiet:
        print(f"{PR} state={pr['state']} merged={merged} labels={[l['name'] for l in pr['labels']]}")
    if arg == "--status" or not merged or state.get("notified"):
        return 0

    body = (
        f"【集市通过】{PR} 已合并\n"
        f"引注 CiteDB 1.0.0 正式上架思源集市。\n"
        f"约 1–3 小时后集市索引刷新，然后重启一次思源，"
        f"在 集市 → 插件 里搜「引注」即可安装。"
    )
    if not feishu_send(body):
        return 1
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"notified": True, "merged_at": pr.get("merged_at")}, indent=2))
    print("MERGED-NOTIFIED")
    return 10


if __name__ == "__main__":
    sys.exit(main())

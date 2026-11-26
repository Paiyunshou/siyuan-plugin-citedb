/* 联调测试（只读）：拿你真实的数据源走一遍「手动映射对话框」的数据链路
 * —— 列、猜列、第一行样例值、引注预览，验证不会把库读成 0 行、预览不是空的。
 * 用法：node tools/test-live-read.js
 */
const fs = require("fs");
const Module = require("module");
const origLoad = Module._load;
const ENV = {};
fs.readFileSync("/opt/data/.env", "utf8")
  .split("\n")
  .forEach((l) => {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) ENV[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
const BASE = ENV.SIYUAN_URL.replace(/\/$/, "");
const TOKEN = ENV.SIYUAN_TOKEN;
const call = async (p, b) =>
  (
    await fetch(BASE + p, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Token " + TOKEN },
      body: JSON.stringify(b || {}),
    })
  ).json();

class Plugin {
  constructor(o) {
    Object.assign(this, o || {});
  }
  async loadData() {
    return null;
  }
  async saveData() {}
  addTopBar() {}
  addCommand() {}
}
Module._load = function (r) {
  if (r === "siyuan")
    return {
      Plugin,
      Dialog: class {},
      Setting: class { constructor() { this.items = []; } addItem(i) { this.items.push(i); } },
      showMessage() {},
      fetchSyncPost: async (p, d) => call(p, d),
    };
  return origLoad.apply(this, arguments);
};
global.document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), body: { appendChild() {} } };

const CiteDB = require("/opt/data/workspace/siyuan-plugin-citedb/index.js");
const T = CiteDB.__test;
const ROLE_LABELS = { title: "题名", author: "作者", container: "出处", year: "年份", issue: "卷期", pages: "页码", wenhao: "文号", type: "类型", place: "出版地", translator: "译者", subtitle: "副标题" };

let fail = 0;
const ok = (c, m, extra) => {
  if (c) console.log("  ok   " + m);
  else {
    fail++;
    console.log("  FAIL " + m + (extra !== undefined ? " → " + extra : ""));
  }
};

(async () => {
  const raw = await call("/api/file/getFile", { path: "/data/storage/petal/siyuan-plugin-citedb/citedb.json" });
  const cfg = T.migrateConfig(raw);
  for (const src of cfg.sources) {
    console.log("\n== " + src.name + "（" + (src.kind === "law" ? "脚注库" : "文献库") + "）");
    const view = (await call("/api/av/renderAttributeView", { id: src.avID, pageSize: 20, page: 1 })).data.view;
    const cols = T.avColumns(view);
    const guess = T.guessMap(cols);
    /* 与 sourceDialog 同一路径：猜到的题名兜底 + 已存映射覆盖 */
    const rows = T.avRows(view, Object.assign({}, guess, src.map));
    ok(rows.length > 0, "读到行（不会因为映射空就变成 0 行）", rows.length);
    const first = rows[0] || { cells: {} };
    const mapped = Object.keys(src.map).filter((r) => src.map[r]);
    console.log("   字段 " + cols.length + " 个，映射 " + mapped.length + " 个：" + mapped.map((r) => ROLE_LABELS[r] || r).join("/"));
    const withVal = mapped.filter((r) => String(first.cells[src.map[r]] || "").trim());
    ok(withVal.length > 0, "第一行有样例值可显示（" + withVal.length + "/" + mapped.length + "）");
    const preview = T.citeText(src, first.cells, src.kind === "law" ? "五" : "45", cfg);
    ok(!!preview && preview.indexOf("缺") < 0, "预览文字正常", preview);
    console.log("   预览: " + preview);
  }
  /* 识别：工作空间里未加入的库（含 .sy 模板拖进来的）应被认出来 */
  const p2 = new CiteDB({ name: "siyuan-plugin-citedb" });
  await p2.onload();
  p2.config = cfg;
  const cands = await p2.detectLibraries();
  console.log("\n== 自动识别（未加入的库）");
  cands.forEach((c) => console.log("   · " + c.name + " → " + (c.kind === "law" ? "脚注库" : "文献库") + "，" + c.cols + " 字段，认到 " + Object.keys(c.map).length + " 个角色"));
  ok(cands.length >= 1, "至少识别出 1 个候选库", cands.length);
  const spike = cands.find((c) => c.avID === "20261126114207-c1kqu6t");
  ok(!!spike && spike.kind === "paper" && Object.keys(spike.map).length === 10, "测试用的 10 字段文献库被认成文献库且 10 个角色", spike && spike.kind + "/" + Object.keys(spike.map).length);
  const spikeLaw = cands.find((c) => c.avID === "20261126114210-6snefej");
  ok(!!spikeLaw && spikeLaw.kind === "law", "测试用的脚注库被认成脚注库", spikeLaw && spikeLaw.kind);

  console.log("\n" + (fail ? "失败 " + fail + " 项" : "全部通过"));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});

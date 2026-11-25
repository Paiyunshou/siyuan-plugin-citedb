/* 联调测试：用真实思源实例跑一遍「读库 → 生成引注 → 插入记录 → 文末参考文献」
 * 用法：node tools/test-live.js <当前文档id>
 * 依赖 /opt/data/.env 的 SIYUAN_URL / SIYUAN_TOKEN。
 * 不改动正文以外的任何数据；会在传入的测试文档上写入 custom-citedb-refs 并追加参考文献块。
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ENV = {};
fs.readFileSync("/opt/data/.env", "utf8").split("\n").forEach((l) => {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) ENV[l.slice(0, i).trim()] = l.slice(i + 1).trim();
});
const URL_BASE = ENV.SIYUAN_URL.replace(/\/$/, "");
const TOKEN = ENV.SIYUAN_TOKEN;

async function call(p, body) {
  const r = await fetch(URL_BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Token " + TOKEN },
    body: JSON.stringify(body || {}),
  });
  return await r.json();
}

// ---- 桩掉 siyuan 模块 ----
const messages = [];
class Plugin {
  constructor(o) { Object.assign(this, o || {}); }
  async loadData() { return null; }
  async saveData() {}
}
const fake = {
  Plugin,
  Dialog: class { constructor() { this.element = null; } },
  showMessage: (m, t, ty) => messages.push([ty || "info", m]),
  fetchSyncPost: async (p, b) => await call(p, b),
};
const orig = Module._load;
Module._load = function (req) {
  if (req === "siyuan") return fake;
  return orig.apply(this, arguments);
};
global.document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }), body: { appendChild() {} } };

const CiteDB = require(path.join(__dirname, "..", "index.js"));
const T = CiteDB.__test;

const AVS = {
  文献库: "20231017090324-uv8yd5x",
  法规库: "20261118161513-bbb37i8",
};

(async () => {
  const docID = process.argv[2];
  const out = { sources: {}, insert: null, bib: null, messages };

  // 1) 读库 + 猜字段 + 生成引注
  for (const [name, avID] of Object.entries(AVS)) {
    const res = await call("/api/av/renderAttributeView", { id: avID, pageSize: 1000, page: 1 });
    if (res.code !== 0) throw new Error(name + " 读取失败: " + res.msg);
    const view = res.data.view;
    const map = T.guessMap(T.avColumns(view));
    const src = { name, avID, kind: name === "法规库" ? "law" : "paper", map };
    const rows = T.avRows(view, map);
    out.sources[name] = {
      mapRoles: Object.keys(map),
      rowCount: rows.length,
      sampleRows: rows.slice(0, 3).map((r) => ({ title: r.title, docID: r.docID, linked: r.linked, cells: r.cells })),
      sampleCite: T.citeText(src, rows[0].cells, name === "法规库" ? "五" : ""),
      sampleCite2: T.citeText(src, rows[1].cells, ""),
      sampleCite3: T.citeText(src, rows[2].cells, ""),
    };
    // 校验 docID 确实是文档块
    if (rows[0]) {
      const q = await call("/api/query/sql", { stmt: `SELECT id, type, content FROM blocks WHERE id = '${rows[0].docID}'` });
      out.sources[name].docIDCheck = q.data && q.data[0] ? { id: q.data[0].id, type: q.data[0].type, content: q.data[0].content } : null;
    }
  }

  if (!docID) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // 2) 插入：法规库第一条 + 条号
  const p = new CiteDB();
  p.config = {
    version: 1,
    sources: Object.entries(AVS).map(([name, avID]) => ({ name, avID, kind: name === "法规库" ? "law" : "paper", map: {} })),
  };
  // 用真实 map
  for (const s of p.config.sources) {
    const res = await call("/api/av/renderAttributeView", { id: s.avID, pageSize: 1000, page: 1 });
    const view = res.data.view;
    s.map = T.guessMap(T.avColumns(view));
    s.av = view;
  }
  const lawSrc = p.config.sources.find((s) => s.kind === "law");
  const lawRows = T.avRows(lawSrc.av, lawSrc.map);
  const paperSrc = p.config.sources.find((s) => s.kind === "paper");
  const paperRows = T.avRows(paperSrc.av, paperSrc.map);

  let inserted = [];
  const protyle = { block: { rootID: docID }, insert: (md) => inserted.push(md) };

  await p.doInsert(protyle, lawSrc, lawRows[0], "五");
  await p.doInsert(protyle, paperSrc, paperRows[0], "");
  out.insert = { inserted, lawText: T.citeText(lawSrc, lawRows[0].cells, "五"), paperText: T.citeText(paperSrc, paperRows[0].cells, "") };

  // 3) 文末参考文献
  await p.refreshBib(protyle);
  const attrs = await call("/api/attr/getBlockAttrs", { id: docID });
  const kd = await call("/api/block/getBlockKramdown", { id: docID });
  out.bib = {
    refsAttr: attrs.data["custom-citedb-refs"] || null,
    bibAttr: attrs.data["custom-citedb-bib"] || null,
    kramdownTail: (kd.data.kramdown || "").split("\n").slice(-8).join("\n"),
  };

  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});

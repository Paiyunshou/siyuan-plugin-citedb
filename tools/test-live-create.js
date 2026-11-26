/* 联调测试：在真实思源里跑「一键新建最小库」，校验字段、映射，然后清理
 * 用法：node tools/test-live-create.js
 * 会在目标笔记本里建一篇「引注数据源」（已存在则复用），测试完删掉新建的两个库块。
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

async function call(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Token " + TOKEN },
    body: JSON.stringify(body || {}),
  });
  return await r.json();
}

const messages = [];
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
class Dialog {
  constructor() {
    this.element = { querySelector: () => null };
  }
}
Module._load = function (request) {
  if (request === "siyuan") {
    return {
      Plugin,
      Dialog,
      showMessage: (m, t, ty) => {
        messages.push([m, ty || ""]);
        console.log("   [消息] " + m);
      },
      fetchSyncPost: async (p, d) => {
        const r = await call(p, d);
        return r;
      },
    };
  }
  return origLoad.apply(this, arguments);
};
global.document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), body: { appendChild() {} } };

const CiteDB = require("/opt/data/workspace/siyuan-plugin-citedb/index.js");

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) {
    pass++;
    console.log("  ok   " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra ? " → " + extra : ""));
  }
}

(async () => {
  const p = new CiteDB({ name: "siyuan-plugin-citedb" });
  await p.onload();

  /* 找（或建）测试笔记本 */
  const nbs = (await call("/api/notebook/lsNotebooks", {})).data.notebooks.filter((n) => !n.closed);
  let nb = nbs.find((n) => n.name === "引注-测试");
  if (!nb) {
    const r = await call("/api/notebook/createNotebook", { name: "引注-测试" });
    nb = r.data.notebook;
    await new Promise((s) => setTimeout(s, 4000));
  }
  console.log("笔记本:", nb.name, nb.id);

  const created = [];
  const avP = await p.createMinimal("paper", nb.id);
  created.push(avP);
  const avL = await p.createMinimal("law", nb.id);
  created.push(avL);

  const check = async (avID, label, want) => {
    const keys = (await call("/api/av/getAttributeViewKeysByAvID", { avID })).data || [];
    const names = keys.map((k) => k.name);
    console.log("\n" + label + " avID=" + avID);
    console.log("   字段:", keys.map((k) => k.name + ":" + k.type).join(" "));
    ok(names.length >= want.length, label + " 字段数 " + names.length, names.join(","));
    want.forEach((w) => {
      const hit = keys.find((k) => k.name === w[0]);
      ok(hit && hit.type === w[1], label + " 有字段「" + w[0] + "」(" + w[1] + ")", hit ? hit.type : "缺失");
    });
    ok(names.indexOf("单选") < 0, label + " 自带「单选」已删");
    /* 落盘的字段顺序 */
    const file = await fetch(BASE + "/api/file/getFile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Token " + TOKEN },
      body: JSON.stringify({ path: `/data/storage/av/${avID}.json` }),
    }).then((r) => r.json());
    const order = ((file && file.keyValues) || []).map((k) => k.key.name);
    console.log("   顺序:", order.join(" → "));
    ok(order[0] === want[0][0], label + " 第一列是「" + want[0][0] + "」", order[0]);
  };

  await check(avP, "文献库", [
    ["题名", "block"],
    ["作者", "text"],
    ["文献类型", "select"],
    ["出版社/刊名", "text"],
    ["出版地", "text"],
    ["年份", "number"],
    ["卷期", "text"],
    ["页码", "text"],
    ["译者", "text"],
    ["副标题", "text"],
  ]);
  await check(avL, "脚注库", [
    ["法规名称", "block"],
    ["文号", "text"],
    ["效力", "select"],
  ]);

  /* 映射：10 个角色 / 2 个角色 */
  const srcP = p.config.sources.find((s) => s.avID === avP);
  const srcL = p.config.sources.find((s) => s.avID === avL);
  console.log("\n映射(文献):", Object.keys(srcP.map).join(","));
  ok(Object.keys(srcP.map).length === 10, "文献库映射 10 个角色", Object.keys(srcP.map).length);
  ok(Object.keys(srcL.map).length === 2, "脚注库映射 2 个角色", Object.keys(srcL.map).length);
  ok(p.config.sources.every((s) => s.kind === "paper" || s.kind === "law"), "kind 分类正确");
  ok(p.config.version === 2, "配置版本 2");

  /* 清理：删掉这次建的库块，并从配置里摘掉 */
  for (const avID of created) {
    const rows = (await call("/api/query/sql", {
      stmt: `SELECT id FROM blocks WHERE type = 'av' AND markdown LIKE '%${avID}%'`,
    })).data;
    for (const r of rows || []) await call("/api/block/deleteBlock", { id: r.id });
    console.log("已删除库块:", avID, (rows || []).length + " 个");
  }

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});

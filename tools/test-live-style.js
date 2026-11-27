/* 联调测试：正文标记三种样式（上标 / 行内 / 著者-年）在真实思源里重排
 * 用法：node tools/test-live-style.js
 * 会临时建 3 篇文档，跑完删掉。
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
      Setting: class {
        constructor() {
          this.items = [];
        }
        addItem(i) {
          this.items.push(i);
        }
      },
      showMessage(m) {
        console.log("   [消息] " + m);
      },
      fetchSyncPost: async (p, d) => call(p, d),
    };
  return origLoad.apply(this, arguments);
};
global.document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), body: { appendChild() {} }, querySelector: () => null };

const CiteDB = require(require("path").join(__dirname, "..", "index.js"));

let fail = 0;
const ok = (c, m, extra) => {
  if (c) console.log("  ok   " + m);
  else {
    fail++;
    console.log("  FAIL " + m + (extra !== undefined ? " → " + extra : ""));
  }
};

const NB = "20261126114204-553g033"; // 引注-测试
const mkDoc = async (path, md) => {
  for (let i = 0; i < 10; i++) {
    const r = await call("/api/filetree/createDocWithMd", { notebook: NB, path: "/" + path, markdown: md });
    if (typeof r.data === "string") return r.data;
    await new Promise((s) => setTimeout(s, 1500));
  }
  throw new Error("建文档失败：" + path);
};

(async () => {
  const p = new CiteDB({ name: "siyuan-plugin-citedb" });
  await p.onload();

  const docA = await mkDoc("样式测试-甲", "# 贾宁财务讲义\n");
  const docB = await mkDoc("样式测试-乙", "# 税务研究文章\n");
  const docT = await mkDoc("样式测试-正文", "# 正文\n\n第一处引文[1]，第二处引文[2]，第三处引文[3]。\n");
  console.log("文档:", docA, docB, docT);

  const refs = [
    { n: 1, docId: docA, linked: true, article: "45", src: "", author: "贾宁", year: "2020", text: "贾宁. 贾宁财务讲义[M]. 北京: 中信出版集团, 2020: 45." },
    { n: 2, docId: docB, linked: true, article: "", src: "", author: "张三, 李四", year: "2023", text: "张三, 李四. 增值税留抵退税的风险识别[J]. 税务研究, 2023(9): 5-8." },
    /* 没绑文档的条目：著者-年制下只能是纯文字标签，切回编号也要认得回来 */
    { n: 3, docId: "20200101000000-xx00001", linked: false, article: "", src: "", author: "王五", year: "2022", text: "王五. 留抵退税实证[M]. 北京: 某社, 2022." },
  ];
  await call("/api/attr/setBlockAttrs", { id: docT, attrs: { "custom-citedb-refs": JSON.stringify(refs) } });

  const bodyOf = async () => {
    const kd = ((await call("/api/block/getBlockKramdown", { id: docT })) || {}).data.kramdown || "";
    return kd.split("\n").filter((l) => l.indexOf("第一处") >= 0)[0] || "";
  };

  /* 1. 上标编号 */
  p.config.format.markStyle = "sup";
  await p.renumber(docT);
  let line = await bodyOf();
  console.log("   上标 →", line);
  ok(/<sup>\(\(/.test(line), "上标：块引包在 <sup> 里", line);
  ok(line.indexOf("[1]") >= 0 && line.indexOf("[2]") >= 0, "上标：编号 [1] [2]");

  /* 2. 行内编号 */
  p.config.format.markStyle = "inline";
  await p.renumber(docT);
  line = await bodyOf();
  console.log("   行内 →", line);
  ok(line.indexOf("<sup>") < 0, "行内：没有 <sup>", line);
  ok(/\[1\]/.test(line) && /\[2\]/.test(line), "行内：编号正常");

  /* 3. 著者-年 */
  p.config.format.markStyle = "authoryear";
  await p.renumber(docT);
  line = await bodyOf();
  console.log("   著者-年 →", line);
  ok(line.indexOf("（贾宁，2020：45）") >= 0, "著者-年：作者+年+页码", line);
  ok(line.indexOf("（张三 等，2023）") >= 0, "著者-年：多作者取第一作者加「等」", line);
  ok(line.indexOf("<sup>") < 0, "著者-年：不上标");
  ok(line.indexOf("（王五，2022）") >= 0, "著者-年：没绑文档的条目用纯文字标签", line);

  /* 4. 文末列表：不编号、按作者排序（贾 < 张） */
  await p.refreshBib({ block: { rootID: docT } }, true);
  const kd = ((await call("/api/block/getBlockKramdown", { id: docT })) || {}).data.kramdown || "";
  const bib = kd.split("参考文献")[1] || "";
  console.log("   文末 →", bib.replace(/\n+/g, " | ").slice(0, 220));
  ok(bib.indexOf("[1]") < 0 && bib.indexOf("[2]") < 0, "著者-年：文末不带编号");
  ok(bib.indexOf("贾宁") < bib.indexOf("张三"), "著者-年：按作者拼音排序（贾在张前）");

  /* 4.5 法规尾注：上标样式下有 <sup>①</sup>，行内没有 */
  const docC = await mkDoc("样式测试-法规", "# 中华人民共和国技术进出口管理条例\n");
  const docL = await mkDoc("样式测试-法规正文", "# 法规正文\n\n依条例①办理。\n");
  await call("/api/attr/setBlockAttrs", {
    id: docL,
    attrs: {
      "custom-citedb-notes": JSON.stringify([{ n: 1, docId: docC, linked: true, article: "五", src: "", text: "《中华人民共和国技术进出口管理条例》第五条" }]),
    },
  });
  const lineOf = async (d, key) => {
    const kd = ((await call("/api/block/getBlockKramdown", { id: d })) || {}).data.kramdown || "";
    return kd.split("\n").filter((l) => l.indexOf(key) >= 0)[0] || "";
  };
  p.config.format.markStyle = "sup";
  await p.renumber(docL);
  let lineL = await lineOf(docL, "依条例");
  console.log("   法规上标 →", lineL);
  ok(lineL.indexOf("<sup>") >= 0, "法规：上标样式下有 <sup>", lineL);
  p.config.format.markStyle = "inline";
  await p.renumber(docL);
  lineL = await lineOf(docL, "依条例");
  console.log("   法规行内 →", lineL);
  ok(lineL.indexOf("<sup>") < 0, "法规：行内样式下没有 <sup>", lineL);

  /* 5. 切回上标：正文应回到 [1] */
  p.config.format.markStyle = "sup";
  await p.renumber(docT);
  line = await bodyOf();
  console.log("   切回上标 →", line);
  ok(/<sup>\(\(.{20,40}"\[1\]"\)\)<\/sup>/.test(line), "切回上标：编号回来了", line);
  ok(line.indexOf("（王五，2022）") < 0 && /\[3\]/.test(line), "切回上标：纯文字著者-年也变回 [3]", line);

  /* 清理 */
  for (const d of [docA, docB, docC, docT, docL]) await call("/api/filetree/removeDocByID", { id: d });
  console.log("\n结果: " + (fail ? fail + " 项失败" : "全部通过"));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});

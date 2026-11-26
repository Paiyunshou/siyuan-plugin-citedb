/* 单元测试：纯函数 + 设置面板构建（不起思源、不碰真实数据）
 * 用法：node tools/test-unit.js
 */
const Module = require("module");
const origLoad = Module._load;
const messages = [];

/* ---- 最小 DOM 桩 ---- */
function mkEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    style: {},
    dataset: {},
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    checked: false,
    disabled: false,
    type: "",
    options: [],
    selectedIndex: 0,
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    setAttribute() {},
    getAttribute() {
      return "";
    },
    querySelector() {
      return mkEl("div");
    },
    querySelectorAll() {
      return [];
    },
    click() {},
    focus() {},
  };
  return el;
}
global.document = {
  getElementById: () => null,
  createElement: (t) => mkEl(t),
  createTextNode: (t) => ({ text: t }),
  body: { appendChild() {} },
  querySelector: () => null,
};
global.window = { getSelection: () => null, confirm: () => true, prompt: () => "" };
global.Blob = class {};
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
global.FileReader = class {};

/* ---- siyuan 桩 ---- */
class Plugin {
  constructor(o) {
    Object.assign(this, o || {});
    this.i18n = {};
  }
  async loadData() {
    return null;
  }
  async saveData() {}
  addTopBar() {}
  addCommand() {}
}
class Dialog {
  constructor(o) {
    this.element = mkEl("div");
    this.args = o;
  }
  destroy() {}
}
class Setting {
  constructor(o) {
    this.opts = o || {};
    this.items = [];
  }
  addItem(i) {
    this.items.push(i);
  }
}
const fakeSiyuan = {
  Plugin,
  Dialog,
  Setting,
  showMessage: (m, t, ty) => messages.push([m, ty || ""]),
  fetchSyncPost: async () => ({ code: 0, data: {} }),
};
Module._load = function (request) {
  if (request === "siyuan") return fakeSiyuan;
  return origLoad.apply(this, arguments);
};

const CiteDB = require("/opt/data/workspace/siyuan-plugin-citedb/index.js");
const T = CiteDB.__test;

let pass = 0;
let fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) {
    pass += 1;
    console.log("  ok   " + label);
  } else {
    fail += 1;
    console.log("  FAIL " + label + "\n       得到: " + JSON.stringify(actual) + "\n       期望: " + JSON.stringify(expected));
  }
}

/* ---- 1. 默认格式与 0.3.x 输出一致 ---- */
console.log("[1] GB/T 7714 默认输出");
const book = {
  name: "文献库",
  kind: "paper",
  map: { title: "t", author: "a", type: "ty", container: "c", place: "p", year: "y", issue: "i", pages: "pg", translator: "tr", subtitle: "st" },
};
eq(
  T.citePaper(book, { t: "贾宁财务讲义", a: "贾宁", ty: "图书", c: "中信出版集团", p: "北京", y: "2020" }, "45", null),
  "贾宁. 贾宁财务讲义[M]. 北京: 中信出版集团, 2020: 45.",
  "图书 + 手填页码"
);
eq(
  T.citePaper(book, { t: "增值税留抵退税的风险识别", a: "张某", ty: "期刊文章", c: "税务研究", i: "2023（9）", pg: "55-58" }, "", null),
  "张某. 增值税留抵退税的风险识别[J]. 税务研究, 2023(9): 55-58.",
  "期刊（年份从卷期里拆出）"
);
eq(
  T.citePaper(book, { t: "高绩效教练", st: "原书第5版", a: "惠特默", tr: "林菲", ty: "图书", p: "北京", c: "机械工业出版社", y: "2018" }, "12", null),
  "惠特默. 高绩效教练: 原书第5版[M]. 林菲, 译. 北京: 机械工业出版社, 2018: 12.",
  "译著"
);
eq(T.citePaper(book, { t: "某书", a: "甲, 乙, 丙, 丁" }, "", null), "甲, 乙, 丙, 等. 某书[M].", "4 位作者 → 前 3 + 等");
eq(
  T.citePaper(book, { t: "某书", a: "甲, 乙, 丙, 丁" }, "", { format: { authorEtAl: false } }),
  "甲, 乙, 丙, 丁. 某书[M].",
  "关掉「等」→ 全列"
);
eq(T.citePaper(book, { t: "某书", a: "甲" }, "", { format: { finalDot: false } }), "甲. 某书[M]", "关掉结尾句号");

/* ---- 2. 自定义模板 ---- */
console.log("[2] 自定义模板");
eq(
  T.citePaper(book, { t: "贾宁财务讲义", a: "贾宁", y: "2020" }, "", { format: { paperStyle: "custom", paperTpl: "{author}．{title}（{year}）" } }),
  "贾宁．贾宁财务讲义（2020）.",
  "书 + 年"
);
eq(
  T.citePaper(book, { t: "只有书名" }, "", { format: { paperStyle: "custom", paperTpl: "{author}. {title}[{type}]. {place}: {container}, {year}: {pages}" } }),
  "只有书名[M].",
  "空字段不留悬空标点"
);

/* ---- 3. 法规 ---- */
console.log("[3] 法规条目");
const law = { name: "法规库", kind: "law", map: { title: "t", wenhao: "w" } };
const lawCells = { t: "关于企业重组业务企业所得税处理若干问题的通知（财税〔2009〕59号）", w: "财税〔2009〕59号" };
eq(T.citeLaw(law, lawCells, "五", null), "《关于企业重组业务企业所得税处理若干问题的通知》（财税〔2009〕59号）第五条", "默认：文号去重 + 条号");
eq(T.citeLaw(law, lawCells, "", null), "《关于企业重组业务企业所得税处理若干问题的通知》（财税〔2009〕59号）", "不填条号");
eq(T.citeLaw(law, lawCells, "五", { format: { noteStyle: "plain" } }), "《关于企业重组业务企业所得税处理若干问题的通知》第五条", "plain 不写文号");
eq(
  T.citeLaw(law, lawCells, "五", { format: { noteStyle: "custom", noteTpl: "《{title}》第{article}条（{wenhao}）" } }),
  "《关于企业重组业务企业所得税处理若干问题的通知》第五条（财税〔2009〕59号）",
  "自定义法规模板"
);

/* ---- 4. 字段猜测：列顺序不能把副标题当题名 ---- */
console.log("[4] 字段猜测");
const spikeCols = [
  { id: "st", name: "副标题", type: "text" },
  { id: "tr", name: "译者", type: "text" },
  { id: "pg", name: "页码", type: "text" },
  { id: "i", name: "卷期", type: "text" },
  { id: "y", name: "年份", type: "number" },
  { id: "p", name: "出版地", type: "text" },
  { id: "c", name: "出版社/刊名", type: "text" },
  { id: "ty", name: "文献类型", type: "select" },
  { id: "a", name: "作者", type: "text" },
  { id: "t", name: "题名", type: "block" },
];
const g = T.guessMap(spikeCols);
eq(g.title, "t", "题名（副标题在前也不行）");
eq(g.subtitle, "st", "副标题");
eq(g.type, "ty", "文献类型");
eq(g.place, "p", "出版地");
eq(g.translator, "tr", "译者");
eq(Object.keys(g).length, 10, "10 个角色全猜中");
eq(T.guessMap([{ id: "x", name: "法规名称", type: "block" }, { id: "y", name: "文号", type: "text" }]).title, "x", "法规库");

/* ---- 4.5 正文标记样式 ---- */
console.log("[4.5] 正文标记");
eq(T.authorShort("贾宁"), "贾宁", "单作者");
eq(T.authorShort("贾宁, 刘沁欣"), "贾宁 等", "多作者取第一作者 + 等");
eq(T.authorShort(""), "", "没有作者");
eq(T.refLabelOf({ n: 3, author: "贾宁", year: "2020", article: "45" }, "authoryear"), "（贾宁，2020：45）", "著者-年 + 页码");
eq(T.refLabelOf({ n: 3, author: "贾宁", year: "2020" }, "authoryear"), "（贾宁，2020）", "著者-年无页码");
eq(T.refLabelOf({ n: 3, author: "", year: "2020" }, "authoryear"), "[3]", "没作者回退成编号");
eq(T.refLabelOf({ n: 3, author: "贾宁", year: "2020" }, "sup"), "[3]", "上标样式用编号");
eq(T.refLabelOf({ n: 3, author: "贾宁", year: "2020" }, "inline"), "[3]", "行内样式用编号");

/* ---- 5. 配置迁移 ---- */
console.log("[5] 配置迁移");
const v1 = { version: 1, sources: [{ name: "旧库", avID: "20240101000000-abcdefg", kind: "law", map: { title: "k1", wenhao: "k2" } }] };
const cfg2 = T.migrateConfig(v1);
eq(cfg2.version, 2, "版本升到 2");
eq(cfg2.sources[0].map.title, "k1", "旧映射保留");
eq(cfg2.sources[0].origin, "existing", "补 origin");
eq(cfg2.format.paperStyle, "gbt7714", "补格式默认值");
eq(cfg2.insert.autoSync, true, "补插入默认值");
eq(cfg2.format.markStyle, "sup", "补正文标记默认值（保持老行为）");
eq(T.migrateConfig(null).sources.length, 0, "空配置");

/* ---- 6. 设置面板能构建 ---- */
console.log("[6] 设置面板");
const p = new CiteDB({ name: "siyuan-plugin-citedb" });
(async () => {
  await p.onload();
  eq(!!p.setting, true, "setting 已创建");
  const items = p.setting.items || [];
  eq(items.length >= 9, true, "至少 9 个设置项（实际 " + items.length + "）");
  let built = 0;
  for (const it of items) {
    try {
      if (typeof it.createActionElement === "function") {
        it.createActionElement();
        built += 1;
      }
    } catch (e) {
      console.log("  FAIL 设置项「" + it.title + "」构建失败：" + e.message);
      fail += 1;
    }
  }
  eq(built, items.length, "所有设置项都能渲染");
  let threw = null;
  try {
    p.openSettings();
  } catch (e2) {
    threw = e2;
  }
  eq(threw === null, true, "面板里的设置对话框能构建" + (threw ? "：" + threw.message : ""));
  eq(p.settingItems().length, items.length, "两处设置项数量一致");

  /* 新建库用的常量 */
  eq(T.defaultConfig().newLibNotebook, "", "defaultConfig 有 newLibNotebook");

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});

/* 引注 CiteDB — 0.4.0
 * 思源插件运行时是 CommonJS：require("siyuan") + module.exports 导出插件类。
 * 无构建链，改完 python3 tools/deploy.py 部署即生效。
 */
const siyuan = require("siyuan");

const VERSION = "1.0.0";
const SCHEMA = 2;
const DATA_FILE = "citedb.json";
const ATTR_REFS = "custom-citedb-refs";
const ATTR_BIB = "custom-citedb-bib";
const ATTR_NOTES = "custom-citedb-notes"; /* 法规走尾注，单独存一份，别和参考文献混 */

/* 内置最小库的字段定义（自动建库 / 模板用）。块类型只能有一列，所以题名固定落在主键列上。 */
const MINIMAL_PAPER = [
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
];
const PAPER_COL_ROLE = {
  题名: "title",
  作者: "author",
  文献类型: "type",
  "出版社/刊名": "container",
  出版地: "place",
  年份: "year",
  卷期: "issue",
  页码: "pages",
  译者: "translator",
  副标题: "subtitle",
};
const MINIMAL_LAW = [
  ["法规名称", "block"],
  ["文号", "text"],
  ["效力", "select"],
];
const LAW_COL_ROLE = { 法规名称: "title", 文号: "wenhao" };

/* 引注格式默认值：默认行为与 0.3.x 完全一致（GB/T 7714-2015 顺序编码制 + 圈码尾注） */
const FORMAT_DEFAULTS = {
  paperStyle: "gbt7714", /* gbt7714 | custom */
  paperTpl: "{author}. {title}[{type}]. {place}: {container}, {year}: {pages}",
  noteStyle: "bracket", /* bracket: 《名》（文号）第X条 | plain: 《名》第X条 | custom */
  noteTpl: "《{title}》（{wenhao}）第{article}条",
  authorMax: 3,
  authorEtAl: true,
  finalDot: true,
  /* 正文标记：sup 上标编号 | inline 行内编号 | authoryear 著者-出版年 */
  markStyle: "sup",
};
const INSERT_DEFAULTS = {
  autoSync: true,
  refTitle: "参考文献",
  noteTitle: "注",
  linkEntries: true,
};

const ICON_SVG = `<symbol id="iconCiteDB" viewBox="0 0 32 32"><rect x="0.6" y="0.6" width="30.8" height="30.8" rx="7.5" fill="#F0872A"/><g transform="translate(5.401,23.771) scale(0.01096,-0.01096)"><path d="M1526 1667H1820V-249H1526ZM432 637H1184L1151 120Q1141 -15 1088.5 -99.5Q1036 -184 943.0 -216.5Q850 -249 386 -249Q350 -97 304 41Q456 33 607 33Q729 33 773.5 51.5Q818 70 833.0 114.0Q848 158 862 379H114L180 1115H884V1343H122V1601H1178V857H448Z" fill="#FFFFFF"/></g></symbol>`;

const ROLE_LABELS = {
  title: "题名",
  author: "作者",
  container: "出处（出版社/刊名）",
  year: "年份",
  issue: "卷期",
  pages: "页码",
  wenhao: "文号",
  type: "文献类型",
  place: "出版地",
  translator: "译者",
  subtitle: "副标题",
};

/* 映射对话框里按类型只显示相关角色 */
const PAPER_ROLES = ["title", "author", "type", "container", "place", "year", "issue", "pages", "translator", "subtitle"];
const LAW_ROLES = ["title", "wenhao"];

/** 生成思源风格的块 id：20261126114207-c1kqu6t */
function makeId() {
  const d = new Date();
  const p = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  const ts =
    "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < 7; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return ts + "-" + r;
}

/* 字段名 -> 角色 的猜测规则（用户之后可在界面里改） */
const HINT_BY_NAME = [
  ["title", ["法规名称", "文献标题", "题名", "书名", "标题", "文献名", "名称"]],
  ["author", ["作者", "著者", "责任者"]],
  ["container", ["出版社/刊名", "出版社", "出版者", "刊名", "期刊", "出处"]],
  ["year", ["出版年", "发布年份", "发布日期", "实施日期", "年份"]],
  ["issue", ["卷期", "期号"]],
  ["pages", ["页码"]],
  ["wenhao", ["文号", "发文字号"]],
  ["type", ["文献类型", "类型"]],
  ["place", ["出版地", "出版城市"]],
  ["translator", ["译者", "翻译者"]],
  ["subtitle", ["副标题", "副题名"]],
];

/* ---------------- 纯函数（可单测） ---------------- */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function cellText(v) {
  if (!v) return "";
  if (v.type === "block" || v.block) return (v.block && v.block.content) || "";
  if (v.type === "text" || v.text) return (v.text && v.text.content) || "";
  if (v.type === "number" || v.number) {
    const n = v.number && v.number.content;
    if (typeof n === "number") return String(n);
    return (v.number && v.number.formatted) || "";
  }
  if (v.type === "select" || v.mSelect) return (v.mSelect || []).map(function (o) { return o.content; }).join("、");
  if (v.type === "date" || v.date) {
    const ms = Number(v.date && v.date.content);
    if (!ms) return "";
    return String(new Date(ms).getFullYear());
  }
  if (v.mAsset) return (v.mAsset || []).map(function (o) { return o.name; }).join("、");
  return "";
}

/** 按字段名猜测角色 -> keyID。打分后贪心分配：
 *  精确同名 100 / 前缀 70 / 包含 40-长度差；「副标题」不许抢题名的位置
 *  （0.3.x 用 keys.find 取第一个包含命中的，列顺序一变就会把副标题当成题名）。
 */
function guessMap(keys) {
  const cands = [];
  HINT_BY_NAME.forEach(function (pair) {
    const role = pair[0];
    keys.forEach(function (k) {
      const name = String(k.name || "").trim();
      if (!name) return;
      let best = 0;
      pair[1].forEach(function (h) {
        if (name === h) best = Math.max(best, 100);
        else if (name.indexOf(h) === 0) best = Math.max(best, 70);
        else if (name.indexOf(h) >= 0) best = Math.max(best, 40 - Math.min(20, name.length - h.length));
      });
      if (!best) return;
      if (role === "title" && /副/.test(name)) best -= 60;
      if (role === "subtitle" && /副/.test(name)) best += 30;
      if (best > 0) cands.push({ role: role, keyID: k.id, score: best });
    });
  });
  cands.sort(function (a, b) { return b.score - a.score; });
  const guess = {};
  const used = {};
  cands.forEach(function (c) {
    if (guess[c.role] || used[c.keyID]) return;
    guess[c.role] = c.keyID;
    used[c.keyID] = 1;
  });
  return guess;
}

/** 把 renderAttributeView 的视图摊平成行：{rowID, docID, linked, cells:{keyID:text}, title}
 *  注意：必须用 renderAttributeView，不能用 getAttributeView —— 后者的每列 values 是各自
 *  排序的、空值还被省略，按下标对齐会串行（实测作者/年份会错到别的书上）。
 */
function avRows(view, map) {
  const out = [];
  ((view && view.rows) || []).forEach(function (row) {
    const cells = {};
    let docID = "";
    let linkable = false;
    ((row.cells) || []).forEach(function (c) {
      const v = c.value || {};
      const key = v.keyID || c.keyID || c.id;
      if (!key) return;
      cells[key] = cellText(v);
      /* 身份 id：优先 v.blockID（库里每格都带），它是这一行/这一格自己的 id；
         只有「格子绑的是文档」时（v.block.id 有值，如法规库）才给它做跳转链接，
         文献库的格子是普通段落，链接过去打不开，就退回纯编号 */
      if (v.block && v.block.id) {
        linkable = true;
        if (!docID) docID = v.block.id;
      }
      if (!docID) {
        if (v.blockID) docID = v.blockID;
        else {
          const mm = /data-node-id="([^"]+)"/.exec((v.block && v.block.richBlockDOM) || "");
          if (mm) docID = mm[1];
        }
      }
    });
    const title = (map.title && cells[map.title]) || "";
    if (!String(title).trim()) return;
    out.push({
      rowID: row.id,
      docID: docID || row.id,
      linked: linkable,
      cells: cells,
      title: String(title).trim(),
    });
  });
  return out;
}

/** 视图的列 -> [{id,name,type}]，用于猜字段 */
function avColumns(view) {
  return ((view && view.columns) || []).map(function (c) {
    return { id: c.id, name: c.name, type: c.type };
  });
}

/** 法规标题里常自带文号（「…的通知（财税〔2009〕59号）」），剔掉，免得引注里出现两遍 */
function cleanLawTitle(title, wenhao) {
  let t = String(title || "");
  if (!wenhao) return t.trim();
  const norm = function (x) {
    return String(x || "").replace(/[\s（）()〔〕\[\]【】《》、，,.。·]/g, "");
  };
  const nw = norm(wenhao);
  if (!nw) return t.trim();
  /* 1. 整段带括号的直接删 */
  [["（", "）"], ["(", ")"], ["【", "】"], ["[", "]"]].forEach(function (pair) {
    t = t.split(pair[0] + wenhao + pair[1]).join("");
  });
  /* 2. 括号段规范化后与文号相同的删掉（兼容全角/半角、空格差异） */
  t = t.replace(/[（(【\[]([^（()）【】\[\]]{2,60})[）)】\]]/g, function (m, inner) {
    return norm(inner) === nw ? "" : m;
  });
  return t.replace(/\s{2,}/g, " ").trim();
}

/* ---------- 圈码（尾注用） ---------- */
const CIRCLED_RANGE = "①-⑳㉑-㉟㊱-㊿";
function cir(n) {
  n = Number(n) || 0;
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCharCode(0x32b1 + n - 36);
  return "(" + n + ")";
}
function cirIndex(ch) {
  const c = String(ch || "").charCodeAt(0);
  if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1;
  if (c >= 0x3251 && c <= 0x325f) return c - 0x3251 + 21;
  if (c >= 0x32b1 && c <= 0x32bf) return c - 0x32b1 + 36;
  return 0;
}
function isCircled(ch) {
  const c = String(ch || "").charCodeAt(0);
  return (c >= 0x2460 && c <= 0x2473) || (c >= 0x3251 && c <= 0x325f) || (c >= 0x32b1 && c <= 0x32bf);
}

/* ---------- GB/T 7714-2015 顺序编码制 ---------- */
const TYPE_CODE = { 图书: "M", 期刊文章: "J", 学位论文: "D", 报纸: "N", 论文集: "C", 标准: "S", 电子资源: "EB/OL" };

function typeCode(s) {
  const t = String(s || "").trim();
  for (const k in TYPE_CODE) if (t.indexOf(k) >= 0) return TYPE_CODE[k];
  return "M";
}

/** 责任者：逗号/顿号/分号分隔；超过 max 个只留前 max 个，按配置加「, 等」 */
function authorList(s, max, etAl) {
  const arr = String(s || "")
    .split(/[，,；;、\/]+/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x && x !== "等"; });
  if (!arr.length) return "";
  const n = Number(max) > 0 ? Number(max) : 3;
  if (arr.length > n) {
    if (etAl === false) return arr.join(", ");
    return arr.slice(0, n).join(", ") + ", 等";
  }
  return arr.join(", ");
}

/** 卷期里常写成「2026（9）」，把年份拆出来 */
function splitIssue(raw, year) {
  let issue = String(raw || "").trim().replace(/）/g, ")").replace(/（/g, "(");
  const m = issue.match(/^(\d{4})\s*\(?\s*([^)]*?)\s*\)?$/);
  if (m) {
    if (!year) year = m[1];
    issue = (m[2] || "").trim();
  }
  return { year: year || "", issue: issue };
}

/** 格式配置：缺省项回落到默认值 */
function fmtOf(cfg) {
  return Object.assign({}, FORMAT_DEFAULTS, (cfg && cfg.format) || {});
}

/** 著者-年制里作者只留第一位，多作者加「等」 */
function authorShort(a) {
  const parts = String(a || "")
    .split(/[,，、;；]/)
    .map(function (x) {
      return x.trim();
    })
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.length > 1 ? parts[0] + " 等" : parts[0];
}

/** 正文里这条引用的显示标签：编号制 [n]，著者-年制 （作者，年：页码） */
function refLabelOf(e, style) {
  if (style === "authoryear" && e) {
    const a = authorShort(e.author);
    if (a) {
      const y = String(e.year || "").trim();
      const pg = String(e.article || "").trim();
      return "（" + a + (y ? "，" + y : "") + (pg ? "：" + pg : "") + "）";
    }
  }
  return "[" + ((e && e.n) || 0) + "]";
}

/** 实际生效的正文标记样式：选了著者-年但条目缺作者时整体退回行内编号 */
function effectiveMarkStyle(config, refs) {
  const want = fmtOf(config).markStyle || "sup";
  if (want !== "authoryear") return want;
  const list = refs || [];
  if (!list.length) return "inline";
  return list.every(function (r) {
    return !!authorShort(r.author);
  })
    ? "authoryear"
    : "inline";
}

/** 自定义模板渲染：先把占位符换成值，再清掉空字段留下的悬空标点 */
function renderTpl(tpl, ctx) {
  let out = String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) {
    return ctx[k] == null ? "" : String(ctx[k]);
  });
  out = out.replace(/[（(]\s*[）)]/g, "").replace(/第\s*条/g, "");
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(/([,.，。、;；])\s*[:：]\s*/g, "$1 ")
      .replace(/\s*[:：]\s*(?=[,.，。;；、]|$)/g, "")
      .replace(/([,.，。、;；])(?:\s*[,，、;；:：])+/g, "$1");
  }
  return out
    .replace(/\s*([,.，。、;；])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.，。;；:：、]+/, "")
    .replace(/[,，、;；:：\s]+$/, "")
    .trim();
}

/** 文献库 → 参考文献条目
 *  gbt7714（默认，与 0.3.x 一致）：贾宁. 贾宁财务讲义[M]. 北京: 中信出版集团, 2020: 45.
 *  custom：按用户模板，可用占位符见设置页说明
 */
function citePaper(src, cells, extra, cfg) {
  const f = fmtOf(cfg);
  const g = function (role) {
    const k = src.map && src.map[role];
    return k && cells[k] ? String(cells[k]).trim() : "";
  };
  const title = g("title");
  if (!title) return "（缺题名）";
  const code = typeCode(g("type"));
  const si = splitIssue(g("issue"), g("year"));
  const pages = code === "J" ? g("pages") : String(extra || "").trim() || g("pages");
  const authors = authorList(g("author"), f.authorMax, f.authorEtAl);

  if (f.paperStyle === "custom") {
    let out = renderTpl(f.paperTpl, {
      author: authors,
      title: title,
      subtitle: g("subtitle"),
      type: code,
      place: g("place"),
      container: g("container"),
      year: si.year,
      issue: si.issue,
      pages: pages,
      translator: authorList(g("translator"), f.authorMax, f.authorEtAl),
    });
    if (!out) out = title;
    if (f.finalDot !== false && !/[.。]$/.test(out)) out += ".";
    return out;
  }

  const sub = g("subtitle");
  const trans = authorList(g("translator"), f.authorMax, f.authorEtAl);
  const container = g("container");
  const place = g("place");
  let out = authors ? authors + ". " : "";
  out += title + (sub ? ": " + sub : "") + "[" + code + "]";
  if (trans) out += ". " + trans + ", 译";
  /* 期刊不写出版地（GB/T 7714 里期刊只到刊名），图书才写「北京: 中信出版集团」 */
  if (container) out += ". " + (place && code !== "J" ? place + ": " : "") + container;
  if (si.year) out += ", " + si.year;
  if (code === "J" && si.issue) out += "(" + si.issue + ")";
  if (pages) out += ": " + pages;
  if (f.finalDot === false) return out;
  return out + ".";
}

/** 法规 → 尾注文字
 *  bracket（默认）：《法规名》（文号）第X条
 *  plain：《法规名》第X条    custom：按用户模板
 *  法规条目一律不加结尾句号。
 */
function citeLaw(src, cells, article, cfg) {
  const f = fmtOf(cfg);
  const g = function (role) {
    const k = src.map && src.map[role];
    return k && cells[k] ? String(cells[k]).trim() : "";
  };
  const title = g("title");
  if (!title) return "（缺法规名）";
  const wenhao = g("wenhao");
  const a = String(article || "").trim();
  if (f.noteStyle === "custom") {
    return renderTpl(f.noteTpl, { title: cleanLawTitle(title, wenhao), wenhao: wenhao, article: a });
  }
  let out = "《" + cleanLawTitle(title, wenhao) + "》";
  if (f.noteStyle !== "plain" && wenhao) out += "（" + wenhao + "）";
  if (a) out += "第" + a + "条";
  /* 尾注条目结尾不加句号（用户觉得多余），文中上标也不带标点 */
  return out;
}

function citeText(src, cells, extra, cfg) {
  if (src.kind === "law") return citeLaw(src, cells, extra, cfg);
  return citePaper(src, cells, extra, cfg);
}

/** 配置默认值 */
function defaultConfig() {
  return {
    version: SCHEMA,
    sources: [],
    format: Object.assign({}, FORMAT_DEFAULTS),
    insert: Object.assign({}, INSERT_DEFAULTS),
    newLibNotebook: "",
  };
}

/** v1（只有 version/sources）→ v2：补 format / insert，并给数据源补 kind/origin。
 *  老配置的映射原样保留，不猜不覆盖。 */
function migrateConfig(saved) {
  const cfg = defaultConfig();
  if (!saved || typeof saved !== "object") return cfg;
  cfg.newLibNotebook = saved.newLibNotebook || "";
  cfg.format = Object.assign({}, FORMAT_DEFAULTS, saved.format || {});
  cfg.insert = Object.assign({}, INSERT_DEFAULTS, saved.insert || {});
  cfg.sources = (Array.isArray(saved.sources) ? saved.sources : []).map(function (s) {
    return {
      name: s.name || "数据源",
      avID: s.avID || "",
      kind: s.kind === "law" ? "law" : "paper",
      origin: s.origin || "existing",
      map: s.map || {},
    };
  });
  cfg.version = SCHEMA;
  return cfg;
}

/* ---------------- 插件 ---------------- */

class CiteDB extends siyuan.Plugin {
  constructor(options) {
    super(options);
    this.config = defaultConfig();
    this.lastProtyle = null;
    if (typeof siyuan.Setting === "function") {
      try {
        this.setting = this.buildSetting();
      } catch (e) {
        console.warn("[citedb] 设置面板构建失败", e);
      }
    }
    this.protyleSlash = [
      {
        filter: ["引注", "cite", "citedb", "参考文献", "法条"],
        html:
          '<div class="b3-list-item__first"><span class="b3-list-item__text">引注：插入引用</span>' +
          '<span class="b3-list-item__meta">从文献库/法规库搜索</span></div>',
        id: "citeDBInsert",
        callback: (protyle) => {
          this.lastProtyle = protyle;
          this.openSearch(protyle);
        },
      },
    ];
  }

  async onload() {
    try {
      const saved = await this.loadData(DATA_FILE);
      this.config = migrateConfig(saved);
      /* 老配置升级后立刻写回，免得每次启动都迁移一遍 */
      if (saved && saved.version !== SCHEMA) await this.save();
    } catch (e) {
      console.error("[citedb] 读取配置失败", e);
    }
    try {
      const self = this;
      const grab = function (e) {
        const p = e && e.detail && e.detail.protyle;
        if (p && p.block && p.block.rootID) self.lastProtyle = p;
      };
      ["click-editorcontent", "switch-protyle", "loaded-protyle-static", "loaded-protyle-dynamic"].forEach(function (name) {
        try {
          self.eventBus.on(name, grab);
        } catch (err) {
          console.warn("[citedb] 订阅 " + name + " 失败", err);
        }
      });
    } catch (e) {
      console.warn("[citedb] eventBus 订阅失败", e);
    }

    this.injectIcon();
    this.addTopBar({
      icon: "iconCiteDB",
      title: "引注 CiteDB",
      position: "right",
      callback: () => this.safe(this.openPanel.bind(this)),
    });
    this.addCommand({ langKey: "openPanel", hotkey: "", callback: () => this.safe(this.openPanel.bind(this)) });
    this.addCommand({ langKey: "openSearch", hotkey: "", callback: () => this.safe(() => this.openSearch(this.lastProtyle)) });
    this.addCommand({ langKey: "refreshBib", hotkey: "", callback: () => this.safe(() => this.refreshBib(this.lastProtyle)) });
    console.log("[citedb] loaded", VERSION);
  }

  onunload() {
    const el = document.getElementById("citeDB-symbols");
    if (el) el.remove();
  }

  safe(fn) {
    try {
      const r = fn();
      if (r && typeof r.catch === "function") {
        r.catch((e) => {
          console.error("[citedb]", e);
          siyuan.showMessage("引注出错：" + ((e && e.message) || e), 8000, "error");
        });
      }
    } catch (e) {
      console.error("[citedb]", e);
      siyuan.showMessage("引注出错：" + ((e && e.message) || e), 8000, "error");
    }
  }

  injectIcon() {
    if (document.getElementById("citeDB-symbols")) return;
    const wrap = document.createElement("div");
    wrap.id = "citeDB-symbols";
    wrap.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + ICON_SVG + "</svg>";
    document.body.appendChild(wrap);
  }

  async save() {
    await this.saveData(DATA_FILE, this.config);
  }

  /** 用磁盘上最新的配置覆盖内存里那份：多标签页/换设备时内存里的可能过期，
      否则「设置里改了样式，刷新还是老样子」 */
  async syncConfigFromDisk() {
    try {
      const saved = await this.loadData(DATA_FILE);
      if (!saved) return;
      if (saved.format) this.config.format = Object.assign({}, FORMAT_DEFAULTS, saved.format);
      if (saved.insert) this.config.insert = Object.assign({}, INSERT_DEFAULTS, saved.insert);
    } catch (e) {
      /* 读不到就用内存里的 */
    }
  }

  /* ---------------- 设置面板 ---------------- */

  /** 设置项清单：标题 + 说明 + 渲染函数。集市里的齿轮和面板里的「设置」共用同一份 */
  settingItems() {
    const self = this;
    const f = this.config.format;
    const ins = this.config.insert;
    const items = [];

    const mkSel = function (opts, value, cb) {
      const s = document.createElement("select");
      s.className = "b3-select citeDB-set-sel";
      opts.forEach(function (o) {
        const op = document.createElement("option");
        op.value = o[0];
        op.textContent = o[1];
        if (o[0] === value) op.selected = true;
        s.appendChild(op);
      });
      s.addEventListener("change", function () {
        cb(s.value);
      });
      return s;
    };
    const mkText = function (value, ph, cb, cls) {
      const i = document.createElement("input");
      i.className = "b3-text-field " + (cls || "");
      i.value = value == null ? "" : value;
      i.placeholder = ph || "";
      i.addEventListener("change", function () {
        cb(i.value);
      });
      return i;
    };
    const mkCheck = function (label, checked, cb) {
      const l = document.createElement("label");
      l.className = "citeDB-set-check";
      const i = document.createElement("input");
      i.type = "checkbox";
      i.checked = !!checked;
      i.addEventListener("change", function () {
        cb(i.checked);
      });
      l.appendChild(i);
      l.appendChild(document.createTextNode(label));
      return l;
    };
    const hint = function (text) {
      const d = document.createElement("div");
      d.className = "citeDB-set-hint";
      d.textContent = text;
      return d;
    };
    const col = function () {
      const d = document.createElement("div");
      d.className = "citeDB-set-col";
      for (let i = 0; i < arguments.length; i++) if (arguments[i]) d.appendChild(arguments[i]);
      return d;
    };
    const item = function (title, desc, el) {
      items.push({ title: title, desc: desc, render: el });
    };

    /* 1. 数据源管理 */
    const srcBox = document.createElement("div");
    self.settingRefresh = function () {
      self.renderSources(srcBox);
    };
    item("数据源", "文献库与脚注库分开放。新建的库字段固定，不用映射；用自己的库才需要手动对字段。", function () {
      self.renderSources(srcBox);
      return srcBox;
    });

    /* 2. 新建最小库 */
    const newBox = document.createElement("div");
    item("新建数据库（还没有库的人）", "选一个笔记本，插件会在里面新建「引注数据源」文档，并把库和字段一次建好。", function () {
      self.renderNewLib(newBox);
      return newBox;
    });

    /* 3. 正文标记样式 */
    const markSel = mkSel(
      [
        ["sup", "上标编号：正文 ᵗ[1] / ᵗ①"],
        ["inline", "行内编号：正文 [1] / ①（正常字号）"],
        ["authoryear", "著者-出版年：正文（作者，年：页码）"],
      ],
      f.markStyle || "sup",
      function (v) {
        self.config.format = self.config.format || {};
        self.config.format.markStyle = v;
        const name = v === "authoryear" ? "著者-出版年" : v === "inline" ? "行内编号" : "上标编号";
        self.safe(function () {
          return self.save().then(function () {
            siyuan.showMessage("正文标记已设为「" + name + "」，在文档里点「刷新参考文献」生效", 5000);
          });
        });
      }
    );
    item(
      "正文标记",
      "改完在文档里点「刷新参考文献」即可把已有引用一并重排。著者-出版年制要求条目绑定了文档、且库里有作者和年份，缺的回退成编号；文末参考文献不编号、按第一作者排序。",
      function () {
        return col(markSel);
      }
    );

    /* 4. 文献条目格式 */
    const paperTpl = mkText(f.paperTpl, "{author}. {title}[{type}]. {place}: {container}, {year}: {pages}", function (v) {
      self.config.format.paperTpl = v;
      self.safe(function () { return self.save(); });
    }, "citeDB-set-tpl");
    const paperSel = mkSel(
      [
        ["gbt7714", "GB/T 7714-2015 顺序编码制"],
        ["custom", "自定义模板"],
      ],
      f.paperStyle,
      function (v) {
        self.config.format.paperStyle = v;
        self.safe(function () { return self.save(); });
        syncPaper();
      }
    );
    const syncPaper = function () {
      const on = self.config.format.paperStyle === "custom";
      paperTpl.disabled = !on;
      paperTpl.style.opacity = on ? "" : ".4";
    };
    item(
      "文献条目格式",
      "默认与 GB/T 7714-2015 一致（图书 M / 期刊 J / 学位论文 D …）。",
      function () {
        syncPaper();
        return col(paperSel, paperTpl, hint("自定义可用：{author} {title} {subtitle} {type} {place} {container} {year} {issue} {pages} {translator}"));
      }
    );

    /* 5. 法规条目格式 */
    const noteTpl = mkText(f.noteTpl, "《{title}》（{wenhao}）第{article}条", function (v) {
      self.config.format.noteTpl = v;
      self.safe(function () { return self.save(); });
    }, "citeDB-set-tpl");
    const noteSel = mkSel(
      [
        ["bracket", "《法规名》（文号）第X条"],
        ["plain", "《法规名》第X条"],
        ["custom", "自定义模板"],
      ],
      f.noteStyle,
      function (v) {
        self.config.format.noteStyle = v;
        self.safe(function () { return self.save(); });
        syncNote();
      }
    );
    const syncNote = function () {
      const on = self.config.format.noteStyle === "custom";
      noteTpl.disabled = !on;
      noteTpl.style.opacity = on ? "" : ".4";
    };
    item(
      "法规条目格式",
      "法规走尾注（①），条目结尾不加句号。",
      function () {
        syncNote();
        return col(noteSel, noteTpl, hint("自定义可用：{title} {wenhao} {article}"));
      }
    );

    /* 5. 作者人数与省略 */
    item(
      "作者人数",
      "超过这个人数时只列前几位；不勾「等」就全部列出。",
      function () {
        return col(
          mkText(String(f.authorMax), "3", function (v) {
            const n = parseInt(v, 10);
            self.config.format.authorMax = n > 0 ? n : 3;
            self.safe(function () { return self.save(); });
          }, "citeDB-set-num"),
          mkCheck("超出时加「等」", f.authorEtAl, function (v) {
            self.config.format.authorEtAl = v;
            self.safe(function () { return self.save(); });
          })
        );
      }
    );

    /* 6. 条目结尾句号 */
    item(
      "文献条目结尾加句号",
      "法规条目始终不加句号。",
      function () {
        return mkCheck("在本条末尾加「.」", f.finalDot, function (v) {
          self.config.format.finalDot = v;
          self.safe(function () { return self.save(); });
        });
      }
    );

    /* 7. 插入行为 */
    item(
      "插入后自动更新文末",
      "关掉后要手动执行命令「刷新参考文献」才更新。",
      function () {
        return mkCheck("每次插入后自动重排编号、重建文末列表", ins.autoSync, function (v) {
          self.config.insert.autoSync = v;
          self.safe(function () { return self.save(); });
        });
      }
    );

    /* 8. 文末标题 */
    item(
      "文末标题",
      "改成「注释」「引用文献」之类。改完点一次「刷新参考文献」，旧标题块会被替换。",
      function () {
        return col(
          mkText(ins.refTitle, "参考文献", function (v) {
            self.config.insert.refTitle = v.trim() || "参考文献";
            self.safe(function () { return self.save(); });
          }, "citeDB-set-title"),
          mkText(ins.noteTitle, "注", function (v) {
            self.config.insert.noteTitle = v.trim() || "注";
            self.safe(function () { return self.save(); });
          }, "citeDB-set-title")
        );
      }
    );

    /* 9. 条目双链 */
    item(
      "条目标题带双链",
      "条目的书名/法规名做成块引，点击可跳到原文文档（库里的格子必须绑了文档）。",
      function () {
        return mkCheck("生成 [标题](siyuan://blocks/…)", ins.linkEntries, function (v) {
          self.config.insert.linkEntries = v;
          self.safe(function () { return self.save(); });
        });
      }
    );

    /* 10. 配置导入导出 */
    item(
      "配置备份",
      "导出后可以换设备导入，或分享给同行（只含数据源和格式设置，不含笔记内容）。",
      function () {
        const box = document.createElement("div");
        box.className = "citeDB-set-col citeDB-set-row";
        const bExp = document.createElement("button");
        bExp.className = "b3-button b3-button--outline";
        bExp.textContent = "导出配置";
        bExp.addEventListener("click", function () {
          self.safe(function () {
            return self.exportConfig();
          });
        });
        const bImp = document.createElement("button");
        bImp.className = "b3-button b3-button--outline";
        bImp.textContent = "导入配置";
        bImp.addEventListener("click", function () {
          self.safe(function () {
            return self.importConfig();
          });
        });
        box.appendChild(bExp);
        box.appendChild(bImp);
        return box;
      }
    );

    return items;
  }

  /** 集市 → 已下载 → 插件设置（齿轮）：思源自带的设置容器 */
  buildSetting() {
    const self = this;
    if (typeof siyuan.Setting !== "function") return null;
    const setting = new siyuan.Setting({
      confirmCallback: function () {
        self.safe(function () {
          return self.save();
        });
      },
    });
    this.settingItems().forEach(function (it) {
      try {
        setting.addItem({ title: it.title, description: it.desc, createActionElement: it.render });
      } catch (e) {
        console.warn("[citedb] 设置项「" + it.title + "」挂载失败", e);
      }
    });
    return setting;
  }

  /** 面板里的「设置」：不依赖 siyuan.Setting，自己拉一个对话框，内容与齿轮一致 */
  openSettings() {
    const items = this.settingItems();
    const dialog = new siyuan.Dialog({
      title: "引注 CiteDB 设置 " + VERSION,
      content: '<div class="b3-dialog__content citeDB-settings"></div>',
      width: "720px",
    });
    const box = dialog.element.querySelector(".citeDB-settings") || dialog.element;
    const self = this;
    items.forEach(function (it) {
      const sec = document.createElement("div");
      sec.className = "citeDB-set-sec";
      const h = document.createElement("div");
      h.className = "citeDB-set-title2";
      h.textContent = it.title;
      const d = document.createElement("div");
      d.className = "citeDB-set-hint";
      d.textContent = it.desc || "";
      sec.appendChild(h);
      if (it.desc) sec.appendChild(d);
      try {
        sec.appendChild(it.render());
      } catch (e) {
        const err = document.createElement("div");
        err.className = "citeDB-set-hint";
        err.textContent = "这一项没渲染出来：" + ((e && e.message) || e);
        sec.appendChild(err);
      }
      box.appendChild(sec);
    });
    const foot = document.createElement("div");
    foot.className = "citeDB-actions";
    const close = document.createElement("button");
    close.className = "b3-button b3-button--text";
    close.textContent = "完成";
    close.addEventListener("click", function () {
      self.safe(async function () {
        await self.save();
        dialog.destroy();
      });
    });
    foot.appendChild(close);
    box.appendChild(foot);
  }

  /* ---------------- 设置：数据源列表 ---------------- */

  sourcesHtml() {
    const sources = this.config.sources || [];
    const self = this;
    let h = "";
    [
      ["paper", "文献库"],
      ["law", "脚注库（法规）"],
    ].forEach(function (pair) {
      const list = [];
      sources.forEach(function (s, i) {
        if (s.kind === pair[0]) list.push({ s: s, i: i });
      });
      h += '<div class="citeDB-set-group"><div class="citeDB-set-gtitle">' + pair[1] + "</div>";
      if (!list.length) {
        h += '<div class="citeDB-set-empty">还没有' + pair[1] + "</div>";
      } else {
        h += '<table class="citeDB-table"><tbody>';
        list.forEach(function (x) {
          const n = Object.keys(x.s.map || {}).filter(function (k) {
            return !!x.s.map[k];
          }).length;
          const origin = x.s.origin === "created" ? "插件新建" : x.s.origin === "template" ? "模板" : "已有库";
          h +=
            "<tr><td>" +
            esc(x.s.name) +
            '</td><td class="citeDB-dim">' +
            origin +
            " · " +
            n +
            " 字段</td>" +
            '<td class="citeDB-set-ops">' +
            '<a class="citeDB-link" data-act="edit" data-i="' + x.i + '">改映射</a> ' +
            '<a class="citeDB-link" data-act="up" data-i="' + x.i + '">上移</a> ' +
            '<a class="citeDB-link" data-act="rename" data-i="' + x.i + '">改名</a> ' +
            '<a class="citeDB-link" data-act="del" data-i="' + x.i + '">移除</a>' +
            "</td></tr>";
        });
        h += "</tbody></table>";
      }
      h += "</div>";
    });
    return h;
  }

  renderSources(box) {
    const self = this;
    box.innerHTML =
      this.sourcesHtml() +
      '<div class="citeDB-set-row">' +
      '<button class="b3-button b3-button--outline" id="cdb-add">用我已有的数据库</button>' +
      '<button class="b3-button b3-button--outline" id="cdb-test">检查数据源</button>' +
      "</div>";
    box.querySelectorAll(".citeDB-link").forEach(function (a) {
      a.addEventListener("click", function () {
        const i = Number(a.getAttribute("data-i"));
        const act = a.getAttribute("data-act");
        const s = self.config.sources[i];
        if (!s) return;
        const rerender = function () {
          self.renderSources(box);
        };
        if (act === "del") {
          if (!window.confirm("移除「" + s.name + "」？\n已插入正文的引注不会被删除，但之后不能再从它取引注。")) return;
          self.config.sources.splice(i, 1);
          self.safe(async function () {
            await self.save();
            rerender();
          });
        } else if (act === "rename") {
          const name = window.prompt("数据源名称", s.name);
          if (!name || !name.trim()) return;
          s.name = name.trim();
          self.safe(async function () {
            await self.save();
            rerender();
          });
        } else if (act === "up") {
          /* 只在同类里上移：决定搜索结果里谁排前面 */
          let prev = -1;
          for (let k = i - 1; k >= 0; k--) {
            if (self.config.sources[k].kind === s.kind) {
              prev = k;
              break;
            }
          }
          if (prev < 0) return;
          self.config.sources.splice(prev, 0, self.config.sources.splice(i, 1)[0]);
          self.safe(async function () {
            await self.save();
            rerender();
          });
        } else if (act === "edit") {
          self.safe(function () {
            return self.sourceDialog(i, rerender);
          });
        }
      });
    });
    const add = box.querySelector("#cdb-add");
    if (add)
      add.addEventListener("click", function () {
        self.safe(function () {
          return self.sourceDialog(null, function () {
            self.renderSources(box);
          });
        });
      });
    const test = box.querySelector("#cdb-test");
    if (test)
      test.addEventListener("click", function () {
        self.safe(function () {
          return self.checkSources();
        });
      });
  }

  /** 逐个读一遍数据源，报行数/失效 */
  async checkSources() {
    const sources = this.config.sources || [];
    if (!sources.length) {
      siyuan.showMessage("还没有数据源", 3000);
      return;
    }
    const bad = [];
    const good = [];
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      try {
        const avID = await this.resolveAv(s.avID);
        const view = (await this.api("/api/av/renderAttributeView", { id: avID, pageSize: 1000, page: 1 })).view;
        const rows = avRows(view, s.map || {});
        if (!rows.length) bad.push(s.name + "（能打开但没有数据）");
        else good.push(s.name + " " + rows.length + " 条");
      } catch (e) {
        bad.push(s.name + "（打不开：" + ((e && e.message) || e) + "）");
      }
    }
    let msg = good.length ? "正常：" + good.join("、") : "";
    if (bad.length) msg += (msg ? "；" : "") + "有问题：" + bad.join("、");
    siyuan.showMessage(msg || "检查完成", 8000, bad.length ? "error" : "");
  }

  /* ---------------- 设置：新建最小库 ---------------- */

  async renderNewLib(box) {
    const self = this;
    let nbs = [];
    try {
      const r = await this.api("/api/notebook/lsNotebooks", {});
      nbs = ((r && r.notebooks) || []).filter(function (n) {
        return !n.closed;
      });
    } catch (e) {
      box.innerHTML = '<div class="citeDB-set-empty">读不到笔记本：' + esc((e && e.message) || e) + "</div>";
      return;
    }
    if (!nbs.length) {
      box.innerHTML = '<div class="citeDB-set-empty">还没有笔记本，先在思源里新建一个</div>';
      return;
    }
    const cur = this.config.newLibNotebook && nbs.some(function (n) { return n.id === self.config.newLibNotebook; })
      ? this.config.newLibNotebook
      : nbs[0].id;
    let opts = "";
    nbs.forEach(function (n) {
      opts += '<option value="' + n.id + '"' + (n.id === cur ? " selected" : "") + ">" + esc(n.name) + "</option>";
    });
    box.innerHTML =
      '<div class="citeDB-field"><label>放到笔记本</label><select id="cdb-nb" class="b3-select">' + opts + "</select></div>" +
      '<div class="citeDB-set-row">' +
      '<button class="b3-button b3-button--text" id="cdb-new-paper">新建文献库</button>' +
      '<button class="b3-button b3-button--text" id="cdb-new-law">新建脚注库（法规）</button>' +
      '<button class="b3-button b3-button--outline" id="cdb-detect">从模板导入 / 识别现有库</button>' +
      "</div>" +
      '<div class="citeDB-set-hint">新建的库：文献库 10 个字段、脚注库 3 个字段，建好即用，不用映射。<br>' +
      '别人给的 .sy 模板：先拖进思源任意笔记本，再点「从模板导入 / 识别现有库」，插件自动认字段。</div>';
    const nbSel = box.querySelector("#cdb-nb");
    nbSel.addEventListener("change", function () {
      self.config.newLibNotebook = nbSel.value;
      self.safe(function () {
        return self.save();
      });
    });
    const run = function (kind) {
      self.safe(async function () {
        self.config.newLibNotebook = nbSel.value;
        await self.save();
        await self.createMinimal(kind, nbSel.value);
        self.renderNewLib(box);
      });
    };
    box.querySelector("#cdb-new-paper").addEventListener("click", function () {
      run("paper");
    });
    box.querySelector("#cdb-new-law").addEventListener("click", function () {
      run("law");
    });
    box.querySelector("#cdb-detect").addEventListener("click", function () {
      self.safe(function () {
        return self.autoDetect();
      });
    });
  }

  /** 纯数据：扫出「像引注库」的数据库（不含已添加的） */
  async detectLibraries() {
    const avs = await this.listAvs();
    const known = {};
    this.config.sources.forEach(function (x) {
      known[x.avID] = 1;
    });
    const cands = [];
    for (let i = 0; i < avs.length; i++) {
      const a = avs[i];
      if (known[a.avID]) continue;
      let cols = [];
      try {
        const view = (await this.api("/api/av/renderAttributeView", { id: a.avID, pageSize: 1, page: 1 })).view;
        cols = avColumns(view);
      } catch (e) {
        continue;
      }
      if (!cols.length) continue;
      const g = guessMap(cols);
      const paperScore = PAPER_ROLES.filter(function (r) {
        return g[r];
      }).length;
      const lawScore = LAW_ROLES.filter(function (r) {
        return g[r];
      }).length;
      const lawish = /法规|条例|办法|通知|法条|文号|效力/.test(
        a.docName + " " + cols.map(function (c) { return c.name; }).join(" ")
      );
      let kind = "";
      if (lawScore >= 2 && (lawish || paperScore < 4)) kind = "law";
      else if (paperScore >= 5) kind = "paper";
      if (!kind) continue;
      const map = {};
      (kind === "law" ? LAW_ROLES : PAPER_ROLES).forEach(function (r) {
        if (g[r]) map[r] = g[r];
      });
      cands.push({ avID: a.avID, name: a.docName, kind: kind, map: map, cols: cols.length });
    }
    return cands;
  }

  /** 识别工作空间里「长得像引注库」的数据库，一键绑进来。
   *  用途：① 别人给的 .sy 模板拖进思源后，不用手对字段；② 老用户换机器后重新挂上自己的库。 */
  async autoDetect() {
    const self = this;
    const cands = await this.detectLibraries();
    if (!cands.length) {
      siyuan.showMessage("没找到可以自动绑定的库。要么先用上面的「新建」，要么点「用我已有的数据库」手动对字段。", 7000);
      return;
    }
    let rows = "";
    cands.forEach(function (c, i) {
      rows +=
        '<div class="citeDB-cand" data-i="' + i + '">' +
        '<label class="citeDB-set-check"><input type="checkbox" data-cb="' + i + '" checked></label>' +
        '<div class="citeDB-cand-main"><div class="citeDB-cand-name">' + esc(c.name) + "</div>" +
        '<div class="citeDB-dim">' + c.cols + " 个字段 · 识别到 " + Object.keys(c.map).length + " 个（" +
        Object.keys(c.map).map(function (r) { return ROLE_LABELS[r]; }).join("/") + "）</div></div>" +
        '<select class="b3-select" data-kind="' + i + '"><option value="paper"' + (c.kind === "paper" ? " selected" : "") + ">文献库</option>" +
        '<option value="law"' + (c.kind === "law" ? " selected" : "") + ">脚注库</option></select>" +
        '<input class="b3-text-field citeDB-set-title" data-name="' + i + '" value="' + esc(c.name) + '">' +
        "</div>";
    });
    const html =
      '<div class="b3-dialog__content citeDB-panel">' +
      '<div class="citeDB-set-hint">勾选要加进来的库。字段已按列名对应好，加完之后可以再改。</div>' +
      '<div class="citeDB-cands">' + rows + "</div>" +
      '<div class="citeDB-actions"><button class="b3-button b3-button--cancel" id="cdx-cancel">取消</button>' +
      '<button class="b3-button b3-button--text" id="cdx-ok">加入</button></div></div>';
    const dialog = new siyuan.Dialog({ title: "识别到的数据库", content: html, width: "680px" });
    const root = dialog.element;
    root.querySelector("#cdx-cancel").addEventListener("click", function () {
      dialog.destroy();
    });
    root.querySelector("#cdx-ok").addEventListener("click", function () {
      let n = 0;
      cands.forEach(function (c, i) {
        const cb = root.querySelector('[data-cb="' + i + '"]');
        if (!cb || !cb.checked) return;
        const kindSel = root.querySelector('[data-kind="' + i + '"]');
        const nameIn = root.querySelector('[data-name="' + i + '"]');
        const kind = (kindSel && kindSel.value) || c.kind;
        const map = {};
        (kind === "law" ? LAW_ROLES : PAPER_ROLES).forEach(function (r) {
          if (c.map[r]) map[r] = c.map[r];
        });
        self.config.sources.push({
          name: (nameIn && nameIn.value.trim()) || c.name,
          avID: c.avID,
          kind: kind,
          origin: "template",
          map: map,
        });
        n++;
      });
      if (!n) {
        siyuan.showMessage("没有勾选任何库", 3000);
        return;
      }
      self.safe(async function () {
        await self.save();
        siyuan.showMessage("已加入 " + n + " 个数据源", 3000);
        dialog.destroy();
        if (self.settingRefresh) self.settingRefresh();
      });
    });
  }

  /** 在指定笔记本里拿到（或建好）承载库的文档 */
  async ensureSourceDoc(notebookID) {
    const found =
      (await this.api("/api/query/sql", {
        stmt: "SELECT id FROM blocks WHERE type = 'd' AND box = '" + notebookID + "' AND content = '引注数据源' LIMIT 1",
      })) || [];
    if (found.length && found[0].id) return found[0].id;
    const md =
      "# 引注数据源\n\n" +
      "本篇文章用来承载「引注 CiteDB」的数据库，请不要删除。\n\n" +
      "写文章时在正文里输入 `/` 再打「引注」，就能从下面的库取条目。\n";
    let lastErr = "";
    /* 新建笔记本后索引要几秒才就绪（metadata is not ready），所以重试 */
    for (let i = 0; i < 15; i++) {
      try {
        const id = await this.api("/api/filetree/createDocWithMd", {
          notebook: notebookID,
          path: "/引注数据源",
          markdown: md,
        });
        if (typeof id === "string" && id) return id;
      } catch (e) {
        lastErr = (e && e.message) || String(e);
        if (lastErr.indexOf("not ready") < 0 && lastErr.indexOf("index") < 0) throw e;
      }
      await new Promise(function (r) {
        setTimeout(r, 1500);
      });
    }
    throw new Error("建文档失败：" + lastErr);
  }

  /** 一键建最小库：插空 AV 块 → 加列 → 删自带「单选」→ 主键改名 → 记映射 */
  async createMinimal(kind, notebookID) {
    const isLaw = kind === "law";
    const lib = isLaw ? MINIMAL_LAW : MINIMAL_PAPER;
    const roleOf = isLaw ? LAW_COL_ROLE : PAPER_COL_ROLE;
    const pkName = lib[0][0];
    const docID = await this.ensureSourceDoc(notebookID);
    const avID = makeId();
    await this.api("/api/block/insertBlock", {
      parentID: docID,
      dataType: "dom",
      data: '<div data-type="NodeAttributeView" data-av-id="' + avID + '" data-av-type="table"></div>',
    });
    await new Promise(function (r) {
      setTimeout(r, 900);
    });
    let keys = await this.avKeys(avID);
    if (!keys.length) throw new Error("数据库没建出来，请重试一次");
    const pk = keys.find(function (k) {
      return k.type === "block";
    });
    let prev = pk ? pk.id : "";
    for (let i = 1; i < lib.length; i++) {
      const keyID = makeId();
      try {
        await this.api("/api/av/addAttributeViewKey", {
          avID: avID,
          keyID: keyID,
          keyName: lib[i][0],
          keyType: lib[i][1],
          keyIcon: "",
          previousKeyID: prev,
        });
        prev = keyID;
      } catch (e) {
        console.warn("[citedb] 建列失败", lib[i][0], e);
      }
    }
    /* 删掉自带的「单选」 */
    keys = await this.avKeys(avID);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].name === "单选") {
        try {
          await this.api("/api/av/removeAttributeViewKey", { avID: avID, keyID: keys[i].id, removeRelationDest: false });
        } catch (e) {
          /* 删不掉也不影响用 */
        }
      }
    }
    /* 主键改名（走未公开事务接口，失败就算了，功能不看列名） */
    if (pk) {
      try {
        await this.api("/api/transactions", {
          reqId: Date.now(),
          transactions: [
            {
              doOperations: [{ action: "updateAttrViewCol", id: pk.id, avID: avID, name: pkName, type: "block" }],
              undoOperations: [],
            },
          ],
        });
      } catch (e) {
        console.warn("[citedb] 主键改名失败（不影响使用）", e);
      }
    }
    /* 按列名记映射 */
    keys = await this.avKeys(avID);
    const map = {};
    keys.forEach(function (k) {
      const role = roleOf[k.name];
      if (role) map[role] = k.id;
    });
    if (!map.title && pk) map.title = pk.id;
    this.config.sources.push({
      name: isLaw ? "脚注库" : "文献库",
      avID: avID,
      kind: kind,
      origin: "created",
      map: map,
    });
    await this.save();
    siyuan.showMessage("已新建" + (isLaw ? "脚注库" : "文献库") + "（" + Object.keys(map).length + " 个字段），在「引注数据源」文档里", 6000);
    return avID;
  }

  async avKeys(avID) {
    try {
      const r = await this.api("/api/av/getAttributeViewKeysByAvID", { avID: avID });
      return Array.isArray(r) ? r : [];
    } catch (e) {
      const view = (await this.api("/api/av/renderAttributeView", { id: avID, pageSize: 1, page: 1 })).view;
      return avColumns(view);
    }
  }

  /* ---------------- 设置：配置导入导出 ---------------- */

  async exportConfig() {
    const text = JSON.stringify(this.config, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "citedb-config.json";
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 3000);
  }

  async importConfig() {
    const self = this;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        self.safe(async function () {
          const obj = JSON.parse(String(reader.result || "{}"));
          if (!obj || !Array.isArray(obj.sources)) throw new Error("不是有效的配置文件");
          self.config = migrateConfig(obj);
          await self.save();
          siyuan.showMessage("已导入 " + self.config.sources.length + " 个数据源", 4000);
        });
      };
      reader.readAsText(file);
    });
    input.click();
  }

  async api(path, data) {
    const res = await siyuan.fetchSyncPost(path, data || {});
    if (!res || res.code !== 0) throw new Error((res && res.msg) || ("接口失败 " + path));
    return res.data;
  }

  /** 统一解析出真正的 avID。
   *  思源的 AV 块 id 与数据库 id 是两个东西（块 id 在 blocks 表里，数据库 id 藏在块的
   *  markdown 里：<div data-type="NodeAttributeView" data-av-id="...">）。传错会拿到一个
   *  自动新建的空壳（只有「主键/单选」两列），表现就是搜不到任何结果。
   */
  /** 法规库某行没绑文档时，按标题在库里回查文档 id */
  async findDocByTitle(title) {
    const t = String(title || "").replace(/[《》]/g, "").trim();
    if (t.length < 4) return "";
    try {
      const rows =
        (await this.api("/api/query/sql", {
          stmt: "SELECT id, content FROM blocks WHERE type = 'd' AND content LIKE '%" + t.replace(/'/g, "''") + "%' LIMIT 5",
        })) || [];
      if (rows.length === 1) return rows[0].id;
      /* 多个命中就挑标题最像的（法规文档名一般以文号开头，正文名在后半段） */
      let best = "";
      let bestLen = 0;
      rows.forEach(function (r) {
        const c = String(r.content || "");
        if (c.indexOf(t) >= 0 && (bestLen === 0 || c.length < bestLen)) {
          best = r.id;
          bestLen = c.length;
        }
      });
      return best;
    } catch (e) {
      return "";
    }
  }

  async resolveAv(id) {
    try {
      const rows = await this.api("/api/query/sql", { stmt: "SELECT markdown FROM blocks WHERE id = '" + id + "'" });
      const md = rows && rows[0] && rows[0].markdown;
      const m = md && /data-av-id="([^"]+)"/.exec(md);
      if (m) return m[1];
    } catch (e) {
      /* 查不到就按原值用 */
    }
    return id;
  }

  /* ---------------- 顶栏面板 ---------------- */
  openPanel() {
    const self = this;
    const sources = this.config.sources || [];
    let rows = "";
    if (!sources.length) {
      rows =
        '<div class="citeDB-empty"><div class="citeDB-empty-title">还没有数据源</div>' +
        '<div class="citeDB-empty-hint">点「添加数据源」：可以一键新建库，也可以用自己的数据库（手动对字段）。</div></div>';
    } else {
      rows = '<table class="citeDB-table"><thead><tr><th>数据源</th><th>类型</th><th>字段</th><th></th></tr></thead><tbody>';
      sources.forEach(function (s, i) {
        const n = Object.keys(s.map || {}).filter(function (k) { return !!s.map[k]; }).length;
        rows +=
          "<tr><td>" + esc(s.name) + "</td><td>" + (s.kind === "law" ? "法规" : "文献") + "</td><td>" + n +
          ' 项</td><td><a class="citeDB-link" data-i="' + i + '" href="javascript:void(0)">移除</a></td></tr>';
      });
      rows += "</tbody></table>";
    }
    const html =
      '<div class="b3-dialog__content citeDB-panel">' +
      '<div class="citeDB-row"><span class="citeDB-label">版本</span><span class="citeDB-value">' + VERSION + "</span></div>" +
      rows +
      '<div class="citeDB-actions">' +
      '<button class="b3-button b3-button--text" id="citeDB-add">添加数据源</button>' +
      '<button class="b3-button b3-button--outline" id="citeDB-search">插入引注</button>' +
      '<button class="b3-button b3-button--outline" id="citeDB-refresh">刷新参考文献</button>' +
      '<button class="b3-button b3-button--outline" id="citeDB-set">设置</button>' +
      "</div>" +
      '<div class="citeDB-tip">写作时输入 <code>/</code> 再打「引注」即可插入。<br>格式、插入行为、数据源管理都在 <b>设置 → 集市 → 引注 CiteDB → 齿轮</b>。</div>' +
      "</div>";

    const dialog = new siyuan.Dialog({ title: "引注 CiteDB", content: html, width: "560px" });
    const root = dialog.element;
    root.querySelector("#citeDB-add").addEventListener("click", function () {
      dialog.destroy();
      self.safe(function () { return self.sourceDialog(null, function () { self.openPanel(); }); });
    });
    root.querySelector("#citeDB-search").addEventListener("click", function () {
      dialog.destroy();
      self.safe(() => self.openSearch(self.lastProtyle));
    });
    root.querySelector("#citeDB-refresh").addEventListener("click", function () {
      dialog.destroy();
      self.safe(() => self.refreshBib(self.lastProtyle));
    });
    root.querySelector("#citeDB-set").addEventListener("click", function () {
      dialog.destroy();
      self.safe(function () { return self.openSettings(); });
    });
    root.querySelectorAll(".citeDB-link").forEach(function (a) {
      a.addEventListener("click", function () {
        const i = Number(a.getAttribute("data-i"));
        self.config.sources.splice(i, 1);
        self.safe(async function () { await self.save(); });
        dialog.destroy();
        self.safe(self.openPanel.bind(self));
      });
    });
  }

  /* ---------------- 数据源：列出所有数据库 ---------------- */
  async listAvs() {
    const avs =
      (await this.api("/api/query/sql", {
        stmt:
          "SELECT b.id AS id, b.markdown AS markdown, d.content AS docName FROM blocks b " +
          "LEFT JOIN blocks d ON b.parent_id = d.id WHERE b.type = 'av' ORDER BY b.updated DESC LIMIT 120",
      })) || [];
    const out = [];
    const seen = {};
    avs.forEach(function (a) {
      const m = a.markdown && /data-av-id="([^"]+)"/.exec(a.markdown);
      const avID = (m && m[1]) || a.id;
      if (seen[avID]) return;
      seen[avID] = 1;
      out.push({ avID: avID, docName: a.docName || a.id });
    });
    return out;
  }

  /** 加 / 改一个「自己的库」：手动对字段，每个字段都显示库里第一行的真实值，
   *  底部实时预览最终引注文字。index 为 null 表示新增。 */
  async sourceDialog(index, done) {
    const self = this;
    const editing = typeof index === "number" ? this.config.sources[index] : null;
    const avs = await this.listAvs();
    if (!avs.length) {
      siyuan.showMessage("这个工作空间里没有数据库：可以先用「新建数据库」建一个", 6000, "error");
      return;
    }
    const used = {};
    (this.config.sources || []).forEach(function (s, i) {
      if (i !== index) used[s.avID] = s.name;
    });
    const state = {
      kind: editing ? editing.kind : "paper",
      avID: editing ? editing.avID : avs[0].avID,
      name: editing ? editing.name : "",
      map: Object.assign({}, (editing && editing.map) || {}),
      cols: [],
      cells: null,
      firstTitle: "",
    };
    const rolesOf = function (kind) {
      return kind === "law" ? LAW_ROLES : PAPER_ROLES;
    };
    let avOpts = "";
    avs.forEach(function (a) {
      avOpts +=
        '<option value="' +
        a.avID +
        '"' +
        (a.avID === state.avID ? " selected" : "") +
        ">" +
        esc(a.docName) +
        "  ·  " +
        esc(a.avID.slice(-6)) +
        (used[a.avID] ? "（已添加）" : "") +
        "</option>";
    });
    const html =
      '<div class="b3-dialog__content citeDB-panel citeDB-src">' +
      '<div class="citeDB-field"><label>数据库</label><select id="cd-av" class="b3-select">' + avOpts + "</select></div>" +
      '<div class="citeDB-field"><label>类型</label><select id="cd-kind" class="b3-select">' +
      '<option value="paper">文献库（图书/期刊）</option><option value="law">脚注库（法规）</option></select></div>' +
      '<div class="citeDB-field"><label>名称</label><input id="cd-name" class="b3-text-field"></div>' +
      '<div class="citeDB-tip" id="cd-msg"></div>' +
      '<div class="citeDB-map" id="cd-map"></div>' +
      '<div class="citeDB-prevbox"><div class="citeDB-prevtitle">预览（用库里第一行）</div><div id="cd-prev">—</div></div>' +
      '<div class="citeDB-actions"><button class="b3-button b3-button--cancel" id="cd-cancel">取消</button>' +
      '<button class="b3-button b3-button--text" id="cd-ok">保存</button></div></div>';
    const dialog = new siyuan.Dialog({
      title: editing ? "修改数据源" : "用我已有的数据库",
      content: html,
      width: "680px",
    });
    const root = dialog.element;
    const avSel = root.querySelector("#cd-av");
    const kindSel = root.querySelector("#cd-kind");
    const nameIn = root.querySelector("#cd-name");
    const mapBox = root.querySelector("#cd-map");
    const msg = root.querySelector("#cd-msg");
    const prevBox = root.querySelector("#cd-prev");
    kindSel.value = state.kind;

    const preview = function () {
      if (!state.cells) {
        prevBox.textContent = "—";
        return;
      }
      try {
        const src = { kind: state.kind, map: state.map, name: state.name };
        const text = citeText(src, state.cells, "", self.config);
        prevBox.innerHTML =
          '<div class="citeDB-previtem">' +
          (state.kind === "law" ? "① " : "[1] ") +
          esc(text) +
          "</div>" +
          '<div class="citeDB-prevhint">（图书页码 / 条号在插入时才填）</div>';
      } catch (e) {
        prevBox.textContent = "预览失败：" + ((e && e.message) || e);
      }
    };

    const renderMap = async function () {
      mapBox.innerHTML = '<div class="citeDB-tip">读取字段…</div>';
      let view;
      try {
        view = (await self.api("/api/av/renderAttributeView", { id: state.avID, pageSize: 20, page: 1 })).view;
      } catch (e) {
        mapBox.innerHTML = '<div class="citeDB-tip">读取失败：' + esc((e && e.message) || e) + "</div>";
        return;
      }
      const cols = avColumns(view);
      /* avRows 丢掉「题名」为空的行，所以要先用猜到的题名兜底，
         否则刚打开对话框时映射还是空的，会把整库读成 0 行 */
      const guess = guessMap(cols);
      const rows = avRows(view, Object.assign({}, guess, state.map));
      state.cols = cols;
      state.cells = rows.length ? rows[0].cells : null;
      state.firstTitle = rows.length ? rows[0].title : "";
      if (!cols.length) {
        mapBox.innerHTML = '<div class="citeDB-tip">这个库里没有字段</div>';
        return;
      }
      if (rows.length && cols.filter(function (c) { return c.type === "block"; }).length) {
        const pk = cols.find(function (c) { return c.type === "block"; });
        if (!String(state.cells[pk.id] || "").trim()) {
          msg.textContent = "提示：这个库的第一行主键是空的，预览可能不准，但保存后不影响使用。";
        }
      } else {
        msg.textContent = "";
      }
      /* 猜列：已有映射不动，只补没有的 */
      const roles = rolesOf(state.kind);
      roles.forEach(function (role) {
        if (!state.map[role] && guess[role]) state.map[role] = guess[role];
      });
      Object.keys(state.map).forEach(function (role) {
        if (roles.indexOf(role) < 0) delete state.map[role];
        else if (!cols.some(function (c) { return c.id === state.map[role]; })) delete state.map[role];
      });

      let rowsHtml = "";
      roles.forEach(function (role) {
        let o = '<option value="">（不填）</option>';
        cols.forEach(function (k) {
          o +=
            '<option value="' +
            k.id +
            '"' +
            (state.map[role] === k.id ? " selected" : "") +
            ">" +
            esc(k.name) +
            " · " +
            k.type +
            "</option>";
        });
        const sample = state.map[role] && state.cells ? String(state.cells[state.map[role]] || "") : "";
        rowsHtml +=
          '<div class="citeDB-maprow"><label>' +
          ROLE_LABELS[role] +
          '</label><select data-role="' +
          role +
          '" class="b3-select">' +
          o +
          '</select><span class="citeDB-sample" data-sample="' +
          role +
          '">' +
          esc(sample.length > 22 ? sample.slice(0, 22) + "…" : sample) +
          "</span></div>";
      });
      mapBox.innerHTML = rowsHtml;
      mapBox.querySelectorAll("select[data-role]").forEach(function (sel) {
        sel.addEventListener("change", function () {
          const role = sel.getAttribute("data-role");
          if (sel.value) state.map[role] = sel.value;
          else delete state.map[role];
          const tag = mapBox.querySelector('[data-sample="' + role + '"]');
          if (tag) {
            const v = sel.value && state.cells ? String(state.cells[sel.value] || "") : "";
            tag.textContent = v.length > 22 ? v.slice(0, 22) + "…" : v;
          }
          preview();
        });
      });
      if (!nameIn.value) nameIn.value = state.name || state.firstTitle || "数据源";
      preview();
    };

    avSel.addEventListener("change", function () {
      state.avID = avSel.value;
      state.map = {};
      state.cols = [];
      state.cells = null;
      const picked = avs.find(function (a) { return a.avID === state.avID; });
      if (picked) nameIn.value = picked.docName;
      self.safe(renderMap);
    });
    kindSel.addEventListener("change", function () {
      state.kind = kindSel.value;
      state.map = {};
      self.safe(async function () {
        await renderMap();
      });
    });
    root.querySelector("#cd-cancel").addEventListener("click", function () {
      dialog.destroy();
    });
    root.querySelector("#cd-ok").addEventListener("click", function () {
      if (!state.map.title) {
        siyuan.showMessage("至少要指定「" + ROLE_LABELS.title + "」对应哪一列", 5000, "error");
        return;
      }
      const rec = {
        name: nameIn.value.trim() || "数据源",
        avID: state.avID,
        kind: state.kind,
        origin: editing ? editing.origin || "existing" : "existing",
        map: state.map,
      };
      if (editing) self.config.sources[index] = rec;
      else self.config.sources.push(rec);
      self.safe(async function () {
        await self.save();
        siyuan.showMessage((editing ? "已更新：" : "已添加：") + rec.name, 3000);
        dialog.destroy();
        if (typeof done === "function") done();
      });
    });
    await renderMap();
  }

  /* ---------------- 搜索插入 ---------------- */
  async openSearch(protyle) {
    this.lastCaret = this.captureCaret();
    const sources = this.config.sources || [];
    if (!sources.length) {
      siyuan.showMessage("请先在引注面板里添加数据源", 5000, "error");
      this.openPanel();
      return;
    }
    const self = this;
    let srcOpts = "";
    [
      ["paper", "文献库"],
      ["law", "脚注库（法规）"],
    ].forEach(function (pair) {
      const list = [];
      sources.forEach(function (s, i) {
        if (s.kind === pair[0]) list.push('<option value="' + i + '">' + esc(s.name) + "</option>");
      });
      if (list.length) srcOpts += '<optgroup label="' + pair[1] + '">' + list.join("") + "</optgroup>";
    });
    const html =
      '<div class="b3-dialog__content citeDB-search">' +
      '<div class="citeDB-bar"><select id="citeDB-src">' + srcOpts + "</select>" +
      '<input id="citeDB-kw" class="b3-text-field" placeholder="输入关键词开始搜索">' +
      "</div>" +
      '<div class="citeDB-bar" id="citeDB-extra" style="display:none">' +
      '<span class="citeDB-law" id="citeDB-lbl">第</span>' +
      '<input id="citeDB-art" class="b3-text-field" placeholder="条号，如 五 或 5（可留空）">' +
      '<span class="citeDB-law" id="citeDB-lbl2">条</span>' +
      '<button id="citeDB-go" class="b3-button b3-button--outline">插入</button></div>' +
      '<div class="citeDB-results" id="citeDB-results"><div class="citeDB-tip">输入关键词开始搜索</div></div>' +
      '<div class="citeDB-tip" id="citeDB-hint">插入的是 [n] 形式的引用，点它可跳回原文献。</div>' +
      "</div>";
    const dialog = new siyuan.Dialog({ title: "插入引注", content: html, width: "660px" });
    const root = dialog.element;
    const srcSel = root.querySelector("#citeDB-src");
    const kw = root.querySelector("#citeDB-kw");
    const art = root.querySelector("#citeDB-art");
    const extra = root.querySelector("#citeDB-extra");
    const goBtn = root.querySelector("#citeDB-go");
    const lbl = root.querySelector("#citeDB-lbl");
    const lbl2 = root.querySelector("#citeDB-lbl2");
    const hint = root.querySelector("#citeDB-hint");
    const box = root.querySelector("#citeDB-results");
    let rows = [];
    let pending = null;

    const srcOf = function () {
      return sources[Number(srcSel.value)];
    };

    /* 法规用「第 __ 条」，图书用「页码 __」，期刊不用（起止页码在库里） */
    const isLawSrc = function () { return srcOf().kind === "law"; };
    const isBookRow = function (row) {
      const src = srcOf();
      if (src.kind === "law") return true;
      const t = src.map && src.map.type ? String(row.cells[src.map.type] || "").trim() : "";
      return !t || t.indexOf("图书") >= 0 || t.indexOf("专著") >= 0 || t.indexOf("论文集") >= 0;
    };
    const needsStep2 = function (row) { return !!row && isBookRow(row); };

    const insertRow = function (row) {
      if (!row) return;
      const src = srcOf();
      const extra = needsStep2(row) ? art.value.trim() : "";
      dialog.destroy();
      self.safe(() => self.doInsert(protyle, src, row, extra));
    };

    const loadRows = async function () {
      const src = srcOf();
      const isLaw = src.kind === "law";
      extra.style.display = "";
      if (isLaw) {
        lbl.textContent = "第";
        lbl2.textContent = "条";
        art.placeholder = "条号，如 五 或 5（可留空）";
      } else {
        lbl.textContent = "页码";
        lbl2.textContent = "";
        art.placeholder = "引用页码，如 45 或 45-46（图书才用，可留空）";
      }
      kw.placeholder = isLaw ? "输入法规关键词，回车选中" : "输入关键词，回车插入";
      art.value = "";
      pending = null;
      box.innerHTML = '<div class="citeDB-tip">读取中…</div>';
      const avID = await self.resolveAv(src.avID);
      const view = (await self.api("/api/av/renderAttributeView", { id: avID, pageSize: 1000, page: 1 })).view;
      /* 自愈：配置里的列 id 可能来自别的库、或该库后来改过列，认不出来就按列名重新猜一次 */
      const cols = avColumns(view);
      /* 自愈：只补失效的列，用户手改过的映射保留 */
      const guess = guessMap(cols);
      let healed = false;
      src.map = src.map || {};
      Object.keys(guess).forEach(function (role) {
        if (!src.map[role] || !cols.some(function (c) { return c.id === src.map[role]; })) {
          src.map[role] = guess[role];
          healed = true;
        }
      });
      if (healed) {
        src.avID = avID;
        await self.save();
      }
      rows = avRows(view, src.map);
      if (!rows.length) {
        box.innerHTML = '<div class="citeDB-tip">这个数据源没读到数据：请到引注面板把它移除后重新「添加数据库」。</div>';
        return;
      }
      render(kw.value.trim());
    };

    const render = function (q) {
      const src = srcOf();
      const list = rows.filter(function (r) {
        if (!q) return true;
        return (Object.keys(r.cells).map(function (k) { return r.cells[k]; }).join(" ") + r.title)
          .toLowerCase()
          .indexOf(q.toLowerCase()) >= 0;
      });
      if (!list.length) {
        box.innerHTML = '<div class="citeDB-tip">没有匹配结果</div>';
        return;
      }
      let h = "";
      list.slice(0, 40).forEach(function (r, i) {
        const sub = [r.cells[src.map.author], r.cells[src.map.year], r.cells[src.map.container], r.cells[src.map.wenhao]]
          .filter(Boolean).join(" · ");
        const idx = rows.indexOf(r);
        h +=
          '<div class="citeDB-item' + (i === 0 ? " citeDB-item--first" : "") +
          (pending && rows.indexOf(pending) === idx ? " citeDB-item--picked" : "") +
          '" data-i="' + idx + '">' +
          '<div class="citeDB-item-title">' +
          esc(src.kind === "law" ? cleanLawTitle(r.title, r.cells[src.map.wenhao]) : r.title) +
          "</div>" +
          '<div class="citeDB-item-sub">' + esc(sub) + "</div></div>";
      });
      box.innerHTML = h;
      box.querySelectorAll(".citeDB-item").forEach(function (el) {
        el.addEventListener("click", function () {
          const row = rows[Number(el.getAttribute("data-i"))];
          if (needsStep2(row) && !art.value.trim()) {
            /* 法规 / 图书：先选中，再填条号或页码，最后按回车或「插入」 */
            pending = row;
            render(kw.value.trim());
            art.value = "";
            art.focus();
            hint.textContent = isLawSrc()
              ? "已选《" + String(cleanLawTitle(row.title, row.cells[srcOf().map.wenhao])).slice(0, 30) + "》：填第几条（可留空），回车或点「插入」。"
              : "已选《" + String(row.title).slice(0, 30) + "》：填引用页码（可留空），回车或点「插入」。";
            return;
          }
          insertRow(row);
        });
      });
    };

    srcSel.addEventListener("change", function () { self.safe(loadRows); });
    kw.addEventListener("input", function () { render(kw.value.trim()); });
    const firstRow = function () {
      const el = box.querySelector(".citeDB-item");
      return el ? rows[Number(el.getAttribute("data-i"))] : null;
    };
    kw.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      const row = pending || firstRow();
      if (!row) return;
      if (needsStep2(row)) {
        /* 法规 / 图书：回车只「选中」，把光标送去条号或页码框，填完再回车才插入 */
        pending = row;
        render(kw.value.trim());
        art.value = "";
        art.focus();
        hint.textContent = isLawSrc()
          ? "已选《" + String(cleanLawTitle(row.title, row.cells[srcOf().map.wenhao])).slice(0, 30) + "》：填第几条（可留空），回车或点「插入」。"
          : "已选《" + String(row.title).slice(0, 30) + "》：填引用页码（可留空），回车或点「插入」。";
        return;
      }
      insertRow(row);
    });
    const confirmLaw = function (e) {
      if (e && e.type === "keydown") {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
      }
      insertRow(pending || firstRow());
    };
    art.addEventListener("keydown", confirmLaw);
    goBtn.addEventListener("click", confirmLaw);
    await loadRows();
    setTimeout(function () { kw.focus(); }, 80);
  }

  /** 打开对话框前把光标位置记下来：万一拿不到 protyle 实例，还能按这个位置插入 */
  captureCaret() {
    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      let node = sel.anchorNode;
      if (!node) return null;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const wys = el && el.closest && el.closest(".protyle-wysiwyg");
      if (!wys) return null;
      return { wys: wys, range: sel.getRangeAt(0).cloneRange() };
    } catch (e) {
      return null;
    }
  }

  insertAtCaret(html) {
    const c = this.lastCaret;
    if (!c || !c.wys || !document.contains(c.wys)) throw new Error("光标不在正文里：请先在正文点一下，或用 / 引注 插入");
    c.wys.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(c.range);
    const ok = document.execCommand("insertHTML", false, html);
    if (!ok) throw new Error("插入被拒绝：请用 / 引注 插入");
  }

  /** 找到「往哪里插」：优先用 protyle，退化到 DOM 里当前打开的文档标题块 */
  resolveTarget(protyle) {
    const self = this;
    const p = protyle || this.lastProtyle;
    if (p && p.block && p.block.rootID) {
      return {
        docID: p.block.rootID,
        insert: function (md, html) {
          if (typeof p.insert === "function") p.insert(md);
          else if (typeof p.insertHTML === "function") p.insertHTML(html);
          else self.insertAtCaret(html);
        },
      };
    }
    const title =
      document.querySelector(".layout__wnd--active .protyle-title") || document.querySelector(".protyle-title");
    if (title && title.getAttribute("data-node-id")) {
      const self = this;
      return {
        docID: title.getAttribute("data-node-id"),
        insert: function (md, html) {
          self.insertAtCaret(html);
        },
      };
    }
    throw new Error("没找到正在编辑的文档：请把光标停在正文里，输入 / 选「引注」");
  }

  /* ---------------- 插入 ---------------- */
  async doInsert(protyle, src, row, extra) {
    const target = this.resolveTarget(protyle);
    const docID = target.docID;
    const attrs = (await this.api("/api/attr/getBlockAttrs", { id: docID })) || {};
    /* 法规走尾注（①②），文献走参考文献（[n]），两本账分开记 */
    const isLaw = src.kind === "law";
    const ATTR = isLaw ? ATTR_NOTES : ATTR_REFS;
    let list = [];
    try {
      list = JSON.parse(attrs[ATTR] || "[]");
    } catch (e) {
      list = [];
    }
    const key = String(extra || "").trim();
    const text = citeText(src, row.cells, key, this.config);
    /* 著者-年制要用条目里的作者和年份，跟条目一起存 */
    const pick = function (role) {
      const kid = src.map && src.map[role];
      return kid && row.cells && row.cells[kid] ? String(row.cells[kid]).trim() : "";
    };
    const author = pick("author");
    const year = pick("year");
    let hit = list.find(function (r) {
      return r.docId === row.docID && String(r.article || "") === key;
    });
    if (!hit) {
      const n = list.reduce(function (m, r) { return Math.max(m, r.n || 0); }, 0) + 1;
      hit = { n: n, docId: row.docID, rowID: row.rowID, linked: !!row.linked, article: key, text: text, src: src.name, author: author, year: year };
      list.push(hit);
    } else {
      /* 这条以前引过：文字按这次的选择重写（书名/文号/译者改过都要跟上） */
      hit.rowID = row.rowID;
      hit.linked = !!row.linked;
      hit.src = src.name;
      hit.text = text;
      hit.author = author;
      hit.year = year;
    }
    /* 法规行理论上都绑了文档；万一没绑（或库结构变了），按标题回查一次，
       否则插进去只有个圈号，既没有双链也不进尾注 */
    if (isLaw && !row.linked) {
      const found = await this.findDocByTitle(row.title || "");
      if (found) {
        row.docID = found;
        row.linked = true;
        hit.docId = found;
        hit.linked = true;
        hit.text = citeText(src, row.cells, key, this.config);
      }
    }
    await this.api("/api/attr/setBlockAttrs", { id: docID, attrs: { [ATTR]: JSON.stringify(list) } });
    const markStyle = fmtOf(this.config).markStyle || "sup";
    /* 著者-年制只对绑定了文档、且条目里有作者的文献生效：
       没有块引可回写或没有作者时退回编号，免得正文出现「（佚名）」 */
    const useAY = !isLaw && markStyle === "authoryear" && !!row.docID && !!authorShort(author);
    const anchor = isLaw ? cir(hit.n) : useAY ? refLabelOf(hit, "authoryear") : "[" + hit.n + "]";
    /* 上标样式下，文献和法规尾注都上标；行内/著者-年都不上标 */
    const wrapSup = markStyle === "sup";
    /* 上标 + 思源原生块引：<sup>((id "[1]"))</sup> / <sup>((id "①"))</sup>
       （试过把 data-type="block-ref" 的 span 塞进 sup，思源会把属性吃掉只剩文字，所以走块引） */
    const mdBody = row.linked ? "((" + row.docID + ' "' + anchor + '"))' : anchor;
    const htmlBody = row.linked
      ? '<span data-type="block-ref" data-id="' + row.docID + '" data-subtype="s">' + anchor + "</span>"
      : anchor;
    const md = wrapSup ? "<sup>" + mdBody + "</sup>" : mdBody;
    const html = wrapSup ? "<sup>" + htmlBody + "</sup>" : htmlBody;
    target.insert(md, html);
    siyuan.showMessage("已插入 " + anchor + (row.linked ? "" : "（纯文字，不能跳转）") + "：" + text, 3000);
    /* 文末已经有列表的，插入后把编号和列表同步一次（没有就先不管，等用户刷新） */
    const self2 = this;
    if (!(this.config.insert && this.config.insert.autoSync !== false)) return;
    try {
      /* 插完就同步一次：文末还没有列表的（第一次插）也要立刻生出来，
         否则法规的「注」不会出现 */
      setTimeout(function () {
        self2.safe(function () {
          return self2.refreshBib({ block: { rootID: docID } }, true);
        });
      }, 700);
    } catch (e) {
      /* 同步失败不影响插入 */
    }
  }

  /* ---------------- 编号重排 ---------------- */

  /** 把文档 kramdown 拆成 [{id, md}]（保持文档顺序） */
  splitBlocks(kd) {
    const out = [];
    const lines = String(kd || "").split("\n");
    let buf = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^\{: id="([^"]+)"[^}]*\}$/.exec(lines[i].trim());
      if (m) {
        out.push({ id: m[1], md: buf.join("\n").trim() });
        buf = [];
      } else {
        buf.push(lines[i]);
      }
    }
    return out;
  }

  /** 正文引用标记的三种写法：((id "[n]"))、[n](siyuan://blocks/id)、[n] */
  static get MARKER() {
    return /\(\((\S+?)\s+"\[?(\d+)\]?"\)\)|\[(\d+)\]\(siyuan:\/\/blocks\/([^\s)]+)\)|\[(\d+)\](?!\()/g;
  }

  /** 按正文出现顺序重排编号（同一条文献复用同一个号），并把新编号写回正文。
   *  只处理「段落 p / 标题 h」两种块：列表项的文字其实在它的 p 子块里，
   *  直接对列表块写回会把兄弟块的属性带进去，思源会报 block ID already exists。 */
  /** 法规尾注的标记：((id "①")) */
  static get NOTE_MARKER() {
    /* 两种写法都认：块引 ((id "①"))，以及早期退化成的纯文字上标 <sup>①</sup>（好把它升回块引） */
    return new RegExp('\\(\\((\\S+?)\\s+"([' + CIRCLED_RANGE + '])"\\)\\)|<sup>([\u2460-\u2473\u3251-\u325f\u32b1-\u32bf])</sup>', "g");
  }

  /** 按正文出现顺序重排编号，并把新编号写回正文。
   *  - 文献：正文 [n]，同一文档只占一个号（不同的引用页码各占一个号）
   *  - 法规：正文 ①，同一条法规的不同条款各占一个号，重复引同一处复用同一个号
   *  只处理「自己就是一块」的 kramdown：列表/引述这类容器块自带子块 ial，
   *  对它写回会把兄弟块 id 带进去，思源会报 block ID already exists。
   */
  async renumber(docID) {
    const kd = ((await this.api("/api/block/getBlockKramdown", { id: docID })) || {}).kramdown || "";
    const attrs = (await this.api("/api/attr/getBlockAttrs", { id: docID })) || {};
    const parse = function (raw) {
      try {
        return JSON.parse(raw || "[]");
      } catch (e) {
        return [];
      }
    };
    const refs = parse(attrs[ATTR_REFS]);
    const notes = parse(attrs[ATTR_NOTES]);

    const bibIDs = {};
    (await this.bibBlocks(docID)).forEach(function (id) {
      bibIDs[id] = 1;
    });

    /* 块的先后顺序：直接用 kramdown 里 { ial } 出现的次序（内联的也算） */
    const order = [];
    const seenID = {};
    const reID = /\{: id="([^"]+)"/g;
    let m;
    while ((m = reID.exec(kd))) {
      if (!seenID[m[1]]) {
        seenID[m[1]] = 1;
        order.push(m[1]);
      }
    }

    /* 每条引用都能落到一个「条目」，条目按文档顺序取号。
       同一 docId 有多条（不同条款/不同页码）时：先找编号正好对得上的，再取还没用过的，最后复用最后一条。 */
    const mkPool = function (arr) {
      const pool = {};
      arr.forEach(function (r, idx) {
        if (!r.docId) return;
        if (!pool[r.docId]) pool[r.docId] = [];
        pool[r.docId].push({ idx: idx, used: false, n: r.n });
      });
      return pool;
    };
    const pickIn = function (pool, docId, oldN) {
      const list = pool[docId];
      if (!list) return null;
      let pick = null;
      for (let q = 0; q < list.length; q++) {
        if (list[q].n === oldN) {
          pick = list[q];
          break;
        }
      }
      for (let q = 0; !pick && q < list.length; q++) {
        if (!list[q].used) pick = list[q];
      }
      if (!pick) pick = list[list.length - 1];
      pick.used = true;
      return pick;
    };

    const outR = [];
    const outN = [];
    const changed = [];
    let nextR = 0;
    let nextN = 0;
    const assignedR = {};
    const assignedN = {};
    const poolR = mkPool(refs);
    const poolN = mkPool(notes);

    /* 文献标记：块引 ((id "[n]")) / ((id "（作者，年：页）"))、老式 [n](siyuan://blocks/id)、纯文字 [n] */
    const REF_RE = new RegExp(
      "\\(\\((\\S+?)\\s+\"([^\"]{1,40})\"\\)\\)" +
        "|\\[(\\d+)\\]\\(siyuan:\\/\\/blocks\\/([^\\s)]+)\\)" +
        "|\\[(\\d+)\\](?!\\()" +
        "|(（[^（）]{1,40}）)",
      "g"
    );
    const style = effectiveMarkStyle(this.config, refs);
    /* 著者-年制里没绑文档的条目只能是纯文字「（作者，年）」，反查表让它能被认回来 */
    const ayIndex = {};
    refs.forEach(function (r) {
      if (authorShort(r.author)) ayIndex[refLabelOf(r, "authoryear")] = r;
    });

    const take = function (kind, docId, oldN) {
      const isRef = kind === "ref";
      const arr = isRef ? refs : notes;
      const pool = isRef ? poolR : poolN;
      const assigned = isRef ? assignedR : assignedN;
      const out = isRef ? outR : outN;
      let base = null;
      let key;
      if (docId && pool[docId]) {
        const pick = pickIn(pool, docId, oldN);
        key = kind + ":" + pick.idx;
        base = arr[pick.idx];
      } else {
        /* 没有 id 的引用（文献库那格没绑文档时）：按正文里的老编号找回条目，
           这样条目文字还在，只是不能点 */
        key = kind + ":#" + oldN;
        for (let q = 0; q < arr.length; q++) {
          if (Number(arr[q].n) === Number(oldN)) {
            base = arr[q];
            break;
          }
        }
      }
      if (!assigned[key]) {
        const entry = base
          ? JSON.parse(JSON.stringify(base))
          : { docId: docId || "", rowID: "", linked: false, article: "", text: "", src: "" };
        if (isRef) {
          nextR += 1;
          entry.n = nextR;
        } else {
          nextN += 1;
          entry.n = nextN;
        }
        if (docId) entry.docId = docId;
        out.push(entry);
        assigned[key] = entry;
      }
      return assigned[key];
    };

    for (let k = 0; k < order.length; k++) {
      const id = order[k];
      if (id === docID || bibIDs[id]) continue;
      let one = "";
      try {
        one = ((await this.api("/api/block/getBlockKramdown", { id: id })) || {}).kramdown || "";
      } catch (e) {
        continue;
      }
      if ((one.match(/\{:\s*id="/g) || []).length > 1) continue;
      if (/type="doc"/.test(one)) continue;
      /* 只去掉块自身的 ial（行首或行尾那条）。行内 ial 必须留着：
         剥掉后残留的 <span> 在回写时会把后面的文字整段吞进标签里 */
      const clean = one
        .replace(/^([ \t]*(?:[-*+]|\d+\.)?[ \t]*)\{:[^}]*\}[ \t]*/, "$1")
        .replace(/\n\{:[^}]*\}[ \t]*$/, "")
        .trim();
      if (!clean) continue;
      let touched = false;

      /* 第一遍：文献标记（编号 [n] 或著者-年（作者，年：页）），按当前样式重写 */
      let md = clean.replace(REF_RE, function (whole, id1, label, n2, linkId, n3, ayText) {
        /* 纯文字「（作者，年：页）」：只认反查表里有的，普通括号文字不碰 */
        if (ayText) {
          const hit0 = ayIndex[whole];
          if (!hit0) return whole;
          const e0 = take("ref", hit0.docId || "", Number(hit0.n) || 0);
          if (!e0) return whole;
          const lab0 = style === "authoryear" ? refLabelOf(e0, "authoryear") : "[" + e0.n + "]";
          const id0 = e0.linked && e0.docId ? e0.docId : "";
          const repl0 = id0 ? "((" + id0 + ' "' + lab0 + '"))' : lab0;
          if (repl0 !== whole) touched = true;
          return repl0;
        }
        const lab = label || "";
        if (lab && new RegExp("^[" + CIRCLED_RANGE + "]$").test(lab)) return whole; /* 法规，下一遍处理 */
        const docId = id1 || linkId || "";
        const oldN = Number(n2 || n3 || (/^\[(\d+)\]$/.exec(lab) || [])[1] || 0);
        const e = take("ref", docId, oldN);
        if (!e) return whole;
        const useAY = style === "authoryear" && !!authorShort(e.author); /* 保险 */
        const newLab = useAY ? refLabelOf(e, "authoryear") : "[" + e.n + "]";
        const id2 = e.linked && e.docId ? e.docId : "";
        const repl = id2 ? "((" + id2 + ' "' + newLab + '"))' : newLab;
        if (repl !== whole) touched = true;
        return repl;
      });

      /* 第二遍：法规尾注 ① */
      md = md.replace(CiteDB.NOTE_MARKER, function (whole, docId, ch, plain) {
        const mark = ch || plain || "";
        const e = take("note", docId || "", cirIndex(mark));
        if (!e) return whole;
        const id2 = e.linked && e.docId ? e.docId : "";
        const repl = id2 ? "((" + id2 + ' "' + cir(e.n) + '"))' : cir(e.n);
        if (repl !== whole) touched = true;
        return repl;
      });

      /* 按当前样式统一上下标：先全部拆掉 <sup>，再视样式重包。
         整条块引必须排在裸编号前面，否则会连引号里的标签一起包（[1] 变成 <sup>[1]</sup>） */
      const cirClass = CIRCLED_RANGE;
      const FULLREF = "\\(\\([^()]{1,80}\"[^\"]{1,40}\"\\)\\)";
      const MARK = "(" + FULLREF + "|\\[\\d+\\]|[" + cirClass + "])";
      let fin = md.replace(new RegExp("<sup>" + MARK + "</sup>", "g"), "$1");
      if (style === "sup") {
        fin = fin.replace(new RegExp("(?<!<sup>)" + MARK, "g"), "<sup>$1</sup>");
      }
      fin = fin.trim();
      if (fin !== clean) touched = true;
      if (touched) changed.push({ id: id, md: fin });
    }

    let failed = 0;
    for (let k = 0; k < changed.length; k++) {
      try {
        await this.api("/api/block/updateBlock", { id: changed[k].id, dataType: "markdown", data: changed[k].md });
      } catch (e) {
        failed += 1;
        console.warn("[citedb] 重排写回失败", changed[k].id, e);
      }
    }
    if (failed) throw new Error("正文编号有 " + failed + " 处没改成，文末没有动，可再点一次刷新");
    return { refs: outR, notes: outN, changed: changed.length };
  }

  /* ---------------- 文末参考文献 ---------------- */

  /** 找出这篇文档里由本插件生成的参考文献块（标题 + 每一条） */
  async bibBlocks(docID) {
    /* 标题块的 type 是 'h'（级别在 subtype 里），不是 h4 */
    const rows =
      (await this.api("/api/query/sql", {
        stmt:
          "SELECT id, type, content FROM blocks WHERE root_id = '" + docID + "' AND (type = 'h' OR type = 'p')",
      })) || [];
    /* 正文里的引用段落，块渲染文本恰好就是「[1]」「①」，千万别当成条目删掉：
       条目一定是「编号 + 空白 + 内容」 */
    const cirRe = new RegExp("^[" + CIRCLED_RANGE + "]\\s+\\S");
    const ins = this.config.insert || INSERT_DEFAULTS;
    const titles = { "参考文献": 1, "注": 1, "注释": 1 };
    if (ins.refTitle) titles[ins.refTitle] = 1;
    if (ins.noteTitle) titles[ins.noteTitle] = 1;
    /* 著者-年制的条目没有编号前缀，按「条目文字」再认一遍 */
    const attrNow = this.__bibAttrs || null;
    let known = {};
    if (attrNow) {
      ["refs", "notes"].forEach(function (k) {
        (attrNow[k] || []).forEach(function (e) {
          const t = String(e.text || "").trim();
          if (t) known[t] = 1;
        });
      });
    }
    const out = [];
    rows.forEach(function (r) {
      const c = (r.content || "").trim();
      if (r.type === "h" && titles[c]) out.push(r.id);
      else if (r.type === "p" && (/^\[\d+\]\s+\S/.test(c) || cirRe.test(c))) out.push(r.id);
      else if (r.type === "p" && Object.keys(known).length) {
        const bare = c.replace(/^(\[\d+\]|[\u2460-\u2473\u3251-\u325f\u32b1-\u32bf])\s+/, "");
        if (known[c] || known[bare]) out.push(r.id);
      }
    });
    return out;
  }


  async refreshBib(protyle, silent) {
    const self = this;
    await this.syncConfigFromDisk();
    const docID = this.resolveTarget(protyle).docID;
    const attrs = (await this.api("/api/attr/getBlockAttrs", { id: docID })) || {};
    const parseNow = function (raw) {
      try {
        return JSON.parse(raw || "[]");
      } catch (e) {
        return [];
      }
    };
    this.__bibAttrs = { refs: parseNow(attrs[ATTR_REFS]), notes: parseNow(attrs[ATTR_NOTES]) };

    /* 1. 先删干净旧的两个区块。上次生成时的块 id 存在属性里（SQL 索引是异步的，
       刚追加的块查不到），再按内容兜底扫一遍。 */
    const tracked = String(attrs[ATTR_BIB] || "")
      .split(",")
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
    const olds = tracked.slice();
    (await this.bibBlocks(docID)).forEach(function (id) {
      if (olds.indexOf(id) < 0) olds.push(id);
    });
    for (let k = 0; k < olds.length; k++) {
      try {
        await this.api("/api/block/deleteBlock", { id: olds[k] });
      } catch (e) {
        /* 已经不存在（tree not found）属正常，忽略 */
        if (String(e && e.message).indexOf("tree not found") < 0) console.warn("[citedb] 删除旧块失败", olds[k], e);
      }
    }

    /* 2. 按正文重新编号（删掉中间的引用，后面的自动往前补；同一处引用复用同一个号） */
    const re = await this.renumber(docID);
    /* 先按库重建文字，再过滤：条目可能正处在「文字待重建」的状态（比如刚从参考文献迁到尾注） */
    let keptR = re.refs;
    let keptN = re.notes;

    /* 条目文字一律按库里最新数据重建：书名/文号/译者改过、旧条目是清洗前存的，都能自动更正 */
    const srcByName = {};
    ((this.config && this.config.sources) || []).forEach(function (x) {
      srcByName[x.name] = x;
    });
    const rowCache = {};
    const rebuild = async (list) => {
      for (let q = 0; q < list.length; q++) {
        const r = list[q];
        const src = srcByName[r.src];
        if (!src || !r.docId) continue;
        try {
          if (!rowCache[src.name]) {
            const av = await this.resolveAv(src.avID);
            const view = (await this.api("/api/av/renderAttributeView", { id: av, pageSize: 1000, page: 1 })).view;
            const cols2 = avColumns(view);
            /* 只在映射里的列已经不存在时补猜，用户手改过的映射不动 */
            const guess2 = guessMap(cols2);
            src.map = src.map || {};
            Object.keys(guess2).forEach(function (role) {
              if (!src.map[role] || !cols2.some(function (c) { return c.id === src.map[role]; })) {
                src.map[role] = guess2[role];
              }
            });
            rowCache[src.name] = avRows(view, src.map);
          }
          const row = rowCache[src.name].find(function (x) { return x.docID === r.docId; });
          if (row) {
            r.text = citeText(src, row.cells, r.article || "", self.config);
            r.rowID = row.rowID;
            r.linked = !!row.linked;
            const cellOf = function (role) {
              const kid = src.map && src.map[role];
              return kid && row.cells[kid] ? String(row.cells[kid]).trim() : "";
            };
            r.author = cellOf("author");
            r.year = cellOf("year");
            /* 年份列空着的（期刊年常写在卷期里）：从条目文字里挑一个 19xx/20xx */
            if (!r.year) {
              const ym = /(?:19|20)\d{2}/.exec(String(r.text || ""));
              if (ym) r.year = ym[0];
            }
          }
        } catch (e) {
          console.warn("[citedb] 重建条目文字失败", r.docId, e);
        }
      }
    };
    await rebuild(keptR);
    await rebuild(keptN);
    keptR = keptR.filter(function (r) { return r.text; });
    keptN = keptN.filter(function (r) { return r.text; });

    /* 条目里刚补上的作者/年份要落盘，正文再排一遍才认得著者-年制 */
    const wantStyle = effectiveMarkStyle(this.config, keptR);
    if (keptR.length || keptN.length) {
      await this.api("/api/attr/setBlockAttrs", {
        id: docID,
        attrs: { [ATTR_REFS]: JSON.stringify(keptR), [ATTR_NOTES]: JSON.stringify(keptN) },
      });
      const again = await this.renumber(docID);
      keptR = again.refs;
      keptN = again.notes;
      keptR = keptR.filter(function (r) { return r.text; });
      keptN = keptN.filter(function (r) { return r.text; });
    }
    /* 想要著者-年但有条目缺作者：整体退回编号，不要一半编号一半（作者，年） */
    if (fmtOf(this.config).markStyle === "authoryear" && wantStyle !== "authoryear") {
      const lack = keptR.filter(function (r) { return !authorShort(r.author); }).length;
      if (!silent) {
        siyuan.showMessage("有 " + lack + " 条文献在库里找不到作者，暂时按编号排；把作者列填上再刷新即可", 6000);
      }
    }

    if (!keptR.length && !keptN.length) {
      await this.api("/api/attr/setBlockAttrs", { id: docID, attrs: { [ATTR_REFS]: "[]", [ATTR_NOTES]: "[]", [ATTR_BIB]: "" } });
      if (!silent) siyuan.showMessage("正文里没有引用了，文末已清空", 3000);
      return;
    }

    /* 3. 生成两个区块：注（法规，①②）在前，参考文献（GB/T 7714）在后。
       块 id 用追加前后 kramdown 的差集拿，可靠（appendBlock 返回的 doOperations 不一定是全部新建块） */
    const kdBefore = ((await this.api("/api/block/getBlockKramdown", { id: docID })) || {}).kramdown || "";
    const ins = this.config.insert || INSERT_DEFAULTS;
    const withLink = function (r) {
      return ins.linkEntries !== false && r.linked && r.docId
        ? "[" + r.text + "](siyuan://blocks/" + r.docId + ")"
        : r.text;
    };
    const markStyle = wantStyle;
    if (markStyle === "authoryear") {
      keptR = keptR.slice().sort(function (a, b) {
        const k = String(authorShort(a.author) || a.text || "").localeCompare(String(authorShort(b.author) || b.text || ""), "zh");
        if (k) return k;
        return String(a.year || "").localeCompare(String(b.year || ""));
      });
    }
    let md = "";
    if (keptN.length) {
      md += "#### " + (ins.noteTitle || "注") + "\n\n";
      keptN.forEach(function (r) {
        const body = withLink(r);
        md += cir(r.n) + " " + body + "\n\n";
      });
    }
    if (keptR.length) {
      md += "#### " + (ins.refTitle || "参考文献") + "\n\n";
      keptR.forEach(function (r) {
        const body = withLink(r);
        md += (markStyle === "authoryear" ? "" : "[" + r.n + "] ") + body + "\n\n";
      });
    }
    await this.api("/api/block/appendBlock", { parentID: docID, dataType: "markdown", data: md.trim() });
    const kdAfter = ((await this.api("/api/block/getBlockKramdown", { id: docID })) || {}).kramdown || "";
    const idOf = function (kd) {
      const set = {};
      const re2 = /\{: id="([^"]+)"/g;
      let m;
      while ((m = re2.exec(kd))) set[m[1]] = 1;
      return set;
    };
    const before = idOf(kdBefore);
    const madeIDs = Object.keys(idOf(kdAfter)).filter(function (id) {
      return !before[id];
    });

    const attrs2 = { [ATTR_REFS]: JSON.stringify(keptR), [ATTR_NOTES]: JSON.stringify(keptN) };
    if (madeIDs.length) attrs2[ATTR_BIB] = madeIDs.join(",");
    await this.api("/api/attr/setBlockAttrs", { id: docID, attrs: attrs2 });
    if (!silent) {
      const parts = [];
      if (keptN.length) parts.push((this.config.insert && this.config.insert.noteTitle ? this.config.insert.noteTitle : "注") + " " + keptN.length + " 条");
      if (keptR.length) parts.push((this.config.insert && this.config.insert.refTitle ? this.config.insert.refTitle : "参考文献") + " " + keptR.length + " 条");
      const styleName = markStyle === "authoryear" ? "著者-出版年" : markStyle === "inline" ? "行内编号" : "上标编号";
      siyuan.showMessage("已更新（" + parts.join("、") + "，" + styleName + "）", 4000);
    }
  }

}

module.exports = CiteDB;
CiteDB.__test = {
  cellText: cellText,
  avRows: avRows,
  avColumns: avColumns,
  citeText: citeText,
  citePaper: citePaper,
  citeLaw: citeLaw,
  guessMap: guessMap,
  renderTpl: renderTpl,
  migrateConfig: migrateConfig,
  defaultConfig: defaultConfig,
  authorList: authorList,
  authorShort: authorShort,
  refLabelOf: refLabelOf,
  esc: esc,
};

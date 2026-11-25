/* 引注 CiteDB — 0.2.0
 * 思源插件运行时是 CommonJS：require("siyuan") + module.exports 导出插件类。
 * 无构建链，改完 python3 tools/deploy.py 部署即生效。
 */
const siyuan = require("siyuan");

const VERSION = "0.2.0";
const DATA_FILE = "citedb.json";
const ATTR_REFS = "custom-citedb-refs";
const ATTR_BIB = "custom-citedb-bib";
const ATTR_NOTES = "custom-citedb-notes"; /* 法规走尾注，单独存一份，别和参考文献混 */

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

/* 字段名 -> 角色 的猜测规则（用户之后可在界面里改） */
const HINT_BY_NAME = [
  ["title", ["题名", "法规标题", "书名", "标题", "文献标题", "名称"]],
  ["author", ["作者", "著者"]],
  ["container", ["出版社/刊名", "出版社", "刊名", "出处", "期刊"]],
  ["year", ["出版年", "年份", "发布日期", "实施日期", "发布年份"]],
  ["issue", ["卷期", "期号"]],
  ["pages", ["页码"]],
  ["wenhao", ["文号", "发文字号"]],
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

/** 按字段名猜测角色 -> keyID */
function guessMap(keys) {
  const guess = {};
  HINT_BY_NAME.forEach(function (pair) {
    const role = pair[0];
    const hit = keys.find(function (k) {
      return pair[1].some(function (h) { return k.name.indexOf(h) >= 0; });
    });
    if (hit) guess[role] = hit.id;
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

/** 责任者：逗号/顿号/分号分隔；超过 3 个只留前 3 个加「, 等」 */
function authorList(s) {
  const arr = String(s || "")
    .split(/[，,；;、\/]+/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x && x !== "等"; });
  if (!arr.length) return "";
  if (arr.length > 3) return arr.slice(0, 3).join(", ") + ", 等";
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

/** 文献库 → 参考文献条目（GB/T 7714-2015 顺序编码制）
 *  图书：贾宁. 贾宁财务讲义[M]. 北京: 中信出版集团, 2020: 45.
 *  译著：惠特默. 高绩效教练: 原书第5版[M]. 林菲, 译. 北京: 机械工业出版社, 2018: 12.
 *  期刊：张某. 增值税留抵退税的风险识别[J]. 税务研究, 2023(9): 55-58.
 *  extra 是引用页码（图书才有，插入时手填）
 */
function citePaper(src, cells, extra) {
  const g = function (role) {
    const k = src.map && src.map[role];
    return k && cells[k] ? String(cells[k]).trim() : "";
  };
  const title = g("title");
  if (!title) return "（缺题名）";
  const code = typeCode(g("type"));
  const authors = authorList(g("author"));
  const sub = g("subtitle");
  const trans = authorList(g("translator"));
  const container = g("container");
  const place = g("place");
  const si = splitIssue(g("issue"), g("year"));
  let out = authors ? authors + ". " : "";
  out += title + (sub ? ": " + sub : "") + "[" + code + "]";
  if (trans) out += ". " + trans + ", 译";
  /* 期刊不写出版地（GB/T 7714 里期刊只到刊名），图书才写「北京: 中信出版集团」 */
  if (container) out += ". " + (place && code !== "J" ? place + ": " : "") + container;
  if (si.year) out += ", " + si.year;
  if (code === "J" && si.issue) out += "(" + si.issue + ")";
  const p = code === "J" ? g("pages") : String(extra || "").trim();
  if (p) out += ": " + p;
  return out + ".";
}

/** 法规 → 尾注文字：《法规名》（文号）第X条。 */
function citeLaw(src, cells, article) {
  const g = function (role) {
    const k = src.map && src.map[role];
    return k && cells[k] ? String(cells[k]).trim() : "";
  };
  const title = g("title");
  if (!title) return "（缺法规名）";
  const wenhao = g("wenhao");
  let out = "《" + cleanLawTitle(title, wenhao) + "》";
  if (wenhao) out += "（" + wenhao + "）";
  const a = String(article || "").trim();
  if (a) out += "第" + a + "条";
  return out + "。";
}

function citeText(src, cells, extra) {
  if (src.kind === "law") return citeLaw(src, cells, extra);
  return citePaper(src, cells, extra);
}

/* ---------------- 插件 ---------------- */

class CiteDB extends siyuan.Plugin {
  constructor(options) {
    super(options);
    this.config = { version: 1, sources: [] };
    this.lastProtyle = null;
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
      if (saved && saved.sources) this.config = saved;
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
        '<div class="citeDB-empty-hint">点「添加数据库」，选文献库或法规库，字段会自动对应好。</div></div>';
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
      '<button class="b3-button b3-button--text" id="citeDB-add">添加数据库</button>' +
      '<button class="b3-button b3-button--outline" id="citeDB-search">插入引注</button>' +
      '<button class="b3-button b3-button--outline" id="citeDB-refresh">刷新参考文献</button>' +
      "</div>" +
      '<div class="citeDB-tip">写作时输入 <code>/</code> 再打「引注」即可插入。</div>' +
      "</div>";

    const dialog = new siyuan.Dialog({ title: "引注 CiteDB", content: html, width: "560px" });
    const root = dialog.element;
    root.querySelector("#citeDB-add").addEventListener("click", function () {
      dialog.destroy();
      self.safe(self.openAddSource.bind(self));
    });
    root.querySelector("#citeDB-search").addEventListener("click", function () {
      dialog.destroy();
      self.safe(() => self.openSearch(self.lastProtyle));
    });
    root.querySelector("#citeDB-refresh").addEventListener("click", function () {
      dialog.destroy();
      self.safe(() => self.refreshBib(self.lastProtyle));
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

  /* ---------------- 添加数据源 ---------------- */
  async openAddSource() {
    const avs = await this.api("/api/query/sql", {
      stmt:
        "SELECT b.id AS id, b.markdown AS markdown, d.content AS docName FROM blocks b " +
        "LEFT JOIN blocks d ON b.parent_id = d.id WHERE b.type = 'av' ORDER BY b.updated DESC LIMIT 80",
    });
    if (!avs || !avs.length) {
      siyuan.showMessage("这个工作空间里没有属性视图（数据库）", 5000, "error");
      return;
    }
    const self = this;
    let opts = "";
    const avMap = {};
    avs.forEach(function (a) {
      const m = a.markdown && /data-av-id="([^"]+)"/.exec(a.markdown);
      const avID = (m && m[1]) || a.id;
      if (avMap[avID]) return;
      avMap[avID] = true;
      const label = (a.docName || a.id) + "  ·  " + avID.slice(-6);
      opts += '<option value="' + avID + '">' + esc(label) + "</option>";
    });
    const html =
      '<div class="b3-dialog__content citeDB-panel">' +
      '<div class="citeDB-field"><label>数据库</label><select id="citeDB-av">' + opts + "</select></div>" +
      '<div class="citeDB-field"><label>名称</label><input id="citeDB-name" class="b3-text-field"></div>' +
      '<div class="citeDB-field"><label>类型</label><select id="citeDB-kind">' +
      '<option value="paper">文献（图书/期刊）</option><option value="law">法规</option></select></div>' +
      '<div class="citeDB-map" id="citeDB-map"></div>' +
      '<div class="citeDB-actions"><button class="b3-button b3-button--cancel" id="citeDB-cancel">取消</button>' +
      '<button class="b3-button b3-button--text" id="citeDB-ok">保存</button></div>' +
      "</div>";
    const dialog = new siyuan.Dialog({ title: "添加数据源", content: html, width: "620px" });
    const root = dialog.element;
    const avSel = root.querySelector("#citeDB-av");
    const nameIn = root.querySelector("#citeDB-name");
    const kindSel = root.querySelector("#citeDB-kind");
    const mapBox = root.querySelector("#citeDB-map");

    let viewName = "";
    const renderMap = async function () {
      mapBox.innerHTML = '<div class="citeDB-tip">读取字段…</div>';
      let keys;
      try {
        const view = (await self.api("/api/av/renderAttributeView", { id: avSel.value, pageSize: 1, page: 1 })).view;
        keys = avColumns(view);
        viewName = avSel.options[avSel.selectedIndex].text.replace(/\s+·\s+\S+$/, "");
        if (!keys.length || (keys.length === 2 && keys[0].name === "主键")) {
          siyuan.showMessage("这个库里没有真实数据（可能不是数据库块），换一个试试", 6000, "error");
        }
      } catch (e) {
        mapBox.innerHTML = '<div class="citeDB-tip">读取失败：' + esc(e.message) + "</div>";
        return;
      }
      const guess = guessMap(keys);
      let rowsHtml = "";
      Object.keys(ROLE_LABELS).forEach(function (role) {
        let o = '<option value="">（不填）</option>';
        keys.forEach(function (k) {
          o += '<option value="' + k.id + '"' + (guess[role] === k.id ? " selected" : "") + ">" + esc(k.name) + " · " + k.type + "</option>";
        });
        rowsHtml += '<div class="citeDB-field"><label>' + ROLE_LABELS[role] + '</label><select data-role="' + role + '">' + o + "</select></div>";
      });
      mapBox.innerHTML = rowsHtml;
      if (!nameIn.dataset.touched) nameIn.value = (viewName || "") || nameIn.value;
    };
    nameIn.addEventListener("input", function () { nameIn.dataset.touched = "1"; });
    avSel.addEventListener("change", function () { self.safe(renderMap); });
    root.querySelector("#citeDB-cancel").addEventListener("click", function () { dialog.destroy(); });
    root.querySelector("#citeDB-ok").addEventListener("click", function () {
      const map = {};
      mapBox.querySelectorAll("select[data-role]").forEach(function (s) {
        if (s.value) map[s.getAttribute("data-role")] = s.value;
      });
      if (!map.title) {
        siyuan.showMessage("至少要指定「题名」对应哪一列", 5000, "error");
        return;
      }
      self.config.sources.push({ name: nameIn.value.trim() || "数据源", avID: avSel.value, kind: kindSel.value, map: map });
      self.safe(async function () {
        await self.save();
        siyuan.showMessage("已添加：" + nameIn.value, 3000);
        dialog.destroy();
        self.openPanel();
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
    const srcOpts = sources
      .map(function (s, i) { return '<option value="' + i + '">' + esc(s.name) + "</option>"; })
      .join("");
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
      const mapOk = !!(src.map && src.map.title && cols.some(function (c) { return c.id === src.map.title; }));
      if (!mapOk && cols.length) {
        src.map = guessMap(cols);
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
    const text = citeText(src, row.cells, key);
    let hit = list.find(function (r) {
      return r.docId === row.docID && String(r.article || "") === key;
    });
    if (!hit) {
      const n = list.reduce(function (m, r) { return Math.max(m, r.n || 0); }, 0) + 1;
      hit = { n: n, docId: row.docID, rowID: row.rowID, linked: !!row.linked, article: key, text: text, src: src.name };
      list.push(hit);
    } else {
      /* 这条以前引过：文字按这次的选择重写（书名/文号/译者改过都要跟上） */
      hit.rowID = row.rowID;
      hit.linked = !!row.linked;
      hit.src = src.name;
      hit.text = text;
    }
    await this.api("/api/attr/setBlockAttrs", { id: docID, attrs: { [ATTR]: JSON.stringify(list) } });
    const anchor = isLaw ? cir(hit.n) : "[" + hit.n + "]";
    /* 上标 + 思源原生块引：<sup>((id "[1]"))</sup> / <sup>((id "①"))</sup>
       （试过把 data-type="block-ref" 的 span 塞进 sup，思源会把属性吃掉只剩文字，所以走块引） */
    const md = row.linked
      ? "<sup>((" + row.docID + ' \"' + anchor + '\"))</sup>'
      : "<sup>" + anchor + "</sup>";
    const html = row.linked
      ? '<sup><span data-type="block-ref" data-id="' + row.docID + '" data-subtype="s">' + anchor + "</span></sup>"
      : "<sup>" + anchor + "</sup>";
    target.insert(md, html);
    siyuan.showMessage("已插入 " + anchor + "：" + text, 3000);
    /* 文末已经有列表的，插入后把编号和列表同步一次（没有就先不管，等用户刷新） */
    const self2 = this;
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
    return new RegExp('\\(\\((\\S+?)\\s+"([' + CIRCLED_RANGE + '])"\\)\\)', "g");
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
        assigned[key] = entry.n;
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
      const clean = one.replace(/\{:[^}]*\}/g, "").trim();
      if (!clean) continue;
      let touched = false;

      /* 第一遍：参考文献 [n] */
      let md = clean.replace(CiteDB.MARKER, function (whole, refId, n1, n2, linkId, n3) {
        const docId = refId || linkId || "";
        const oldN = Number(refId ? n1 : n2 || n3);
        const n = take("ref", docId, oldN);
        if (!n) return whole;
        const repl = docId ? "((" + docId + ' "[' + n + ']"))' : "[" + n + "]";
        if (repl !== whole) touched = true;
        return repl;
      });

      /* 第二遍：法规尾注 ① */
      md = md.replace(CiteDB.NOTE_MARKER, function (whole, docId, ch) {
        const n = take("note", docId, cirIndex(ch));
        if (!n) return whole;
        const repl = "((" + docId + ' "' + cir(n) + '"))';
        if (repl !== whole) touched = true;
        return repl;
      });

      /* 统一成上标：老引用（当初没上标的）也一起升上来 */
      const cirClass = CIRCLED_RANGE;
      const fin = md
        .replace(new RegExp("(?<!<sup>)(\\(\\([^()]{1,80}\"(?:\\[\\d+\\]|[" + cirClass + "])\"\\)\\))", "g"), "<sup>$1</sup>")
        .replace(/(?<!<sup>)\[(\d+)\](?!\()/g, "<sup>[$1]</sup>")
        .trim();
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
    const out = [];
    rows.forEach(function (r) {
      const c = (r.content || "").trim();
      if (r.type === "h" && (c === "参考文献" || c === "注" || c === "注释")) out.push(r.id);
      else if (r.type === "p" && (/^\[\d+\]\s+\S/.test(c) || cirRe.test(c))) out.push(r.id);
    });
    return out;
  }


  async refreshBib(protyle, silent) {
    const docID = this.resolveTarget(protyle).docID;
    const attrs = (await this.api("/api/attr/getBlockAttrs", { id: docID })) || {};

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
    ((this.data && this.data.sources) || []).forEach(function (x) {
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
            if (!(src.map && src.map.title && cols2.some(function (c) { return c.id === src.map.title; }))) {
              src.map = guessMap(cols2);
            }
            rowCache[src.name] = avRows(view, src.map);
          }
          const row = rowCache[src.name].find(function (x) { return x.docID === r.docId; });
          if (row) {
            r.text = citeText(src, row.cells, r.article || "");
            r.rowID = row.rowID;
            r.linked = !!row.linked;
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

    const self = this;
    if (!keptR.length && !keptN.length) {
      await this.api("/api/attr/setBlockAttrs", { id: docID, attrs: { [ATTR_REFS]: "[]", [ATTR_NOTES]: "[]", [ATTR_BIB]: "" } });
      if (!silent) siyuan.showMessage("正文里没有引用了，文末已清空", 3000);
      return;
    }

    /* 3. 生成两个区块：注（法规，①②）在前，参考文献（GB/T 7714）在后。
       块 id 用追加前后 kramdown 的差集拿，可靠（appendBlock 返回的 doOperations 不一定是全部新建块） */
    const kdBefore = ((await this.api("/api/block/getBlockKramdown", { id: docID })) || {}).kramdown || "";
    let md = "";
    if (keptN.length) {
      md += "#### 注\n\n";
      keptN.forEach(function (r) {
        const body = r.linked && r.docId ? "[" + r.text + "](siyuan://blocks/" + r.docId + ")" : r.text;
        md += cir(r.n) + " " + body + "\n\n";
      });
    }
    if (keptR.length) {
      md += "#### 参考文献\n\n";
      keptR.forEach(function (r) {
        const body = r.linked && r.docId ? "[" + r.text + "](siyuan://blocks/" + r.docId + ")" : r.text;
        md += "[" + r.n + "] " + body + "\n\n";
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
      if (keptN.length) parts.push("注 " + keptN.length + " 条");
      if (keptR.length) parts.push("参考文献 " + keptR.length + " 条");
      siyuan.showMessage("已更新（" + parts.join("、") + "，编号已重排）", 3000);
    }
  }

}

module.exports = CiteDB;
CiteDB.__test = { cellText: cellText, avRows: avRows, avColumns: avColumns, citeText: citeText, guessMap: guessMap, esc: esc };

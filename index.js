/* 引注 CiteDB — 0.2.0
 * 思源插件运行时是 CommonJS：require("siyuan") + module.exports 导出插件类。
 * 无构建链，改完 python3 tools/deploy.py 部署即生效。
 */
const siyuan = require("siyuan");

const VERSION = "0.2.0";
const DATA_FILE = "citedb.json";
const ATTR_REFS = "custom-citedb-refs";
const ATTR_BIB = "custom-citedb-bib";

const ICON_SVG = `<symbol id="iconCiteDB" viewBox="0 0 32 32"><rect x="0.6" y="0.6" width="30.8" height="30.8" rx="7.5" fill="#F0872A"/><g transform="translate(5.401,23.771) scale(0.01096,-0.01096)"><path d="M1526 1667H1820V-249H1526ZM432 637H1184L1151 120Q1141 -15 1088.5 -99.5Q1036 -184 943.0 -216.5Q850 -249 386 -249Q350 -97 304 41Q456 33 607 33Q729 33 773.5 51.5Q818 70 833.0 114.0Q848 158 862 379H114L180 1115H884V1343H122V1601H1178V857H448Z" fill="#FFFFFF"/></g></symbol>`;

const ROLE_LABELS = {
  title: "题名",
  author: "作者",
  container: "出处（出版社/刊名）",
  year: "年份",
  issue: "卷期",
  pages: "页码",
  wenhao: "文号",
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
    ((row.cells) || []).forEach(function (c) {
      const v = c.value || {};
      const key = v.keyID || c.keyID || c.id;
      if (!key) return;
      cells[key] = cellText(v);
      if (!docID && v.block && v.block.id) docID = v.block.id;
    });
    const title = (map.title && cells[map.title]) || "";
    if (!String(title).trim()) return;
    out.push({
      rowID: row.id,
      docID: docID || row.id,
      linked: !!docID,
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

/** 生成一条引注文字 */
function citeText(src, cells, article) {
  const g = function (role) {
    const k = src.map && src.map[role];
    return k && cells[k] ? String(cells[k]).trim() : "";
  };
  const title = g("title");
  if (!title) return "见（缺题名）";
  if (src.kind === "law") {
    let s = "《" + title + "》";
    const wenhao = g("wenhao");
    if (wenhao) s += "（" + wenhao + "）";
    if (article) s += "第" + article + "条";
    return "见" + s + "。";
  }
  const parts = [];
  const author = g("author");
  parts.push((author ? author + "：" : "") + "《" + title + "》");
  const container = g("container");
  if (container) parts.push(container);
  let year = g("year");
  let issue = g("issue");
  /* 卷期里常写成「2026（9）」，把年份拆出来，避免出现 (2026（9）) 这种叠字 */
  const m = issue.match(/^\s*(\d{4})\s*[（(]?\s*([^）)]*?)\s*[）)]?\s*$/);
  if (m) {
    if (!year) year = m[1];
    issue = (m[2] || "").trim();
  }
  let tail = year;
  if (issue) tail += "(" + issue + ")";
  const pages = g("pages");
  if (pages) tail += (tail ? "：" : "") + pages;
  if (tail) parts.push(tail);
  return "见" + parts.join("，") + "。";
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
      this.eventBus.on("loaded-protyle-static", function (e) {
        if (e && e.detail && e.detail.protyle) self.lastProtyle = e.detail.protyle;
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
        "SELECT b.id AS id, d.content AS docName FROM blocks b LEFT JOIN blocks d ON b.parent_id = d.id " +
        "WHERE b.type = 'av' ORDER BY b.updated DESC LIMIT 80",
    });
    if (!avs || !avs.length) {
      siyuan.showMessage("这个工作空间里没有属性视图（数据库）", 5000, "error");
      return;
    }
    const self = this;
    let opts = "";
    avs.forEach(function (a) {
      opts += '<option value="' + a.id + '">' + esc(a.docName || a.id) + "  ·  " + a.id.slice(-6) + "</option>";
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
      '<input id="citeDB-kw" class="b3-text-field" placeholder="输入关键词，回车插入第一条">' +
      "</div>" +
      '<div class="citeDB-bar" id="citeDB-extra" style="display:none">' +
      '<input id="citeDB-art" class="b3-text-field" placeholder="条号（可留空，如 五 或 5）"></div>' +
      '<div class="citeDB-results" id="citeDB-results"><div class="citeDB-tip">输入关键词开始搜索</div></div>' +
      '<div class="citeDB-tip">插入的是 [n] 形式的引用，点它可跳回原文献。</div>' +
      "</div>";
    const dialog = new siyuan.Dialog({ title: "插入引注", content: html, width: "660px" });
    const root = dialog.element;
    const srcSel = root.querySelector("#citeDB-src");
    const kw = root.querySelector("#citeDB-kw");
    const art = root.querySelector("#citeDB-art");
    const extra = root.querySelector("#citeDB-extra");
    const box = root.querySelector("#citeDB-results");
    let rows = [];

    const loadRows = async function () {
      const src = sources[Number(srcSel.value)];
      extra.style.display = src.kind === "law" ? "" : "none";
      box.innerHTML = '<div class="citeDB-tip">读取中…</div>';
      const view = (await self.api("/api/av/renderAttributeView", { id: src.avID, pageSize: 1000, page: 1 })).view;
      rows = avRows(view, src.map);
      render(kw.value.trim());
    };

    const render = function (q) {
      const src = sources[Number(srcSel.value)];
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
        h +=
          '<div class="citeDB-item' + (i === 0 ? " citeDB-item--first" : "") + '" data-i="' + rows.indexOf(r) + '">' +
          '<div class="citeDB-item-title">' + esc(r.title) + "</div>" +
          '<div class="citeDB-item-sub">' + esc(sub) + "</div></div>";
      });
      box.innerHTML = h;
      box.querySelectorAll(".citeDB-item").forEach(function (el) {
        el.addEventListener("click", function () {
          const row = rows[Number(el.getAttribute("data-i"))];
          const article = art.value.trim();
          dialog.destroy();
          self.safe(() => self.doInsert(protyle, src, row, article));
        });
      });
    };

    srcSel.addEventListener("change", function () { self.safe(loadRows); });
    kw.addEventListener("input", function () { render(kw.value.trim()); });
    kw.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = box.querySelector(".citeDB-item");
        if (first) first.click();
      }
    });
    await loadRows();
    setTimeout(function () { kw.focus(); }, 80);
  }

  /* ---------------- 插入 ---------------- */
  async doInsert(protyle, src, row, article) {
    const p = protyle || this.lastProtyle;
    if (!p || !p.block) throw new Error("请先点进要插入引用的文档");
    const docID = p.block.rootID;
    const attrs = (await this.api("/api/attr/getBlockAttrs", { id: docID })) || {};
    let refs = [];
    try { refs = JSON.parse(attrs[ATTR_REFS] || "[]"); } catch (e) { refs = []; }
    const text = citeText(src, row.cells, article);
    let hit = refs.find(function (r) { return r.docId === row.docID && (r.article || "") === (article || ""); });
    if (!hit) {
      const n = refs.reduce(function (m, r) { return Math.max(m, r.n || 0); }, 0) + 1;
      hit = { n: n, docId: row.docID, rowID: row.rowID, linked: !!row.linked, article: article || "", text: text, src: src.name };
      refs.push(hit);
      await this.api("/api/attr/setBlockAttrs", { id: docID, attrs: { [ATTR_REFS]: JSON.stringify(refs) } });
    }
    const md = row.linked ? "[" + hit.n + "](siyuan://blocks/" + row.docID + ")" : "[" + hit.n + "]";
    if (typeof p.insert === "function") {
      p.insert(md);
    } else if (typeof p.insertHTML === "function") {
      p.insertHTML(
        '<span data-type="block-ref" data-id="' + row.docID + '" data-subtype="s">' + hit.n + "</span>"
      );
    } else {
      throw new Error("当前版本不支持直接插入，请手动粘贴：" + md);
    }
    siyuan.showMessage("已插入 [" + hit.n + "]：" + text, 3000);
  }

  /* ---------------- 文末参考文献 ---------------- */
  async refreshBib(protyle) {
    const p = protyle || this.lastProtyle;
    if (!p || !p.block) throw new Error("请先在文档里点一下，再刷新参考文献");
    const docID = p.block.rootID;
    const attrs = (await this.api("/api/attr/getBlockAttrs", { id: docID })) || {};
    let refs = [];
    try { refs = JSON.parse(attrs[ATTR_REFS] || "[]"); } catch (e) { refs = []; }
    if (!refs.length) {
      siyuan.showMessage("这篇文档还没有引用", 3000);
      return;
    }
    refs.sort(function (a, b) { return a.n - b.n; });
    const old = attrs[ATTR_BIB];
    if (old) {
      try { await this.api("/api/block/deleteBlock", { id: old }); } catch (e) { /* 已不存在 */ }
    }
    let md = "#### 参考文献\n\n";
    refs.forEach(function (r) {
      const body = r.linked && r.docId ? "[" + r.text + "](siyuan://blocks/" + r.docId + ")" : r.text;
      md += "[" + r.n + "] " + body + "\n\n";
    });
    const ret = await this.api("/api/block/appendBlock", { parentID: docID, dataType: "markdown", data: md.trim() });
    let bibID = "";
    if (typeof ret === "string") bibID = ret;
    else if (Array.isArray(ret)) {
      const ops = (ret[0] && ret[0].doOperations) || [];
      const op = ops.find(function (o) { return o && o.id && (o.action === "insert" || !o.action); });
      if (op) bibID = op.id;
      else if (ops[0] && ops[0].id) bibID = ops[0].id;
    } else if (ret && typeof ret.id === "string") bibID = ret.id;
    if (!bibID) {
      const found = await this.api("/api/query/sql", {
        stmt: "SELECT id FROM blocks WHERE root_id = '" + docID + "' AND type = 'h4' AND content = '参考文献' ORDER BY created DESC LIMIT 1",
      });
      if (found && found[0]) bibID = found[0].id;
    }
    if (bibID) await this.api("/api/attr/setBlockAttrs", { id: docID, attrs: { [ATTR_BIB]: bibID } });
    siyuan.showMessage("参考文献已更新（" + refs.length + " 条）", 3000);
  }
}

module.exports = CiteDB;
CiteDB.__test = { cellText: cellText, avRows: avRows, avColumns: avColumns, citeText: citeText, guessMap: guessMap, esc: esc };

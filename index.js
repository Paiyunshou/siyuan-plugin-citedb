/* 引注 CiteDB — 0.1.0 骨架
 * 思源插件运行时是 CommonJS：必须 require("siyuan")、module.exports 导出插件类。
 * 本文件不依赖构建工具，改完部署即可生效。
 */
const siyuan = require("siyuan");

const VERSION = "0.1.0";
const DATA_FILE = "citedb.json";

const ICON_SVG = `<symbol id="iconCiteDB" viewBox="0 0 32 32"><rect x="0.6" y="0.6" width="30.8" height="30.8" rx="7.5" fill="#F0872A"/><g transform="translate(5.401,23.771) scale(0.01096,-0.01096)"><path d="M1526 1667H1820V-249H1526ZM432 637H1184L1151 120Q1141 -15 1088.5 -99.5Q1036 -184 943.0 -216.5Q850 -249 386 -249Q350 -97 304 41Q456 33 607 33Q729 33 773.5 51.5Q818 70 833.0 114.0Q848 158 862 379H114L180 1115H884V1343H122V1601H1178V857H448Z" fill="#FFFFFF"/></g></symbol>`;

const FALLBACK = {
  topbarTip: "引注：从数据库插入引用",
  panelTitle: "引注 CiteDB",
  statusNoSource: "尚未配置数据源",
  statusHint: "请配置：数据库（属性视图）+ 字段映射 + 引文模板。",
  insert: "插入引注",
  refresh: "刷新参考文献",
  wip: "引注功能开发中（L1）",
  version: "版本",
};

class CiteDB extends siyuan.Plugin {
  async onload() {
    try {
      this.config = (await this.loadData(DATA_FILE)) || { version: 1, sources: [] };
      this.injectIcon();
      this.addTopBar({
        icon: "iconCiteDB",
        title: this.t("topbarTip"),
        position: "right",
        callback: () => this.openPanel(),
      });
      this.addCommand({ langKey: "openPanel", hotkey: "", callback: () => this.openPanel() });
      console.log("[citedb] loaded", VERSION);
    } catch (e) {
      console.error("[citedb] onload failed", e);
    }
  }

  onunload() {
    const el = document.getElementById("citeDB-symbols");
    if (el) el.remove();
  }

  t(key) {
    return (this.i18n && this.i18n[key]) || FALLBACK[key] || key;
  }

  injectIcon() {
    if (document.getElementById("citeDB-symbols")) return;
    const wrap = document.createElement("div");
    wrap.id = "citeDB-symbols";
    wrap.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + ICON_SVG + "</svg>";
    document.body.appendChild(wrap);
  }

  esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async openPanel() {
    try {
      if (!document.getElementById("citeDB-symbols")) this.injectIcon();
      const sources = (this.config && this.config.sources) || [];
      let kernel = "";
      try {
        const res = await siyuan.fetchSyncPost("/api/system/version", {});
        if (res && res.code === 0) kernel = res.data || "";
      } catch (err) {
        /* 内核不可达时忽略 */
      }

      let body = "";
      if (sources.length) {
        body += '<ul class="citeDB-sources">';
        sources.forEach((s) => {
          body +=
            "<li class=\"citeDB-source\"><b>" +
            this.esc(s.name || s.avID) +
            '</b><span>' +
            this.esc(s.template || "") +
            "</span></li>";
        });
        body += "</ul>";
      } else {
        body +=
          '<div class="citeDB-empty"><div class="citeDB-empty-title">' +
          this.esc(this.t("statusNoSource")) +
          '</div><div class="citeDB-empty-hint">' +
          this.esc(this.t("statusHint")) +
          "</div></div>";
      }

      const html =
        '<div class="b3-dialog__content citeDB-panel">' +
        '<div class="citeDB-row"><span class="citeDB-label">' +
        this.esc(this.t("version")) +
        '</span><span class="citeDB-value">' +
        VERSION +
        (kernel ? " · SiYuan " + this.esc(kernel) : "") +
        "</span></div>" +
        body +
        '<div class="citeDB-actions">' +
        '<button class="b3-button b3-button--outline" disabled>' +
        this.esc(this.t("insert")) +
        "</button>" +
        '<button class="b3-button b3-button--outline" disabled>' +
        this.esc(this.t("refresh")) +
        "</button>" +
        '<span class="citeDB-wip">' +
        this.esc(this.t("wip")) +
        "</span></div>" +
        '<div class="citeDB-footer"><a href="https://github.com/Paiyunshou/siyuan-plugin-citedb" target="_blank">GitHub</a></div>' +
        "</div>";

      if (siyuan.Dialog) {
        new siyuan.Dialog({ title: this.t("panelTitle"), content: html, width: "520px" });
        return;
      }
      siyuan.showMessage("引注：当前版本缺少 Dialog 组件，请升级思源", 6000, "error");
    } catch (e) {
      console.error("[citedb] openPanel failed", e);
      try {
        siyuan.showMessage("引注面板打开失败：" + ((e && e.message) || e), 8000, "error");
      } catch (err) {
        /* ignore */
      }
    }
  }
}

module.exports = CiteDB;

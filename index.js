/* 引注 CiteDB — 0.1.0 骨架
 * 思源插件运行时是 CommonJS：必须 require("siyuan")、module.exports 导出插件类。
 * 本文件不依赖任何构建工具，改完直接部署即可。
 */
const siyuan = require("siyuan");

const DATA_FILE = "citedb.json";
const ICON_SYMBOL = "iconCiteDB";

const ICON_SVG = `<symbol id="iconCiteDB" viewBox="0 0 32 32">
  <path d="M11 7v6.2c0 3.2 1.8 5 4.6 5.6l.4 1.4c-3.9-.3-6.6-2.9-6.6-7V7h1.6zm8.4 0v6.2c0 3.2 1.8 5 4.6 5.6l.4 1.4c-3.9-.3-6.6-2.9-6.6-7V7h1.6z"></path>
</symbol>`;

class CiteDB extends siyuan.Plugin {
  async onload() {
    this.config = (await this.loadData(DATA_FILE)) || { version: 1, sources: [] };
    this.injectIcon();

    try {
      this.addTopBar({
        icon: ICON_SYMBOL,
        title: this.i18n.topbarTip,
        position: "right",
        callback: () => this.openPanel(),
      });
      this.addCommand({
        langKey: "openPanel",
        hotkey: "",
        callback: () => this.openPanel(),
      });
    } catch (e) {
      console.error("[citedb] 注册入口失败", e);
      siyuan.showMessage("引注插件初始化失败：" + (e && e.message));
    }
  }

  onunload() {
    this.removeIcon();
  }

  injectIcon() {
    if (document.getElementById("citeDB-symbols")) return;
    const wrap = document.createElement("div");
    wrap.id = "citeDB-symbols";
    wrap.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + ICON_SVG + "</svg>";
    document.body.appendChild(wrap);
  }

  removeIcon() {
    const el = document.getElementById("citeDB-symbols");
    if (el) el.remove();
  }

  async openPanel() {
    const sources = (this.config && this.config.sources) || [];
    const hasSource = sources.length > 0;
    let kernelVersion = "";
    try {
      const res = await siyuan.fetchSyncPost("/api/system/version", {});
      if (res && res.code === 0) kernelVersion = res.data || "";
    } catch (e) {
      /* 内核不可达时忽略 */
    }

    const sourceHtml = hasSource
      ? '<ul class="citeDB-sources">' +
        sources
          .map(
            (s) =>
              '<li class="citeDB-source"><b>' +
              this.escape(s.name || s.avID) +
              "</b><span>" +
              this.escape(s.template || "") +
              "</span></li>"
          )
          .join("") +
        "</ul>"
      : '<div class="citeDB-empty"><div class="citeDB-empty-title">' +
        this.i18n.statusNoSource +
        '</div><div class="citeDB-empty-hint">' +
        this.i18n.statusHint +
        "</div></div>";

    const html =
      '<div class="b3-dialog__content citeDB-panel">' +
      '<div class="citeDB-row"><span class="citeDB-label">' +
      this.i18n.version +
      '</span><span class="citeDB-value">' +
      this.escape(this.manifest.version) +
      (kernelVersion ? " · SiYuan " + this.escape(kernelVersion) : "") +
      "</span></div>" +
      sourceHtml +
      '<div class="citeDB-actions">' +
      '<button class="b3-button b3-button--outline" disabled>' +
      this.i18n.insert +
      "</button>" +
      '<button class="b3-button b3-button--outline" disabled>' +
      this.i18n.refresh +
      "</button>" +
      '<span class="citeDB-wip">' +
      this.i18n.wip +
      "</span></div>" +
      '<div class="citeDB-footer"><a href="https://github.com/Paiyunshou/siyuan-plugin-citedb" target="_blank">GitHub</a></div>' +
      "</div>";

    new siyuan.Dialog({ title: this.i18n.panelTitle, content: html, width: "520px" });
  }

  escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
}

module.exports = CiteDB;

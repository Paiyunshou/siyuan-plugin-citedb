import { Plugin, Dialog, showMessage, fetchSyncPost } from "siyuan";

const DATA_FILE = "citedb.json";
const ICON_SYMBOL = "iconCiteDB";

const ICON_SVG = `<symbol id="iconCiteDB" viewBox="0 0 32 32">
  <path d="M9 6h5v6H9v3c0 2 1 3 3 3v3c-4 0-6-2-6-6V6zm9 0h5v6h-5v3c0 2 1 3 3 3v3c-4 0-6-2-6-6V6z"></path>
</symbol>`;

export default class CiteDB extends Plugin {
  async onload() {
    this.config = (await this.loadData(DATA_FILE)) || { version: 1, sources: [] };
    this.injectIcon();

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
  }

  onunload() {
    this.removeIcon();
  }

  injectIcon() {
    if (document.getElementById("citeDB-symbols")) return;
    const wrap = document.createElement("div");
    wrap.id = "citeDB-symbols";
    wrap.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${ICON_SVG}</svg>`;
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
      const res = await fetchSyncPost("/api/system/version", {});
      if (res && res.code === 0) kernelVersion = res.data || "";
    } catch (e) {
      /* kernel unreachable, ignore */
    }

    const sourceHtml = hasSource
      ? sources
          .map(
            (s) =>
              `<li class="citeDB-source"><b>${this.escape(s.name || s.avID)}</b><span>${this.escape(
                s.template || ""
              )}</span></li>`
          )
          .join("")
      : `<div class="citeDB-empty">
           <div class="citeDB-empty-title">${this.i18n.statusNoSource}</div>
           <div class="citeDB-empty-hint">${this.i18n.statusHint}</div>
         </div>`;

    const html = `<div class="b3-dialog__content citeDB-panel">
      <div class="citeDB-row">
        <span class="citeDB-label">${this.i18n.version}</span>
        <span class="citeDB-value">${this.escape(this.manifest.version)}${
      kernelVersion ? " · SiYuan " + this.escape(kernelVersion) : ""
    }</span>
      </div>
      <div class="citeDB-sources">${sourceHtml}</div>
      <div class="citeDB-actions">
        <button class="b3-button b3-button--outline" disabled>${this.i18n.insert}</button>
        <button class="b3-button b3-button--outline" disabled>${this.i18n.refresh}</button>
        <span class="citeDB-wip">${this.i18n.wip}</span>
      </div>
      <div class="citeDB-footer">
        <a href="https://github.com/Paiyunshou/siyuan-plugin-citedb" target="_blank">GitHub</a>
      </div>
    </div>`;

    const dialog = new Dialog({
      title: this.i18n.panelTitle,
      content: html,
      width: "520px",
    });
    return dialog;
  }

  escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
}

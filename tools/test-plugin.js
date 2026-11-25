const Module = require('module');
const orig = Module._load;
let dialogArgs = null, messages = [];
class Plugin {
  constructor(){ this.i18n = { topbarTip:'引注', panelTitle:'引注 CiteDB' }; }
  async loadData(){ return null; }
  addTopBar(o){ this._bar = o; }
  addCommand(o){ this._cmd = o; }
}
class Dialog { constructor(o){ dialogArgs = o; } }
const fakeSiyuan = { Plugin, Dialog, showMessage:(m,t,ty)=>messages.push([m,ty]), fetchSyncPost: async()=>({code:0,data:'3.8.11'}) };
Module._load = function(request, parent, isMain){
  if (request === 'siyuan') return fakeSiyuan;
  return orig.apply(this, arguments);
};
// 最小 DOM 桩
const el = () => ({ style:{}, set innerHTML(v){ this._h=v; }, appendChild(){}, remove(){} });
global.document = { getElementById: () => null, createElement: () => el(), body: { appendChild(){} } };
global.console = console;

const CiteDB = require('/opt/data/workspace/siyuan-plugin-citedb/index.js');
(async () => {
  const p = new CiteDB();
  await p.onload();
  console.log('onload ok, topbar:', p._bar && {icon:p._bar.icon, title:p._bar.title, pos:p._bar.position});
  await p.openPanel();
  console.log('dialog:', dialogArgs && {title:dialogArgs.title, width:dialogArgs.width, hasPanel:dialogArgs.content.includes('citeDB-panel'), hasVersion:dialogArgs.content.includes('0.1.0'), hasKernel:dialogArgs.content.includes('3.8.11')});
  console.log('messages:', JSON.stringify(messages));
})().catch(e=>{ console.error('FAIL', e); process.exit(1); });

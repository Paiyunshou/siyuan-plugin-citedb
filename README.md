# CiteDB for SiYuan

> Insert `[n]` citations from your own SiYuan databases (attribute views) while writing,
> and get a bibliography / statute list generated at the end of the document.

A lightweight citation workflow for professionals who keep their sources in SiYuan instead of Zotero + Word.

![preview](preview.png)

## Status

`0.1.0` — **skeleton**: installable, top-bar entry, panel opens, data-source status visible.
Citation insertion (L1) is not implemented yet; buttons in the panel are disabled.

## Design

- Data source = an attribute view, no new data format
- Only three things matter: view + field mapping + template — adding a database is a config row, not code
- Field mapping is stored by column **ID**, so renaming a column never breaks it
- The citation list lives in the document attribute `custom-cite-refs`, synced with the document
- Missing fields are simply omitted — no empty brackets
- Works in the browser/Docker edition (kernel API only, no Electron)

## Install (development)

Not in the marketplace yet. Copy the folder into `{workspace}/data/plugins/siyuan-plugin-citedb/`,
then enable it in Marketplace → Downloaded.

## Roadmap

- [x] 0.1.0 skeleton
- [ ] L1 insert citations, source config, bibliography block
- [ ] L2 renumbering, dedupe
- [ ] L3 static export, config sharing

## License

MIT

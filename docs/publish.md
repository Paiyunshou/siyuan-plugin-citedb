# 上架思源集市 · 操作清单

对照 2026-11 的 `siyuan-note/bazaar` 规则（`README.zh-CN.md` + `rules/*.go`）。

## 一、仓库自身要满足的（已完成，pack.py 会复核）

- [x] 包根有 `README.md`、`plugin.json`、`index.js`（大小写敏感）
- [x] `plugin.json` 的 `url` 正好是 `https://github.com/Paiyunshou/siyuan-plugin-citedb`
- [x] `readme` 是对象且含 `default` 键（只写 `zh_CN`/`en_US` 会被 PR Check 打回）
- [x] `backends` / `frontends` / `kernels` 用枚举值，`"all"` 不与其他值混写
- [x] `icon.png` 160×160、1.8KB（≤64KB）；`preview.png` 1024×768、105KB（≤512KB）
- [x] 三处版本号一致：`plugin.json` / `package.json` / `index.js` 的 `VERSION`

## 二、本地要跑的

```bash
npm run check          # 语法 + 40 项单测
python3 tools/pack.py  # 打包并按集市规则预检（生成 package.zip）
```

`package.zip` 只在 Release 用，不进 git（`.gitignore` 已排除 `*.zip`）。

## 三、发版（tagname 必须 `v` + 版本号）

```bash
git add -A
git commit -m "release: 1.0.0 上架集市"
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

推 tag 后 `.github/workflows/release.yml` 会：
校验 tag 与两处版本号一致 → 跑单测 → 打包（包根结构，正斜杠）→ 检查图片体积 → 创建 Release 并附 `package.zip`。

发布完成后在 https://github.com/Paiyunshou/siyuan-plugin-citedb/releases 确认 `v1.0.0` 下确实有 `package.zip` 资产——**没有它 PR Check 必挂**。

## 四、提交集市 PR

1. Fork `siyuan-note/bazaar`（若已 fork，先同步 main）
2. 在 `plugins.txt` **末尾追加一行**（保持 LF，一个 PR 只加一个包）：
   ```
   Paiyunshou/siyuan-plugin-citedb
   ```
3. 分支名 `add-plugin-siyuan-plugin-citedb`，提交信息 `Add Paiyunshou/siyuan-plugin-citedb`
4. 开 PR 到 `siyuan-note/bazaar:main`，标题同提交信息，正文用下面这段

```markdown
## 插件信息

- 仓库：https://github.com/Paiyunshou/siyuan-plugin-citedb
- 包名：siyuan-plugin-citedb
- 版本：1.0.0
- 作者：Paiyunshou

## 功能简介

从思源数据库（属性视图）插入引注：文献进「参考文献」、法规进「注」，
支持上标编号 / 行内编号 / 著者-出版年三种正文标记，GB/T 7714-2015 格式。
面向财税、法律从业者，引用即双链。

## 自查

- [x] 已发布 Latest Release，附件含 `package.zip`（包根为 README.md / plugin.json / index.js）
- [x] `plugin.json` 的 `url` 与仓库一致，`readme` 含 `default` 键
- [x] `icon.png` 1.8KB、`preview.png` 105KB，均在限制内
- [x] 本地 `npm run check` 与 `tools/pack.py` 预检通过

仓库：https://github.com/Paiyunshou/siyuan-plugin-citedb
```

## 五、上架之后

- 新版本**不用再提 PR**：改版本号 → 推 tag → Release 里换新 `package.zip`，集市索引 1–3 小时自动更新
- 若长时间没更新，看 bazaar 带 `stage-fail` 标签的 issue（常见原因：`version` 没提升）
- 用户端需要重启一次思源以刷新集市索引缓存

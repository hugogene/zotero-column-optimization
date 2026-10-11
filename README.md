# Zotero 列优化 / Zotero Column Optimization

> 一个 Zotero 7/10 插件，做两件事：给条目列表加一列「摘要」，并把各处的「条目类型清单」精简成本机实际存在的类型。
> A Zotero 7/10 plugin that does two things: adds an **Abstract** column to the item list, and trims every **item-type list** down to the types that actually exist in your library.

---

## 中文

### 功能

| 位置 | 效果 |
|---|---|
| 条目列表列 | 新增「摘要」列，显示摘要前 160 字；在 **视图 → 列 → 更多列 → 摘要** 勾选显示 |
| 信息面板的「条目类型」下拉 | 只列出本机实际存在的类型（实测 37 → 20 项，本机不存在的类型 0 项） |
| 「新建条目」加号菜单 | 同上（实测 41 → 24 项，泄漏 0） |
| 高级检索的条目类型下拉 | 同上（实测 40 → 23 项，等于本机实际存在的类型数） |
| 视图 → 列 的类型专属列 | **默认关闭**，见下 |

「本机存在」是**运行时统计**的（`SELECT DISTINCT itemTypeID FROM items`），每 10 分钟刷新；以后库里出现新类型会自动回到清单，无需重装。

### 安装

Zotero → 工具 → 插件 → 齿轮 → Install Plugin From File… → 选择 `.xpi` → 重启。

### 开关

插件「设置」里没有 UI，用配置编辑器（设置 → 高级 → 配置编辑器）：

| 偏好 | 默认 | 作用 |
|---|---|---|
| `extensions.zotero.columnOpt.abstractColumn.enabled` | `true` | 是否注册「摘要」列 |
| `extensions.zotero.columnOpt.itemTypeSlim.enabled` | `true` | 是否精简各处类型清单 |
| `extensions.zotero.columnOpt.pruneTypeColumns` | `false` | 是否精简「视图 → 列」菜单，见下 |

修改后若涉及列注册，重启 Zotero 生效。

### 为什么「视图 → 列」菜单默认不动

实测 Zotero 38 个原生列的 `defaultIn` **全是 `"*"`**——也就是说列菜单里本来就**不存在**「按条目类型限定」的列。
按「字段对本机类型是否有效」反推，只有 `court`（仅判例可用）与 `medium` 两个候选，且实测剔除结果与预期不一致（疑似误伤 `extra` 这类通用列）。
收益小、风险不明，因此代码保留但默认关闭。

### 为什么能扛住 Zotero 自动升级

| 东西 | 位置 | 升级后 |
|---|---|---|
| 插件本体 | `%APPDATA%\Zotero\Zotero\Profiles\<profile>\extensions\` | 保留 |
| 列状态 | 同目录 `treePrefs.json` | 保留 |
| 偏好 | 同目录 `prefs.js` | 保留 |
| Zotero 程序文件 | `C:\Program Files\Zotero\` | 被整包替换 |

`manifest.json` 里写了 `strict_max_version: "99.*"`（装本地 `.xpi` 时该字段**必填**，无法省略），所以 Zotero 升到 11、12 也不会被判定为不兼容；插件内每步都有 `try/catch`，API 若有变动只会静默跳过那一项。

### 开发时踩过的坑

1. `Zotero.ItemTreeManager.registerColumn()` 的 `width` **必须是字符串**（`"220"`）。写数字会被**静默拒绝**：返回 `false`、列不出现、日志里一个字都没有。
2. 装本地 `.xpi` 时 manifest **必须同时有** `update_url` 与 `strict_max_version`，缺任一项 → `Extension is invalid`。
3. 新建条目菜单的 `menuitem` **没有 `value` 属性**（只有 `label` 和 command 闭包）→ 只能按本地化类型名匹配删除。
4. 列菜单的 `menuitem` 用 `colindex` **下标**回调 `toggleHidden(i)` → **绝不能过滤传给原方法的数组**，否则点「隐藏某列」会作用到别的列。
5. 信息面板那个下拉：`connectedCallback` 开头会 `delayConnectedCallback()` 提前 `return`，此时 popup 还没建，后置过滤会扑空 → 改为拦截 `appendItem`，从源头就不添加。
6. 给类对象打补丁标记**必须带版本号**：类对象常驻，旧版留下的 `true` 会让新版误判「已打过补丁」而跳过。
7. 插件 manifest 的 `name`/`description` 可以用 `__MSG_xxx__` + `_locales/<locale>/messages.json` 本地化，Zotero 认。

### 许可

MIT

---

## English

### What it does

| Where | Effect |
|---|---|
| Item list column | Adds an **Abstract** column (first 160 chars). Enable it in **View → Columns → More Columns → Abstract** |
| Info pane "Item Type" dropdown | Lists only item types present in your library (measured 37 → 20, zero leaks) |
| "New Item" plus menu | Same (measured 41 → 24, zero leaks) |
| Advanced search item-type dropdown | Same (40 in → 23 out, equal to the number of types actually present) |
| View → Columns type-specific columns | **Disabled by default**, see below |

"Present" is computed **at runtime** (`SELECT DISTINCT itemTypeID FROM items`) and refreshed every 10 minutes, so a type that first appears in your library comes back automatically — no reinstall.

### Install

Zotero → Tools → Plugins → gear → *Install Plugin From File…* → pick the `.xpi` → restart.

### Preferences

No settings UI; use the config editor (Settings → Advanced → Config Editor):

| Pref | Default | Meaning |
|---|---|---|
| `extensions.zotero.columnOpt.abstractColumn.enabled` | `true` | register the Abstract column |
| `extensions.zotero.columnOpt.itemTypeSlim.enabled` | `true` | slim the item-type lists |
| `extensions.zotero.columnOpt.pruneTypeColumns` | `false` | prune the View → Columns menu, see below |

### Why the View → Columns menu is left alone by default

All 38 built-in columns have `defaultIn: ["*"]` — the column menu simply has **no** per-item-type columns to prune.
Deriving candidates from "is this field valid for any present type" yields only `court` (case only) and `medium`, and the observed pruning did not match that expectation (it appeared to hit generic columns such as `extra`). Small upside, unclear risk — so the code is kept but off by default.

### Why it survives Zotero auto-updates

Everything the plugin owns lives in the **profile** (the plugin itself, `treePrefs.json`, `prefs.js`); Zotero upgrades only replace the program directory.
`strict_max_version` is required by the local `.xpi` installer, so it is set to `"99.*"` to stay compatible with future versions. Every patch is wrapped in `try/catch`, so a changed API only disables that one feature.

### Development pitfalls

1. `registerColumn()`'s `width` **must be a string** (`"220"`) — a number is silently rejected (returns `false`, nothing logged).
2. Installing a local `.xpi` requires **both** `update_url` and `strict_max_version` in the manifest, otherwise `Extension is invalid`.
3. "New Item" menu items have **no `value` attribute** — you can only match on the localized label.
4. Column-picker items call `toggleHidden(i)` with a **`colindex` index** — never filter the array passed to the original method, or the wrong column gets hidden.
5. The info-pane dropdown returns early from `connectedCallback` via `delayConnectedCallback()`; post-filtering misses it. Intercept `appendItem` instead.
6. Patch tags on class objects **must be versioned** — class objects persist across plugin upgrades.
7. Plugin manifest `name`/`description` can be localized with `__MSG_xxx__` + `_locales/<locale>/messages.json`.

### License

MIT

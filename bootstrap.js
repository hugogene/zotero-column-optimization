/* Zotero Column Optimization — Zotero plugin
 *
 * 两件事 / Two things:
 *   A. 摘要列        —— 条目列表增加一列「摘要」(Abstract)
 *   B. 条目类型清单精简 —— 各处类型清单只列【本机实际存在】的类型
 *      B1 信息面板的「条目类型」下拉        customElements "menulist-item-types"
 *      B2 「新建条目」加号菜单              #zotero-tb-add 的 popup
 *      B3 高级检索的条目类型下拉            customElements "zoterosearchcondition"
 *      B4 「视图 → 列」菜单里本机用不到的类型专属列（默认关闭）
 *
 * 设计要点 / Design notes
 *   - 所有设置都在 profile（插件本体 + prefs + treePrefs.json），Zotero 自动升级不受影响。
 *   - 每个改动点都只作用于「弹出菜单的 DOM」或「列注册表」，不碰用户数据。
 *   - 每步 try/catch 兜底：任何一处失败只影响那一处，不会拖垮 Zotero 启动。
 *   - 暴露 Zotero.ColumnOptimization 供排查与外部调用。
 *
 * 作者 / Author: hugogene
 * 许可 / License: MIT
 */

"use strict";

const PLUGIN_ID = "zotero-column-optimization@hugogene";
const PATCH_TAG = "zco_v1.0.0";            // 带版本的补丁标记：类对象常驻，旧标记不能被当成"已打过补丁"

const PREF_SLIM_ENABLED = "columnOpt.itemTypeSlim.enabled";      // 默认 true
const PREF_PRUNE_COLUMNS = "columnOpt.pruneTypeColumns";         // 默认 false（见 B4 说明）
const PREF_ABSTRACT_ENABLED = "columnOpt.abstractColumn.enabled"; // 默认 true

const ABSTRACT_DATA_KEY = "abstractNoteCol";
const ABSTRACT_MAX_CHARS = 160;
const NO_SLIMMING = ["attachment", "note", "annotation"];
const REFRESH_MS = 10 * 60 * 1000;

var registeredColumnKey = null;
var presentIds = null;        // Set<itemTypeID>
var refreshing = null;
var refreshTimer = null;
var hookedWindows = new WeakSet();

function log(msg) {
  Zotero.debug("ColumnOptimization: " + msg);
}

/* 界面语言 / UI language —— 用于列标题等"字面量"文案；菜单文案走 Fluent（见插件 B） */
function isChineseUI() {
  try {
    let loc = Zotero.locale
      || (Services.locale && Services.locale.appLocaleAsBCP47)
      || "en";
    return /^zh/i.test(loc);
  }
  catch (e) {
    return false;
  }
}

function t(zh, en) {
  return isChineseUI() ? zh : en;
}

function prefBool(name, dflt) {
  try {
    let v = Zotero.Prefs.get(name);
    return v === undefined || v === null ? dflt : !!v;
  }
  catch (e) {
    return dflt;
  }
}

/* =========================================================================
 * A. 摘要列 / Abstract column
 * ========================================================================= */

function abstractCellText(item) {
  let s = "";
  try {
    s = (item.getField("abstractNote") || "").replace(/\s+/g, " ").trim();
  }
  catch (e) {
    return "";
  }
  return s.length > ABSTRACT_MAX_CHARS ? s.slice(0, ABSTRACT_MAX_CHARS) + "…" : s;
}

function registerAbstractColumn() {
  if (registeredColumnKey || !prefBool(PREF_ABSTRACT_ENABLED, true)) {
    return;
  }
  try {
    if (!Zotero.ItemTreeManager || !Zotero.ItemTreeManager.registerColumn) {
      log("This Zotero has no ItemTreeManager.registerColumn; skipping abstract column");
      return;
    }
    // 注意 / NOTE: width 必须是【字符串】。写成数字会被静默拒绝（返回 false、无任何报错）。
    // width MUST be a string; a number is silently rejected (returns false, no error logged).
    let key = Zotero.ItemTreeManager.registerColumn({
      dataKey: ABSTRACT_DATA_KEY,
      label: t("摘要", "Abstract"),
      pluginID: PLUGIN_ID,
      enabledTreeIDs: ["main"],
      showInColumnPicker: true,
      columnPickerSubMenu: true,
      width: "220",
      flex: 0,
      minWidth: 80,
      zoteroPersist: ["width", "hidden", "sortDirection"],
      dataProvider: (item) => abstractCellText(item),
    });
    if (key) {
      registeredColumnKey = key;
      Zotero.ItemTreeManager.refreshColumns();
      log("abstract column registered: " + key);
    }
    else {
      log("registerColumn returned false (bad option or already registered)");
    }
  }
  catch (e) {
    log("registerAbstractColumn failed: " + e);
    Zotero.logError(e);
  }
}

function unregisterAbstractColumn() {
  if (!registeredColumnKey) {
    return;
  }
  try {
    Zotero.ItemTreeManager.unregisterColumn(registeredColumnKey);
    Zotero.ItemTreeManager.refreshColumns();
  }
  catch (e) {
    log("unregisterAbstractColumn failed: " + e);
  }
  registeredColumnKey = null;
}

/* =========================================================================
 * B. 条目类型清单精简 / Item-type list slimming
 * ========================================================================= */

async function refreshPresentTypes() {
  if (refreshing) {
    return refreshing;
  }
  refreshing = (async () => {
    try {
      let rows = await Zotero.DB.queryAsync(
        "SELECT DISTINCT itemTypeID FROM items "
        + "WHERE itemID NOT IN (SELECT itemID FROM deletedItems)");
      let s = new Set(rows.map((r) => r.itemTypeID));
      for (let n of NO_SLIMMING) {
        let id = Zotero.ItemTypes.getID(n);
        if (id) {
          s.add(id);
        }
      }
      presentIds = s;
      log("present item types: " + s.size);
    }
    catch (e) {
      log("refreshPresentTypes failed: " + e);
    }
    finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function slimEnabled() {
  return prefBool(PREF_SLIM_ENABLED, true) && !!presentIds;
}

function absentLocalizedLabels() {
  let set = new Set();
  for (let ty of Zotero.ItemTypes.getTypes()) {
    if (!presentIds.has(ty.id)) {
      try {
        set.add(Zotero.ItemTypes.getLocalizedString(ty.id));
      }
      catch (e) { /* ignore */ }
    }
  }
  return set;
}

function slimItemTypePopup(popup) {
  if (!slimEnabled() || !popup) {
    return 0;
  }
  let bad = absentLocalizedLabels();
  let removed = 0;
  for (let el of Array.from(popup.children)) {
    if (el.tagName !== "menuitem") {
      continue;
    }
    // menulist 的 value 是 itemTypeID；新建条目菜单的 menuitem 没有 value（只有 label + 闭包）。
    // A menulist item carries itemTypeID in `value`; the New Item menu items carry only a label.
    let hit = false;
    let v = el.getAttribute && el.getAttribute("value");
    if (v && /^\d+$/.test(v)) {
      hit = !presentIds.has(parseInt(v, 10));
    }
    else {
      let label = el.getAttribute && el.getAttribute("label");
      hit = !!(label && bad.has(label));
    }
    if (hit) {
      el.remove();
      removed++;
    }
  }
  return removed;
}

/* ---- B1 信息面板的条目类型下拉 ---- */
function patchItemTypeMenuList(win) {
  try {
    let ce = win.customElements && win.customElements.get("menulist-item-types");
    if (!ce || ce.__zcoPatched === PATCH_TAG) {
      return false;
    }
    // 为什么不是"connectedCallback 后置过滤"：该方法开头会 delayConnectedCallback() 并提前 return，
    // 此时 popup 还没建，后置过滤会扑空（实测：探针菜单仍是 37 项）。
    // 因此拦截 appendItem，从源头就不把"本机不存在"的类型加进去。
    let origAppend = ce.prototype.appendItem;
    ce.prototype.appendItem = function (label, value) {
      try {
        if (slimEnabled()) {
          let v = parseInt(value, 10);
          if (!isNaN(v) && !presentIds.has(v)) {
            return;
          }
        }
      }
      catch (e) { /* fall through */ }
      return origAppend.apply(this, arguments);
    };

    let origCC = ce.prototype.connectedCallback;
    ce.prototype.connectedCallback = function (...args) {
      let r = origCC.apply(this, args);
      try {
        let popup = this.menupopup;
        if (popup && !popup.__zcoHooked) {
          popup.__zcoHooked = true;
          popup.addEventListener("popupshowing", () => {
            try { slimItemTypePopup(popup); } catch (e) { log(e); }
          });
        }
      }
      catch (e) { /* ignore */ }
      return r;
    };

    ce.__zcoPatched = PATCH_TAG;
    log("B1 hooked menulist-item-types");
    return true;
  }
  catch (e) {
    log("B1 failed: " + e);
    return false;
  }
}

/* ---- B2 新建条目菜单 ---- */
function hookNewItemMenu(win) {
  try {
    let btn = win.document.getElementById("zotero-tb-add");
    let popup = btn && btn.firstElementChild;
    if (!popup || popup.__zcoHooked) {
      return false;
    }
    popup.__zcoHooked = true;
    popup.addEventListener("popupshowing", () => {
      try {
        slimItemTypePopup(popup);
        // 原监听器也可能是后注册的；下一轮事件循环再补一次。
        win.setTimeout(() => {
          try { slimItemTypePopup(popup); } catch (e) { log(e); }
        }, 0);
      }
      catch (e) {
        log("B2 failed: " + e);
      }
    });
    log("B2 hooked new-item menu");
    return true;
  }
  catch (e) {
    log("B2 failed: " + e);
    return false;
  }
}

/* ---- B3 高级检索的条目类型下拉 ---- */
function filterTypeRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return rows;
  }
  let byName = new Map();
  for (let ty of Zotero.ItemTypes.getTypes()) {
    byName.set(ty.name, ty.id);
  }
  for (let r of rows) {
    if (!r || !byName.has(r.value)) {
      return rows;   // 不全是条目类型 → 不是这个条件，原样返回
    }
  }
  return rows.filter((r) => presentIds.has(byName.get(r.value)));
}

function patchSearchCondition(win) {
  try {
    let ce = win.customElements && win.customElements.get("zoterosearchcondition");
    if (!ce || ce.__zcoPatched === PATCH_TAG || !ce.prototype.createValueMenu) {
      return false;
    }
    let orig = ce.prototype.createValueMenu;
    ce.prototype.createValueMenu = function (rows) {
      try {
        if (slimEnabled()) {
          rows = filterTypeRows(rows);
        }
      }
      catch (e) {
        log("B3 filter failed: " + e);
      }
      return orig.call(this, rows);
    };
    ce.__zcoPatched = PATCH_TAG;
    log("B3 hooked advanced-search condition element");
    return true;
  }
  catch (e) {
    log("B3 failed: " + e);
    return false;
  }
}

/* ---- B4 「视图 → 列」里本机用不到的类型专属列（默认关闭）----
 * 实测：Zotero 38 个原生列的 defaultIn 全是 "*"，列菜单里本来就不存在"按条目类型限定"的列；
 * 按"字段对本机类型是否有效"反推只有 court(判例) 与 medium 两个候选，且剔除结果与预期不一致。
 * 收益小、风险不明，故默认关闭：extensions.zotero.columnOpt.pruneTypeColumns = true 可开启。
 */
function columnIndicesToDrop(columns) {
  let drop = [];
  let present = Array.from(presentIds);
  for (let i = 0; i < columns.length; i++) {
    let key = columns[i] && columns[i].dataKey;
    if (!key) {
      continue;
    }
    let fieldID = null;
    try {
      fieldID = Zotero.ItemFields.getID(key);
    }
    catch (e) {
      fieldID = null;
    }
    if (!fieldID) {
      continue;
    }
    let usable = false;
    for (let tid of present) {
      try {
        if (Zotero.ItemFields.isValidForType(fieldID, tid)) {
          usable = true;
          break;
        }
      }
      catch (e) { /* ignore */ }
    }
    if (!usable) {
      drop.push(i);
    }
  }
  return drop;
}

function patchColumnPicker(win) {
  try {
    let iv = win.ZoteroPane && win.ZoteroPane.itemsView;
    if (!iv) {
      return false;
    }
    let proto = Object.getPrototypeOf(iv);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, "_buildColumnPickerMenu")) {
      proto = Object.getPrototypeOf(proto);
    }
    if (!proto || proto.__zcoPatched === PATCH_TAG) {
      return false;
    }
    let orig = proto._buildColumnPickerMenu;
    proto._buildColumnPickerMenu = function (menupopup, prefix, columns) {
      let r = orig.call(this, menupopup, prefix, columns);
      try {
        if (slimEnabled() && prefBool(PREF_PRUNE_COLUMNS, false)) {
          let drop = new Set(columnIndicesToDrop(columns));
          if (drop.size) {
            // 必须原样调用原方法后再按 colindex 删 DOM —— 不能过滤 columns 数组，
            // 因为 menuitem 用 colindex 下标回调 toggleHidden(i)，过滤会让"隐藏某列"点错列。
            for (let el of Array.from(menupopup.querySelectorAll("menuitem[colindex]"))) {
              if (drop.has(Number(el.getAttribute("colindex")))) {
                el.remove();
              }
            }
          }
        }
      }
      catch (e) {
        log("B4 failed: " + e);
      }
      return r;
    };
    proto.__zcoPatched = PATCH_TAG;
    log("B4 hooked column picker");
    return true;
  }
  catch (e) {
    log("B4 failed: " + e);
    return false;
  }
}

/* ---- 逐窗口挂钩 ---- */
function hookWindow(win) {
  if (!win || hookedWindows.has(win)) {
    return;
  }
  hookedWindows.add(win);
  try {
    patchItemTypeMenuList(win);
    hookNewItemMenu(win);
    patchSearchCondition(win);
    patchColumnPicker(win);
    win.setTimeout(() => {
      try {
        hookNewItemMenu(win);
        patchColumnPicker(win);
      }
      catch (e) { /* ignore */ }
    }, 1500);
  }
  catch (e) {
    log("hookWindow failed: " + e);
  }
}

/* =========================================================================
 * 生命周期 / Lifecycle
 * ========================================================================= */

async function startup({ id, version, rootURI }, reason) {
  try {
    await Zotero.initializationPromise;
  }
  catch (e) { /* already resolved */ }
  log("startup " + version);

  registerAbstractColumn();
  await refreshPresentTypes();

  // 运行时安装时，已开着的窗口不会触发 onMainWindowLoad → 主动挂一遍
  try {
    for (let w of (Zotero.getMainWindows ? Zotero.getMainWindows() : [])) {
      hookWindow(w);
    }
  }
  catch (e) {
    log("hook existing windows failed: " + e);
  }

  // 库中出现新类型后自动纳入
  try {
    refreshTimer = setInterval(() => {
      refreshPresentTypes().catch(() => {});
    }, REFRESH_MS);
  }
  catch (e) { /* ignore */ }

  // 供排查/外部调用 / Debug & external API
  try {
    Zotero.ColumnOptimization = {
      version,
      refresh: () => refreshPresentTypes(),
      status: () => ({
        version,
        abstractColumn: registeredColumnKey,
        slimEnabled: slimEnabled(),
        pruneColumns: prefBool(PREF_PRUNE_COLUMNS, false),
        presentTypeCount: presentIds ? presentIds.size : null,
      }),
    };
  }
  catch (e) { /* ignore */ }
}

function onMainWindowLoad({ window }, reason) {
  hookWindow(window);
}

function onMainWindowUnload({ window }, reason) {
  // 不回滚：补丁只影响弹出菜单的 DOM，随窗口销毁而消失
}

function shutdown({ id, version, rootURI }, reason) {
  log("shutdown");
  try {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }
  catch (e) { /* ignore */ }
  unregisterAbstractColumn();
  try {
    delete Zotero.ColumnOptimization;
  }
  catch (e) { /* ignore */ }
}

function install() {}
function uninstall() {}

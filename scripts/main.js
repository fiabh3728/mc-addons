// scripts/main.js
import * as mc from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

/* ==================== 配置區 ==================== */
const AP_OBJ = "ap";                 // scoreboard 目標：AP 金幣
const CURRENCY = "AP";               // 幣別顯示
const DIAMOND_ID = "minecraft:diamond";
const AP_PER_DIAMOND = 110;          // 匯率：1 鑽石 -> 100 AP（單向）
const MAX_TRANSFER = 1_000_000_000;  // 轉帳上限
const START_BAL = 0;                 // 新玩家初始 AP
const THEME = {
  title: "iPadOS 控制中心",
  bank: "🏦 銀行",
  shop: "🛒 商店",
  back: "‹ 返回",
  sep: "————————————"
};
/* ==================== 股市設定 ==================== */
const STK_PRICE_OBJ = "stk_px";     // 價格用的 scoreboard 目標
const TRADE_SENS = 25;              // 價格敏感度：每淨買(或賣) TRADE_SENS 股，價格變動 1 AP
const TRADE_MAX_PER_TX = 10000;     // 單次交易上限（避免滑桿過長）
const PRICE_MIN = 1;                // 最低單價 AP
const PRICE_MAX = 10_000_000;       // 最高單價 AP（防溢位）

// 三支股票
const STOCKS = [
  { key: "GEM", name: "寶石公司", holdObj: "stk_gem", initPrice: 120 },
  { key: "DIA", name: "鑽石公司", holdObj: "stk_dia", initPrice: 200 },
  { key: "GLD", name: "黃金公司", holdObj: "stk_gld", initPrice: 150 },
];

// 商店清單
const SHOP = [
  {
    name: "🧰 工具 Tools",
    items: [
      { id: "minecraft:diamond_sword", name: "鑽石劍", price: 200, max: 1 },
      { id: "minecraft:diamond_shovel", name: "鑽石鏟", price: 100,  max: 1 },
      { id: "minecraft:diamond_pickaxe", name: "鑽石鎬", price: 300,  max: 1 },
      { id: "minecraft:diamond_axe", name: "鑽石斧", price: 300,  max: 1 },
      { id: "minecraft:diamond_hoe", name: "鑽石鋤", price: 200,  max: 1 }
    ]
  },
  {
    name: "👔 護甲 Armor",
    items: [
      { id: "minecraft:diamond_helmet", name: "鑽石頭盔", price: 500, max: 1 },
      { id: "minecraft:diamond_chestplate", name: "鑽石胸甲", price: 800, max: 1 },
      { id: "minecraft:diamond_leggings", name: "鑽石護腿", price: 700, max: 1 },
      { id: "minecraft:diamond_boots", name: "鑽石靴子", price: 400, max: 1 }
    ]
  },
  {
    name: "🍖 食物 Food",
    items: [
      { id: "minecraft:bread",          name: "麵包",     price: 5,   max: 64 }
    ]
  }
];

/* ==================== 相容工具 ==================== */
// 兼容各版 UI 的 slider：
// - 新版：slider(label, min, max, { value, step })
// - 舊版：slider(label, min, max, value)
function sliderCompat(form, label, min, max, def, step) {
  const defVal = Math.max(min, Math.min(max, Math.floor(def ?? min)));
  const stepVal = Math.max(1, Math.floor(step ?? 1));
  // 優先嘗試新版物件參數
  try {
    return form.slider(label, min, max, { value: defVal, step: stepVal });
  } catch {
    // 回退舊版數字參數
    try {
      return form.slider(label, min, max, defVal);
    } catch {
      // 最後退：不帶預設
      return form.slider(label, min, max);
    }
  }
}
function dropdownCompat(form, label, options, defIndex = 0) {
  const opts = Array.isArray(options) ? options.map(o => String(o ?? "")) : [];
  const def = Math.max(0, Math.min(Math.floor(defIndex), Math.max(opts.length - 1, 0)));
  // 優先嘗試新版物件參數
  try {
    return form.dropdown(label, { options: opts, default: def });
  } catch {
    // 回退舊版參數 (label, options[], defaultIndex?)
    try {
      return form.dropdown(label, opts, def);
    } catch {
      return form.dropdown(label, opts);
    }
  }
}
/* ==================== 工具與基礎 ==================== */
function getObj() {
  let o = mc.world.scoreboard.getObjective(AP_OBJ);
  if (!o) o = mc.world.scoreboard.addObjective(AP_OBJ, "AP Coin");
  return o;
}
function getBal(p) {
  const o = getObj();
  try {
    const s = o.getScore(p); // 傳入 Player 實體
    return Number.isFinite(s) ? Math.max(0, s) : 0;
  } catch {
    return 0;
  }
}
function setBal(p, val) {
  const o = getObj();
  o.setScore(p, Math.max(0, Math.floor(val))); // 傳入 Player 實體
}
function addBal(p, delta) { setBal(p, getBal(p) + Math.floor(delta)); }

function inv(p) {
  const comp = p.getComponent("minecraft:inventory");
  return comp?.container;
}
function countItem(p, id) {
  const c = inv(p); if (!c) return 0;
  let n = 0;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it && it.typeId === id) n += it.amount;
  }
  return n;
}
function removeItems(p, id, amount) {
  const c = inv(p); if (!c) return 0;
  amount = Math.max(1, Math.min(Math.floor(amount || 0), 255)); // 保證在 1..255
  let left = amount;
  for (let i = 0; i < c.size && left > 0; i++) {
    const it = c.getItem(i);
    if (!it || it.typeId !== id) continue;
    const take = Math.min(it.amount, left);
    const newAmt = it.amount - take;
    left -= take;
    if (newAmt <= 0) c.setItem(i, undefined);
    else { it.amount = newAmt; c.setItem(i, it); }
  }
  return amount - left; // 實際移除
}
function addItems(p, id, amount) {
  const before = countItem(p, id);
  const type = mc.ItemTypes.get(id);
  if (!type) return 0;
  let remain = Math.max(1, Math.floor(amount || 0));
  const c = inv(p); if (!c) return 0;

  while (remain > 0) {
    const batch = Math.min(remain, type.maxStackSize ?? 64);
    const st = new mc.ItemStack(type, batch);
    try { c.addItem(st); } catch { break; }
    const after = countItem(p, id);
    const added = after - (amount - remain + before);
    if (added <= 0) break;
    remain -= added;
  }
  return amount - remain;
}
function maxAddable(p, id) {
  const c = inv(p); if (!c) return 0;
  const type = mc.ItemTypes.get(id);
  const maxStack = type?.maxStackSize ?? 64;
  let space = 0;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (!it) { space += maxStack; continue; }
    if (it.typeId === id && it.amount < maxStack) {
      space += (maxStack - it.amount);
    }
  }
  return space;
}
function nfmt(n) { return Number(n).toLocaleString(); }

/* ==================== 股市工具 ==================== */
function getPriceObj() {
  let o = mc.world.scoreboard.getObjective(STK_PRICE_OBJ);
  if (!o) o = mc.world.scoreboard.addObjective(STK_PRICE_OBJ, "Stock Prices");
  return o;
}
function getHoldObj(stock) {
  let o = mc.world.scoreboard.getObjective(stock.holdObj);
  if (!o) o = mc.world.scoreboard.addObjective(stock.holdObj, `${stock.name} 持股`);
  return o;
}
function findPriceIdentity(stock) {
  const name = `STK:${stock.key}`;
  const parts = getPriceObj().getParticipants();
  return parts.find(p => (p.displayName ?? p?.player?.name ?? "") === name);
}
async function ensurePriceIdentity(stock) {
  const o = getPriceObj();
  let id = findPriceIdentity(stock);
  if (id) return;
  const name = `STK:${stock.key}`;
  // 用命令創建假玩家參與者，之後就能用 API 讀寫分數
  try {
    await mc.world.getDimension("overworld")
      .runCommandAsync(`scoreboard players set "${name}" ${STK_PRICE_OBJ} ${stock.initPrice}`);
  } catch {}
}
function getPrice(stock) {
  const o = getPriceObj();
  let id = findPriceIdentity(stock);
  if (!id) return stock.initPrice;
  let s = 0;
  try { s = o.getScore(id); } catch { s = stock.initPrice; }
  return Math.max(PRICE_MIN, Math.min(PRICE_MAX, Math.floor(s)));
}
function setPrice(stock, val) {
  const o = getPriceObj();
  const id = findPriceIdentity(stock);
  if (!id) return; // 尚未初始化時略過（初始化流程會補）
  o.setScore(id, Math.max(PRICE_MIN, Math.min(PRICE_MAX, Math.floor(val))));
}
function applyPriceImpact(stock, qty, side /* "BUY"|"SELL" */) {
  const step = Math.max(1, Math.ceil(Math.abs(qty) / TRADE_SENS));
  const p = getPrice(stock);
  const np = side === "BUY" ? p + step : p - step;
  setPrice(stock, np);
}
function getHold(p, stock) {
  const o = getHoldObj(stock);
  try {
    const s = o.getScore(p);
    return Number.isFinite(s) ? Math.max(0, s) : 0;
  } catch { return 0; }
}
function setHold(p, stock, val) {
  const o = getHoldObj(stock);
  o.setScore(p, Math.max(0, Math.floor(val)));
}
async function ensureStocksInit() {
  getPriceObj();
  for (const s of STOCKS) {
    getHoldObj(s);
    await ensurePriceIdentity(s);
  }
}

/* ==================== iPadOS 主菜單 ==================== */
function openMain(p) {
  const bal = getBal(p);
  const f = new ActionFormData()
    .title(` ${THEME.title}`)
    .body(`${THEME.sep}\n玩家：${p.name}\n餘額：${CURRENCY} ${nfmt(bal)}\n${THEME.sep}`)
    .button(`${THEME.bank}\n管理餘額、兌換、轉賬`)
    .button(`${THEME.shop}\n購買道具與方塊`)
    .button("📈 股市")
    .button("🏆 排行榜");
  mc.system.run(() => {
    f.show(p).then(res => {
      if (res.canceled) return;
      if (res.selection === 0) bankMenu(p);
      if (res.selection === 1) shopMenu(p);
      if (res.selection === 2) stockMarketMenu(p);
      if (res.selection === 3) showLeaderboard(p);
    }).catch(console.warn);
  });
}

/* ==================== 股市 UI 與交易 ==================== */
function stockMarketMenu(p) {
  const f = new ActionFormData()
    .title("📈 股市 ·  iPadOS");

  let body = `${THEME.sep}\n選擇公司\n${THEME.sep}\n`;
  for (const s of STOCKS) {
    const price = getPrice(s);
    const hold = getHold(p, s);
    body += `${s.name}  單價：${CURRENCY} ${nfmt(price)} / 股   持股：${nfmt(hold)}\n`;
  }
  f.body(body);
  for (const s of STOCKS) f.button(`${s.name}\n單價 ${CURRENCY} ${nfmt(getPrice(s))}`);
  f.button(THEME.back);

  mc.system.run(() => {
    f.show(p).then(r => {
      if (r.canceled) return;
      if (r.selection === STOCKS.length) return openMain(p);
      const s = STOCKS[r.selection];
      openStockDetail(p, s);
    }).catch(console.warn);
  });
}

function openStockDetail(p, stock) {
  const price = getPrice(stock);
  const hold = getHold(p, stock);
  const f = new ActionFormData()
    .title(`${stock.name}`)
    .body(`${THEME.sep}
單價：${CURRENCY} ${nfmt(price)} / 股
你的持股：${nfmt(hold)} 股
說明：單次每買入/賣出 ${nfmt(TRADE_SENS)} 股，價格變動約 1 AP。
${THEME.sep}`)
    .button("買入")
    .button("賣出")
    .button(THEME.back);

  mc.system.run(() => {
    f.show(p).then(r => {
      if (r.canceled) return;
      if (r.selection === 0) tradeBuy(p, stock);
      if (r.selection === 1) tradeSell(p, stock);
      if (r.selection === 2) stockMarketMenu(p);
    }).catch(console.warn);
  });
}

function tradeBuy(p, stock) {
  const price = getPrice(stock);
  const bal = getBal(p);
  const maxByMoney = Math.floor(bal / price);
  const max = Math.max(0, Math.min(maxByMoney, TRADE_MAX_PER_TX));
  if (max <= 0) {
    p.sendMessage(`§e餘額不足，當前單價 ${CURRENCY} ${nfmt(price)}。`);
    return openStockDetail(p, stock);
  }
  const m = new ModalFormData().title(`買入 ${stock.name}`);
  sliderCompat(m, `股數（最多 ${nfmt(max)}）\n當前單價：${CURRENCY} ${nfmt(price)}\n總價=單價×股數`, 1, max, Math.min(max, 64), 1);
  mc.system.run(() => {
    m.show(p).then(r => {
      if (r.canceled) return openStockDetail(p, stock);
      const qty = Math.max(1, Math.floor(r.formValues[0] || 1));
      // 再次校驗最新價格與餘額
      const curP = getPrice(stock);
      const cost = qty * curP;
      const nowBal = getBal(p);
      if (cost > nowBal) {
        p.sendMessage("§c餘額變動，買入失敗。");
        return openStockDetail(p, stock);
      }
      addBal(p, -cost);
      setHold(p, stock, getHold(p, stock) + qty);
      applyPriceImpact(stock, qty, "BUY");
      p.sendMessage(`§a已買入 ${stock.name} ${nfmt(qty)} 股，成交單價 ${CURRENCY} ${nfmt(curP)}，花費 ${CURRENCY} ${nfmt(cost)}。`);
      openStockDetail(p, stock);
    }).catch(console.warn);
  });
}

function tradeSell(p, stock) {
  const hold = getHold(p, stock);
  if (hold <= 0) {
    p.sendMessage("§e沒有可賣出的持股。");
    return openStockDetail(p, stock);
  }
  const max = Math.min(hold, TRADE_MAX_PER_TX);
  const m = new ModalFormData().title(`賣出 ${stock.name}`);
  sliderCompat(m, `股數（最多 ${nfmt(max)}）\n當前單價：${CURRENCY} ${nfmt(getPrice(stock))}\n收入=單價×股數`, 1, max, Math.min(max, 64), 1);
  mc.system.run(() => {
    m.show(p).then(r => {
      if (r.canceled) return openStockDetail(p, stock);
      const qty = Math.max(1, Math.floor(r.formValues[0] || 1));
      const curP = getPrice(stock);
      if (qty > getHold(p, stock)) {
        p.sendMessage("§c持股變動，賣出失敗。");
        return openStockDetail(p, stock);
      }
      const income = qty * curP;
      setHold(p, stock, getHold(p, stock) - qty);
      addBal(p, income);
      applyPriceImpact(stock, qty, "SELL");
      p.sendMessage(`§a已賣出 ${stock.name} ${nfmt(qty)} 股，成交單價 ${CURRENCY} ${nfmt(curP)}，收入 ${CURRENCY} ${nfmt(income)}。`);
      openStockDetail(p, stock);
    }).catch(console.warn);
  });
}

/* ==================== 銀行系統 ==================== */
function bankMenu(p) {
  const bal = getBal(p);
  const diamonds = countItem(p, DIAMOND_ID);
  const body =
    `${THEME.sep}\n餘額：${CURRENCY} ${nfmt(bal)}\n持有鑽石：${nfmt(diamonds)} 顆\n` +
    `匯率：1 鑽石 → ${AP_PER_DIAMOND} ${CURRENCY}\n（單向；AP 不能兌回鑽石）\n${THEME.sep}`;
  const f = new ActionFormData()
    .title(`${THEME.bank} ·  iPadOS`)
    .body(body)
    .button("查看餘額")
    .button("鑽石兌換 AP")
    .button("轉賬給玩家")
    .button(THEME.back);
  mc.system.run(() => {
    f.show(p).then(res => {
      if (res.canceled) return;
      switch (res.selection) {
        case 0: showBalance(p, () => bankMenu(p)); break;
        case 1: exchangeDiamonds(p); break;
        case 2: startTransferFlow(p); break;
        case 3: openMain(p); break;
      }
    });
  });
}
function showBalance(p, onBack) {
  const bal = getBal(p);
  const m = new MessageFormData()
    .title("我的餘額")
    .body(`${CURRENCY} ${nfmt(bal)}`)
    .button1("關閉").button2(THEME.back);
  mc.system.run(() => m.show(p).then(r => { if (r.selection === 1 && onBack) onBack(); }));
}
function exchangeDiamonds(p) {
  const owned = countItem(p, DIAMOND_ID);
  if (owned <= 0) {
    p.sendMessage("§e你沒有鑽石可兌換。");
    return bankMenu(p);
  }
  const maxExchange = Math.min(owned, 64); // UI 上限保守值
  const f = new ModalFormData().title("鑽石兌換 AP");
  sliderCompat(f, `可兌換鑽石（最多 ${maxExchange}）`, 1, maxExchange, Math.min(maxExchange, 8), 1);
  mc.system.run(() => {
    f.show(p).then(res => {
      if (res.canceled) return;
      const use = Math.max(1, Math.min(Math.floor(res.formValues[0] || 1), maxExchange));
      const removed = removeItems(p, DIAMOND_ID, use);
      if (removed <= 0) return p.sendMessage("§c兌換失敗：無法移除鑽石。");
      const ap = removed * AP_PER_DIAMOND;
      addBal(p, ap);
      p.sendMessage(`§a已將 ${removed} 鑽石兌換為 ${CURRENCY} ${nfmt(ap)}。`);
      bankMenu(p);
    }).catch(e => {
      console.warn("兌換過程出錯：", e);
      p.sendMessage("§c兌換發生未知錯誤。");
    });
  });
}
function startTransferFlow(p) {
  const others = mc.world.getPlayers({ excludeNames: [p.name] });
  if (others.length === 0) {
    p.sendMessage("§e沒有其他在線玩家可轉賬。");
    return;
  }
  const names = others.map(pl => pl.name);

  const pick = new ModalFormData().title("選擇收款玩家");
  dropdownCompat(pick, "收款人", names, 0);

  mc.system.run(() => {
    pick.show(p).then(r => {
      if (r.canceled) return;
      const idx = Number(r.formValues[0]);
      if (!Number.isInteger(idx) || idx < 0 || idx >= names.length) {
        p.sendMessage("§c選擇無效。");
        return;
      }
      // 再次取實體，避免期間離線或名單變動
      const target = mc.world.getPlayers({ name: names[idx] })[0];
      if (!target) {
        p.sendMessage("§c對方已離線。");
        return;
      }
      askTransferAmount(p, target);
    }).catch(e => console.warn("選擇收款玩家時出錯：", e));
  });
}
function askTransferAmount(from, to) {
  const bal = getBal(from);
  if (bal <= 0) return from.sendMessage("§e你的餘額不足。");
  const max = Math.min(bal, MAX_TRANSFER);
  const m = new ModalFormData().title(`轉賬給 ${to.name}`);
  sliderCompat(m, `金額（上限 ${CURRENCY} ${nfmt(max)}）`, 1, max, Math.min(max, 100), 1);
  mc.system.run(() => {
    m.show(from).then(r => {
      if (r.canceled) return;
      doTransfer(from, to, Math.max(1, Math.floor(r.formValues[0] || 1)));
    });
  });
}
function doTransfer(from, to, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return from.sendMessage("§c金額必須是正整數。");
  if (from.id === to.id) return from.sendMessage("§c不能轉給自己。");
  const bal = getBal(from);
  if (amount > bal) return from.sendMessage(`§c餘額不足（${CURRENCY} ${nfmt(bal)}）。`);
  addBal(from, -amount);
  addBal(to, amount);
  from.sendMessage(`§a已轉賬 ${CURRENCY} ${nfmt(amount)} 給 ${to.name}。`);
  to.sendMessage(`§a收到 ${from.name} 轉賬 ${CURRENCY} ${nfmt(amount)}。`);
}

/* ==================== 商店系統 ==================== */
function shopMenu(p) {
  const f = new ActionFormData()
    .title(`${THEME.shop} ·  iPadOS`)
    .body(`${THEME.sep}\n選擇分類\n${THEME.sep}`);
  for (const cat of SHOP) f.button(cat.name);
  f.button(THEME.back);
  mc.system.run(() => {
    f.show(p).then(r => {
      if (r.canceled) return;
      if (r.selection === SHOP.length) return openMain(p);
      openCategory(p, r.selection);
    });
  });
}
function openCategory(p, idx) {
  const cat = SHOP[idx];
  const f = new ActionFormData()
    .title(`${cat.name}`)
    .body(`${THEME.sep}\n選擇要購買的物品\n${THEME.sep}`);
  for (const it of cat.items) f.button(`${it.name}\n單價：${CURRENCY} ${nfmt(it.price)}`);
  f.button(THEME.back);
  mc.system.run(() => {
    f.show(p).then(r => {
      if (r.canceled) return;
      if (r.selection === cat.items.length) return shopMenu(p);
      buyFlow(p, cat.items[r.selection], () => openCategory(p, idx));
    });
  });
}
function buyFlow(p, item, onBack) {
  const type = mc.ItemTypes.get(item.id);
  if (!type) { p.sendMessage("§c此物品在本版本不可用。"); return onBack?.(); }
  const bal = getBal(p);
  const maxByMoney = Math.floor(bal / item.price);
  if (maxByMoney <= 0) { p.sendMessage("§e餘額不足。"); return onBack?.(); }
  const maxBySpace = maxAddable(p, item.id);
  const max = Math.min(maxByMoney, maxBySpace, item.max ?? 64);
  if (max <= 0) { p.sendMessage("§e背包沒有足夠空間。"); return onBack?.(); }

  const f = new ModalFormData().title(`購買 ${item.name}`);
  sliderCompat(
    f,
    `數量（最多 ${nfmt(max)}）\n單價：${CURRENCY} ${nfmt(item.price)}\n總價=單價×數量`,
    1, max, Math.min(max, 16), 1
  );
  mc.system.run(() => {
    f.show(p).then(r => {
      if (r.canceled) return;
      const qty = Math.max(1, Math.floor(r.formValues[0] || 1));
      const cost = qty * item.price;
      if (getBal(p) < cost) return p.sendMessage("§c餘額變動，購買失敗。");
      const added = addItems(p, item.id, qty);
      if (added <= 0) return p.sendMessage("§c放入背包失敗。");
      addBal(p, -added * item.price);
      p.sendMessage(`§a已購買 ${item.name} × ${added}，花費 ${CURRENCY} ${nfmt(added * item.price)}。`);
      onBack?.();
    }).catch(console.warn);
  });
}

// 取得 Top N 玩家（優先用 scoreboard participants，兼容不同 API）
function getTopPlayers(limit = 10) {
  const o = getObj();
  let parts = [];
  try { parts = o.getParticipants(); } catch { parts = []; }

  const list = [];

  // 優先遍歷目標下的所有參與者（包含離線玩家）
  for (const id of parts) {
    let score;
    try { score = o.getScore(id); } catch { continue; }
    if (!Number.isFinite(score)) continue;

    // 僅保留真玩家（排除假玩家/隊伍等）
    let isPlayer = true;
    try {
      if (typeof mc.ScoreboardIdentityType !== "undefined" && id?.type !== undefined) {
        isPlayer = id.type === mc.ScoreboardIdentityType.Player;
      } else if ("player" in id) { // 舊 API：有 player 欄位即為玩家
        isPlayer = !!id.player;
      }
    } catch {}
    if (!isPlayer) continue;

    const name = id?.displayName ?? id?.player?.name ?? String(id?.name ?? "");
    if (!name) continue;

    list.push({ name, score });
  }

  // 後備：若 participants 取不到，至少把線上玩家列入
  if (list.length === 0) {
    for (const pl of mc.world.getPlayers()) {
      const score = getBal(pl);
      list.push({ name: pl.name, score });
    }
  }

  list.sort((a, b) => b.score - a.score);
  return list.slice(0, Math.max(1, Math.floor(limit)));
}

// 顯示排行榜 UI（MessageForm，含「刷新」與「返回」）
function showLeaderboard(p) {
  const top = getTopPlayers(10);
  let body = `${THEME.sep}\nAP 富豪榜（Top ${top.length}）\n${THEME.sep}\n`;
  if (top.length === 0) {
    body += "暫無數據。\n";
  } else {
    for (let i = 0; i < top.length; i++) {
      const rank = String(i + 1).padStart(2, " ");
      const name = top[i].name.length > 14 ? top[i].name.slice(0, 13) + "…" : top[i].name;
      body += `#${rank}  ${name}   ${CURRENCY} ${nfmt(top[i].score)}\n`;
    }
  }
  body += THEME.sep;

  const m = new MessageFormData()
    .title("🏆 排行榜")
    .body(body)
    .button1("刷新")
    .button2(THEME.back);

  mc.system.run(() => {
    m.show(p).then(r => {
      // MessageForm 的第一顆按鈕索引為 0、第二顆為 1
      if (r.selection === 0) return showLeaderboard(p); // 刷新
      if (r.selection === 1) return openMain(p);        // 返回
    }).catch(console.warn);
  });
}

/* ==================== 指令與備援 ==================== */
const hasPermEnum = mc.CommandPermissionLevel && typeof mc.CommandPermissionLevel.Any === "number";
const canRegCmd = !!(mc.system?.beforeEvents && "startup" in mc.system.beforeEvents);

if (canRegCmd) {
  mc.system.beforeEvents.startup.subscribe(({ customCommandRegistry: reg }) => {
    if (!reg) return;
    const base = (name, desc) =>
      hasPermEnum ? { name, description: desc, permissionLevel: mc.CommandPermissionLevel.Any }
                  : { name, description: desc };

    // /ap:menu
    reg.registerCommand(base("ap:menu", "打開 iPadOS 菜單"), (origin) => {
      const p = origin?.sourceEntity; if (!p) return;
      mc.system.run(() => openMain(p));
    });

    // /ap:bal
    reg.registerCommand(base("ap:bal", "查看 AP 餘額"), (origin) => {
      const p = origin?.sourceEntity; if (!p) return;
      mc.system.run(() => showBalance(p, () => openMain(p)));
    });

    // /ap:deposit <diamonds:Int?>
    reg.registerCommand(
      {
        ...base("ap:deposit", "用鑽石兌換 AP（單向）"),
        optionalParameters: [{ name: "diamonds", type: mc.CustomCommandParamType.Integer }]
      },
      (origin, diamonds) => {
        const p = origin?.sourceEntity; if (!p) return;
        mc.system.run(() => {
          const owned = countItem(p, DIAMOND_ID);
          const use = Math.max(1, Math.min(Math.floor(Number.isFinite(diamonds) ? Number(diamonds) : owned), owned));
          const removed = removeItems(p, DIAMOND_ID, use);
          if (removed <= 0) return p.sendMessage("§c沒有可兌換的鑽石。");
          const ap = removed * AP_PER_DIAMOND;
          addBal(p, ap);
          p.sendMessage(`§a已將 ${removed} 鑽石兌換為 ${CURRENCY} ${nfmt(ap)}。`);
        });
      }
    );

    // /ap:pay <玩家名> <金額>
    reg.registerCommand(
      {
        ...base("ap:pay", "轉賬給玩家"),
        mandatoryParameters: [
          { name: "player", type: mc.CustomCommandParamType.String },
          { name: "amount", type: mc.CustomCommandParamType.Integer }
        ]
      },
      (origin, targetName, amount) => {
        const from = origin?.sourceEntity; if (!from) return;
        const to = mc.world.getPlayers({ name: String(targetName) })[0];
        if (!to) return mc.system.run(() => from.sendMessage("§c找不到該玩家（需在線且名稱精確）。"));
        mc.system.run(() => doTransfer(from, to, Math.max(1, Math.floor(Number(amount) || 0))));
      }
    );
    // /ap:top
    reg.registerCommand(
        hasPermEnum
      ? { name: "ap:top", description: "查看 AP 富豪榜", permissionLevel: mc.CommandPermissionLevel.Any }
        : { name: "ap:top", description: "查看 AP 富豪榜" },
        (origin) => {
        const p = origin?.sourceEntity; if (!p) return;
        mc.system.run(() => showLeaderboard(p));
      }
    );

  });
}

// 聊天備援：!ap  !bal  !deposit [數量]  !pay 名稱 金額
if (mc.world?.beforeEvents?.chatSend) {
  mc.world.beforeEvents.chatSend.subscribe(ev => {
    const msg = (ev.message || "").trim();
    if (!/^!(ap|bal|pay|deposit)\b/i.test(msg)) return;
    ev.cancel = true;
    const p = ev.sender;

    if (msg === "!ap") return openMain(p);
    if (msg === "!bal") return showBalance(p, () => openMain(p));
    if (msg.startsWith("!deposit")) {
      const parts = msg.split(/\s+/);
      const owned = countItem(p, DIAMOND_ID);
      const use = Math.max(1, Math.min(Math.floor(Number(parts[1]) || owned), owned));
      const removed = removeItems(p, DIAMOND_ID, use);
      if (removed <= 0) return p.sendMessage("§c沒有可兌換的鑽石。");
      const ap = removed * AP_PER_DIAMOND;
      addBal(p, ap);
      return p.sendMessage(`§a已將 ${removed} 鑽石兌換為 ${CURRENCY} ${nfmt(ap)}。`);
    }
    if (msg.startsWith("!pay")) {
      const parts = msg.split(/\s+/);
      if (parts.length < 3) return p.sendMessage("§e用法：!pay 玩家名 金額");
      const to = mc.world.getPlayers({ name: parts[1] })[0];
      if (!to) return p.sendMessage("§c找不到該玩家（需在線且名稱精確）。");
      return doTransfer(p, to, Math.max(1, Math.floor(Number(parts[2]) || 0)));
    }
  });
}

/* ==================== 啟動與初始化 ==================== */
mc.world.afterEvents.playerSpawn.subscribe(ev => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  const o = getObj();
  if (START_BAL > 0) {
    try {
      o.setScore(p, START_BAL); // 直接使用 Player 實體初始化
    } catch {}
  }
});
mc.system.runTimeout(async () => {
  getObj(); // 原本就有
  await ensureStocksInit(); // 新增：初始化股市 scoreboard 與價格參與者
  mc.world.sendMessage("§a[AP10] iPadOS 經濟系統已載入：/ap:menu 或 !ap。");
}, 10);
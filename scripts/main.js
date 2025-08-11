// scripts/main.js
import * as mc from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

/* ==================== 配置區（可改） ==================== */
const AP_OBJ = "ap";                 // scoreboard 目標：AP 金幣
const CURRENCY = "AP";               // 幣別顯示
const DIAMOND_ID = "minecraft:diamond";
const AP_PER_DIAMOND = 100;          // 匯率：1 鑽石 -> 100 AP（單向）
const MAX_TRANSFER = 1_000_000_000;  // 轉帳上限
const START_BAL = 0;                 // 新玩家初始 AP
const THEME = {                      // iPadOS 風味字元
  title: "iPadOS 控制中心",
  bank: "🏦 銀行",
  shop: "🛒 商店",
  util: "🧰 功能",
  back: "‹ 返回",
  sep: "————————————"
};

// 商店清單（可自行添加/調整價格）
const SHOP = [
  {
    name: "🧰 工具 Tools",
    items: [
      { id: "minecraft:iron_pickaxe",   name: "鐵鎬",     price: 800,  max: 1 },
      { id: "minecraft:diamond_sword",  name: "鑽石劍",   price: 2000, max: 1 },
      { id: "minecraft:shield",         name: "盾牌",     price: 600,  max: 1 }
    ]
  },
  {
    name: "🧱 方塊 Blocks",
    items: [
      { id: "minecraft:oak_planks",     name: "橡木板",   price: 5,    max: 64 },
      { id: "minecraft:glass",          name: "玻璃",     price: 10,   max: 64 },
      { id: "minecraft:torch",          name: "火把",     price: 3,    max: 64 }
    ]
  },
  {
    name: "🍖 食物 Food",
    items: [
      { id: "minecraft:cooked_beef",    name: "牛排",     price: 40,   max: 64 },
      { id: "minecraft:bread",          name: "麵包",     price: 20,   max: 64 }
    ]
  }
];
/* ==================== 工具與基礎 ==================== */
function getObj() {
  let o = mc.world.scoreboard.getObjective(AP_OBJ);
  if (!o) o = mc.world.scoreboard.addObjective(AP_OBJ, "AP Coin");
  return o;
}
function getBal(p) {
  const o = getObj();
  try {
    const s = o.getScore(p.scoreboardIdentity);
    return Number.isFinite(s) ? Math.max(0, s) : 0;
  } catch { return 0; }
}
function setBal(p, val) {
  const o = getObj();
  o.setScore(p.scoreboardIdentity, Math.max(0, Math.floor(val)));
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
  let left = amount;
  for (let i = 0; i < c.size && left > 0; i++) {
    const it = c.getItem(i);
    if (!it || it.typeId !== id) continue;
    const take = Math.min(it.amount, left);
    it.amount -= take;
    left -= take;
    if (it.amount <= 0) c.setItem(i); else c.setItem(i, it);
  }
  return amount - left; // 實際移除數
}
function addItems(p, id, amount) {
  // 以差分實測方式添加，直到加不進去
  const before = countItem(p, id);
  const type = mc.ItemTypes.get(id);
  if (!type) return 0;
  let remain = amount;
  const c = inv(p); if (!c) return 0;

  while (remain > 0) {
    const stackSize = Math.min(remain, type.maxStackSize ?? 64);
    const st = new mc.ItemStack(type, stackSize);
    try { c.addItem(st); } catch { break; }
    const after = countItem(p, id);
    const added = after - (amount - remain + before);
    if (added <= 0) break;
    remain -= added;
  }
  return amount - remain;
}
function maxAddable(p, id) {
  // 粗估能放入的數量：既有同類剩餘空間 + 空槽*maxStack
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

/* ==================== iPadOS 主菜單 ==================== */
function openMain(p) {
  const bal = getBal(p);
  const f = new ActionFormData()
    .title(` ${THEME.title}`)
    .body(`${THEME.sep}\n玩家：${p.name}\n餘額：${CURRENCY} ${nfmt(bal)}\n${THEME.sep}`)
    .button(`${THEME.bank}\n管理餘額、兌換、轉賬`)
    .button(`${THEME.shop}\n購買道具與方塊`)
    .button(`${THEME.util}\n家點、實用工具`);
  mc.system.run(() => {
    f.show(p).then(res => {
      if (res.canceled) return;
      if (res.selection === 0) bankMenu(p);
      if (res.selection === 1) shopMenu(p);
      if (res.selection === 2) utilMenu(p);
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
  const f = new ModalFormData()
    .title("鑽石兌換 AP")
    .slider(`可兌換鑽石（最多 ${owned}）`, 1, owned, 1, Math.min(owned, 8));
  mc.system.run(() => {
    f.show(p).then(res => {
      if (res.canceled) return;
      const use = Math.floor(res.formValues[0] ?? 0);
      if (use <= 0) return;
      const removed = removeItems(p, DIAMOND_ID, use);
      if (removed <= 0) return p.sendMessage("§c兌換失敗：無法移除鑽石。");
      const ap = removed * AP_PER_DIAMOND;
      addBal(p, ap);
      p.sendMessage(`§a已將 ${removed} 鑽石兌換為 ${CURRENCY} ${nfmt(ap)}。`);
      bankMenu(p);
    }).catch(console.warn);
  });
}
function startTransferFlow(p) {
  const others = mc.world.getPlayers({ excludeNames: [p.name] });
  if (others.length === 0) { p.sendMessage("§e沒有其他在線玩家可轉賬。"); return; }
  const names = others.map(pl => pl.name);
  const pick = new ModalFormData()
    .title("選擇收款玩家")
    .dropdown("收款人", names, 0);
  mc.system.run(() => {
    pick.show(p).then(r => {
      if (r.canceled) return;
      const target = mc.world.getPlayers({ name: names[r.formValues[0]] })[0];
      if (!target) return p.sendMessage("§c對方已離線。");
      askTransferAmount(p, target);
    });
  });
}
function askTransferAmount(from, to) {
  const bal = getBal(from);
  if (bal <= 0) return from.sendMessage("§e你的餘額不足。");
  const m = new ModalFormData()
    .title(`轉賬給 ${to.name}`)
    .slider(`金額（上限 ${CURRENCY} ${nfmt(bal)}）`, 1, Math.min(bal, MAX_TRANSFER), 1, Math.min(bal, 100));
  mc.system.run(() => {
    m.show(from).then(r => {
      if (r.canceled) return;
      doTransfer(from, to, Math.floor(r.formValues[0] ?? 0));
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

  const step = Math.min(item.max ?? 64, 16);
  const m = new ModalFormData()
    .title(`購買 ${item.name}`)
    .slider(`數量（最多 ${nfmt(max)}）\n單價：${CURRENCY} ${nfmt(item.price)}\n總價=單價×數量`, 1, max, 1, Math.min(max, step));
  mc.system.run(() => {
    m.show(p).then(r => {
      if (r.canceled) return;
      const qty = Math.floor(r.formValues[0] ?? 0);
      if (qty <= 0) return;
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

/* ==================== 功能系統（家點） ==================== */
const HOME_TAG = "ap10:home"; // 內容格式：ap10:home:x,y,z,dimId
function utilMenu(p) {
  const hasHome = p.getTags().some(t => t.startsWith(`${HOME_TAG}:`));
  const f = new ActionFormData()
    .title(`${THEME.util} ·  iPadOS`)
    .body(`${THEME.sep}\n常用功能\n${THEME.sep}`)
    .button("設置家點（當前位置）")
    .button("回家" + (hasHome ? "" : "（未設置）"))
    .button(THEME.back);
  mc.system.run(() => {
    f.show(p).then(r => {
      if (r.canceled) return;
      if (r.selection === 0) setHome(p);
      if (r.selection === 1) goHome(p);
      if (r.selection === 2) openMain(p);
    });
  });
}
function setHome(p) {
  // 清除舊標籤
  for (const t of p.getTags()) if (t.startsWith(`${HOME_TAG}:`)) p.removeTag(t);
  const pos = p.location;
  const dim = p.dimension.id;
  const tag = `${HOME_TAG}:${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)},${dim}`;
  p.addTag(tag);
  p.sendMessage("§a已設定家點。");
  utilMenu(p);
}
function goHome(p) {
  const tag = p.getTags().find(t => t.startsWith(`${HOME_TAG}:`));
  if (!tag) { p.sendMessage("§e尚未設定家點。"); return utilMenu(p); }
  const [, payload] = tag.split(":"); // ap10:home:x,y,z,dim
  const [x, y, z, dim] = payload.split(",");
  try {
    const d = mc.world.getDimension(dim);
    p.teleport({ x: Number(x), y: Number(y), z: Number(z) }, { dimension: d, keepVelocity: false });
    p.sendMessage("§a已傳送到家點。");
  } catch { p.sendMessage("§c傳送失敗：家點維度不存在。"); }
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

    // /ap:deposit <diamonds:Int>
    reg.registerCommand(
      {
        ...base("ap:deposit", "用鑽石兌換 AP（單向）"),
        optionalParameters: [{ name: "diamonds", type: mc.CustomCommandParamType.Integer }]
      },
      (origin, diamonds) => {
        const p = origin?.sourceEntity; if (!p) return;
        mc.system.run(() => {
          const owned = countItem(p, DIAMOND_ID);
          const use = Math.min(Math.max(1, Number(diamonds) || owned), owned);
          const removed = removeItems(p, DIAMOND_ID, use);
          if (removed <= 0) return p.sendMessage("§c沒有可兌換的鑽石。");
          const ap = removed * AP_PER_DIAMOND;
          addBal(p, ap);
          p.sendMessage(`§a已將 ${removed} 鑽石兌換為 ${CURRENCY} ${nfmt(ap)}。`);
        });
      }
    );

    // /ap:pay <player:String> <amount:Int>
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
        mc.system.run(() => doTransfer(from, to, Number(amount)));
      }
    );
  });
}

// 聊天備援：!ap（主菜單）  !bal  !deposit [數量]  !pay 名稱 金額
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
      const use = Math.min(Math.max(1, Number(parts[1]) || owned), owned);
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
      return doTransfer(p, to, Number(parts[2]));
    }
  });
}

/* ==================== 啟動與初始化 ==================== */
mc.world.afterEvents.playerSpawn.subscribe(ev => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  // 初次給起始 AP（如有設定）
  const o = getObj();
  const had = o.hasParticipant(p.scoreboardIdentity);
  if (!had && START_BAL > 0) o.setScore(p.scoreboardIdentity, START_BAL);
});
mc.system.runTimeout(() => {
  getObj();
  mc.world.sendMessage("§a[AP10] iPadOS 經濟系統已載入：/ap:menu 或 !ap。");
}, 10);
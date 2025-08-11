// scripts/main.js
import * as mc from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

const OBJ = "eco";         // 計分板目標名
const CUR = "⛁";          // 貨幣符號
const START_BAL = 0;       // 新玩家起始金額
const MAX_TRANSFER = 1_000_000_000;

// ——— 工具：確保計分板存在 ———
function getObj() {
  let o = mc.world.scoreboard.getObjective(OBJ);
  if (!o) o = mc.world.scoreboard.addObjective(OBJ, "Economy");
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

// ——— 首登初始化 ———
mc.world.afterEvents.playerSpawn.subscribe(ev => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  const o = getObj();
  try {
    // 若未有分數，給起始金額
    const had = o.hasParticipant(p.scoreboardIdentity);
    if (!had && START_BAL > 0) o.setScore(p.scoreboardIdentity, START_BAL);
  } catch {}
});

// ——— UI ———
function openMainMenu(p) {
  const bal = getBal(p);
  const form = new ActionFormData()
    .title("經濟系統 AP10")
    .body(`玩家：${p.name}\n餘額：${CUR} ${bal.toLocaleString()}`)
    .button("查看餘額")
    .button("轉帳給玩家")
    .button("排行榜 TOP 15");

  mc.system.run(() => {
    form.show(p).then(res => {
      if (res.canceled) return;
      if (res.selection === 0) showBalance(p);
      if (res.selection === 1) startTransferFlow(p);
      if (res.selection === 2) showTop(p);
    }).catch(console.warn);
  });
}

function showBalance(p) {
  const bal = getBal(p);
  const msg = new MessageFormData()
    .title("我的餘額")
    .body(`你目前的餘額：\n${CUR} ${bal.toLocaleString()}`)
    .button1("關閉").button2("返回主選單");
  mc.system.run(() => msg.show(p).then(r => { if (r.selection === 1) openMainMenu(p); }));
}

function startTransferFlow(p) {
  const others = mc.world.getPlayers({ excludeNames: [p.name] });
  if (others.length === 0) {
    p.sendMessage("§e目前沒有其他在線玩家可轉帳。");
    return;
  }
  const names = others.map(x => x.name);
  const chooser = new ModalFormData()
    .title("選擇收款玩家")
    .dropdown("收款人", names, 0);
  mc.system.run(() => {
    chooser.show(p).then(res => {
      if (res.canceled) return;
      const idx = res.formValues[0];
      const target = mc.world.getPlayers({ name: names[idx] })[0];
      if (!target) return p.sendMessage("§c對方已離線。");
      askAmountAndTransfer(p, target);
    }).catch(console.warn);
  });
}

function askAmountAndTransfer(from, to) {
  const bal = getBal(from);
  if (bal <= 0) { from.sendMessage("§e你沒有可轉帳的金額。"); return; }
  const max = Math.min(bal, MAX_TRANSFER);
  const modal = new ModalFormData()
    .title(`轉帳給 ${to.name}`)
    .slider(`選擇金額（可轉上限：${CUR} ${max.toLocaleString()}）`, 1, max, 1, Math.min(100, max));
  mc.system.run(() => {
    modal.show(from).then(res => {
      if (res.canceled) return;
      const amt = Math.floor(res.formValues[0] ?? 0);
      doTransfer(from, to, amt);
    }).catch(console.warn);
  });
}

function doTransfer(from, to, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return from.sendMessage("§c金額必須是正整數。");
  if (from.id === to.id) return from.sendMessage("§c不能轉給自己。");
  const bal = getBal(from);
  if (amount > bal) return from.sendMessage(`§c餘額不足（目前 ${CUR} ${bal.toLocaleString()}）。`);
  addBal(from, -amount);
  addBal(to, amount);
  from.sendMessage(`§a已轉帳 ${CUR} ${amount.toLocaleString()} 給 ${to.name}。`);
  to.sendMessage(`§a收到 ${from.name} 轉帳 ${CUR} ${amount.toLocaleString()}。`);
}

function showTop(p) {
  const o = getObj();
  const parts = o.getParticipants();
  const rows = [];
  for (const part of parts) {
    const score = o.getScore(part);
    if (!Number.isFinite(score)) continue;
    rows.push({ name: part.displayName ?? "#unknown", score });
  }
  rows.sort((a, b) => b.score - a.score);
  const text = rows.slice(0, 15).map((r, i) =>
    `${i + 1}. ${r.name} — ${CUR} ${r.score.toLocaleString()}`
  ).join("\n") || "目前沒有資料";
  const msg = new MessageFormData().title("金幣排行榜").body(text).button1("關閉").button2("返回主選單");
  mc.system.run(() => msg.show(p).then(r => { if (r.selection === 1) openMainMenu(p); }));
}

// ——— 指令註冊（若可用），並提供聊天/ScriptEvent 備援 ———
const hasPermEnum = mc.CommandPermissionLevel && typeof mc.CommandPermissionLevel.Any === "number";
const canRegCmd = !!(mc.system?.beforeEvents && "startup" in mc.system.beforeEvents);

if (canRegCmd) {
  mc.system.beforeEvents.startup.subscribe(({ customCommandRegistry: reg }) => {
    if (!reg) return; // 某些版本沒有指令註冊器
    const base = (name, description) =>
      hasPermEnum ? { name, description, permissionLevel: mc.CommandPermissionLevel.Any }
                  : { name, description };

    // /eco:menu
    reg.registerCommand(base("eco:menu", "打開經濟系統菜單"), (origin) => {
      const p = origin?.sourceEntity; if (!p) return;
      mc.system.run(() => openMainMenu(p));
    });

    // /eco:bal
    reg.registerCommand(base("eco:bal", "查看餘額"), (origin) => {
      const p = origin?.sourceEntity; if (!p) return;
      mc.system.run(() => showBalance(p));
    });

    // /eco:pay <玩家名> <金額>
    reg.registerCommand(
      {
        ...base("eco:pay", "轉帳給指定玩家"),
        mandatoryParameters: [
          { name: "toName", type: mc.CustomCommandParamType.String },
          { name: "amount", type: mc.CustomCommandParamType.Integer }
        ],
      },
      (origin, toName, amount) => {
        const from = origin?.sourceEntity; if (!from) return;
        const to = mc.world.getPlayers({ name: String(toName) })[0];
        if (!to) return mc.system.run(() => from.sendMessage("§c找不到該玩家（需在線且名稱精確）。"));
        mc.system.run(() => doTransfer(from, to, Number(amount)));
      }
    );
  });
}

// 聊天前綴（兼容沒有自訂指令的版本）：!eco / !bal / !pay 名稱 金額
if (mc.world?.beforeEvents && mc.world.beforeEvents.chatSend) {
  mc.world.beforeEvents.chatSend.subscribe(ev => {
    const msg = (ev.message || "").trim();
    if (!msg.startsWith("!eco") && !msg.startsWith("!bal") && !msg.startsWith("!pay")) return;
    ev.cancel = true;
    const p = ev.sender;
    if (msg === "!eco") return openMainMenu(p);
    if (msg === "!bal") return showBalance(p);
    if (msg.startsWith("!pay")) {
      const parts = msg.split(/\s+/);
      if (parts.length < 3) return p.sendMessage("§e用法：!pay 玩家名 金額");
      const name = parts[1];
      const amt = Number(parts[2]);
      const to = mc.world.getPlayers({ name })[0];
      if (!to) return p.sendMessage("§c找不到該玩家（需在線且名稱精確）。");
      return doTransfer(p, to, amt);
    }
  });
}

// ScriptEvent 備援：/scriptevent ap10:menu ；/scriptevent ap10:pay|名字|金額
if (mc.system?.afterEvents && mc.system.afterEvents.scriptEventReceive) {
  mc.system.afterEvents.scriptEventReceive.subscribe(ev => {
    if (!ev.id) return;
    const p = ev.sourceEntity;
    if (!p || p.typeId !== "minecraft:player") return;
    if (ev.id === "ap10:menu") return openMainMenu(p);
    if (ev.id.startsWith("ap10:pay")) {
      const payload = String(ev.message || "");
      const [name, amtStr] = payload.split("|");
      const to = mc.world.getPlayers({ name })[0];
      if (!to) return p.sendMessage("§c找不到該玩家。");
      return doTransfer(p, to, Number(amtStr));
    }
  });
}

// 啟動提示
mc.system.runTimeout(() => {
  getObj(); // 確保目標已建立
  mc.world.sendMessage("§a[AP10] 經濟系統已載入：/eco:menu 或 !eco（若 / 無效）。");
}, 5);
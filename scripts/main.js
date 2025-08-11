// scripts/main.js
import * as mc from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";

const DB_KEY = "eco:balances"; // 世界層級動態屬性，存放 { [playerId]: number }
const CURRENCY = "⛁";          // 金幣符號
const START_BAL = 0;           // 新玩家起始金額
const MAX_TRANSFER = 1_000_000_000; // 轉帳上限（防呆）

// ——— 安全 JSON 讀寫 ———
function readDB() {
  try {
    const raw = mc.world.getDynamicProperty(DB_KEY);
    if (typeof raw === "string" && raw.length) return JSON.parse(raw);
  } catch {}
  return {};
}
function writeDB(obj) {
  try { mc.world.setDynamicProperty(DB_KEY, JSON.stringify(obj)); }
  catch (e) { console.warn("[Eco] writeDB failed:", e); }
}

function getBal(playerId) {
  const db = readDB();
  return Math.max(0, db[playerId] ?? 0);
}
function setBal(playerId, amount) {
  const db = readDB();
  db[playerId] = Math.max(0, Math.floor(amount));
  writeDB(db);
}
function addBal(playerId, delta) {
  setBal(playerId, getBal(playerId) + Math.floor(delta));
}

function ensurePlayerInit(p) {
  const db = readDB();
  if (!(p.id in db)) {
    db[p.id] = START_BAL;
    writeDB(db);
  }
}

// ——— 權限列舉相容處理 ———
const hasPermEnum = mc.CommandPermissionLevel && typeof mc.CommandPermissionLevel.Any === "number";
function cmdOpts(name, description, perm = "Any") {
  if (hasPermEnum) {
    const level = mc.CommandPermissionLevel[perm] ?? mc.CommandPermissionLevel.Any;
    return { name, description, permissionLevel: level };
  }
  return { name, description }; // 兼容：不填就不會丟 undefined
}

// ——— UI：主選單 ———
function openMainMenu(p) {
  ensurePlayerInit(p);
  const bal = getBal(p.id);

  const form = new ActionFormData()
    .title("經濟系統 Eco")
    .body(`玩家：${p.name}\n餘額：${CURRENCY} ${bal.toLocaleString()}`)
    .button("查看餘額")
    .button("轉帳給玩家")
    .button("排行榜 TOP 15");

  mc.system.run(() => {
    form.show(p).then((res) => {
      if (res.canceled) return;
      switch (res.selection) {
        case 0: showBalance(p); break;
        case 1: startTransferFlow(p); break;
        case 2: showTop(p); break;
      }
    }).catch((e) => console.warn(e));
  });
}

function showBalance(p) {
  const bal = getBal(p.id);
  const msg = new MessageFormData()
    .title("我的餘額")
    .body(`你目前的餘額是：\n${CURRENCY} ${bal.toLocaleString()}`)
    .button1("關閉").button2("返回主選單");
  mc.system.run(() => {
    msg.show(p).then((r) => { if (r.selection === 1) openMainMenu(p); });
  });
}

// ——— UI：轉帳流程（選人 → 選金額）———
function startTransferFlow(p) {
  const others = mc.world.getPlayers({ excludeNames: [p.name] });
  if (others.length === 0) {
    p.sendMessage("§e目前沒有其他線上玩家可轉帳。");
    return openMainMenu(p);
  }
  const list = others.map(pl => pl.name);
  const choose = new ModalFormData()
    .title("選擇收款玩家")
    .dropdown("收款人", list, 0);
  mc.system.run(() => {
    choose.show(p).then((res) => {
      if (res.canceled) return;
      const idx = res.formValues[0];
      const targetName = list[idx];
      const target = mc.world.getPlayers({ name: targetName })[0];
      if (!target) { p.sendMessage("§c對方已離線。"); return; }
      askAmountAndTransfer(p, target);
    }).catch(console.warn);
  });
}

function askAmountAndTransfer(from, to) {
  ensurePlayerInit(from);
  ensurePlayerInit(to);
  const bal = getBal(from.id);
  if (bal <= 0) {
    from.sendMessage("§e你沒有可轉帳的金額。");
    return openMainMenu(from);
  }
  const max = Math.min(bal, MAX_TRANSFER);
  const modal = new ModalFormData()
    .title(`轉帳給 ${to.name}`)
    .slider(`選擇金額（可轉上限：${CURRENCY} ${max.toLocaleString()}）`, 1, max, 1, Math.min(100, max));
  mc.system.run(() => {
    modal.show(from).then((res) => {
      if (res.canceled) return;
      const amount = Math.floor(res.formValues[0] ?? 0);
      doTransfer(from, to, amount);
    }).catch(console.warn);
  });
}

function doTransfer(from, to, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    from.sendMessage("§c金額必須是正整數。");
    return;
  }
  if (from.id === to.id) {
    from.sendMessage("§c不能轉給自己。");
    return;
  }
  const fromBal = getBal(from.id);
  if (amount > fromBal) {
    from.sendMessage(`§c餘額不足（目前 ${CURRENCY} ${fromBal.toLocaleString()}）。`);
    return;
  }
  addBal(from.id, -amount);
  addBal(to.id, amount);
  from.sendMessage(`§a已轉帳 ${CURRENCY} ${amount.toLocaleString()} 給 ${to.name}。`);
  to.sendMessage(`§a收到 ${from.name} 轉帳 ${CURRENCY} ${amount.toLocaleString()}。`);
}

// ——— UI：排行榜 ———
function showTop(p) {
  const db = readDB();
  const entries = Object.entries(db);
  // 將 playerId 映射成目前的玩家名稱（離線者以 id 末 6 碼代稱）
  const online = new Map(mc.world.getPlayers().map(pl => [pl.id, pl.name]));
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 15)
    .map(([id, val], i) => `${i + 1}. ${(online.get(id) ?? `#${id.slice(-6)}`)} — ${CURRENCY} ${val.toLocaleString()}`)
    .join("\n");
  const msg = new MessageFormData().title("金幣排行榜").body(top || "目前沒有資料").button1("關閉").button2("返回主選單");
  mc.system.run(() => { msg.show(p).then(r => { if (r.selection === 1) openMainMenu(p); }); });
}

// ——— 指令註冊 ———
mc.system.beforeEvents.startup.subscribe(({ customCommandRegistry: reg }) => {
  if (!reg) {
    mc.world.sendMessage("§c[Eco] 自訂指令無法使用（可能是 API 版本不符）。");
    return;
  }

  // /eco:menu
  reg.registerCommand(
    cmdOpts("eco:menu", "打開經濟系統菜單", "Any"),
    (origin) => {
      const p = origin?.sourceEntity;
      if (!p) return;
      mc.system.run(() => openMainMenu(p));
    }
  );

  // /eco:bal
  reg.registerCommand(
    cmdOpts("eco:bal", "查看餘額", "Any"),
    (origin) => {
      const p = origin?.sourceEntity;
      if (!p) return;
      mc.system.run(() => showBalance(p));
    }
  );

  // /eco:pay <playerName:String> <amount:Int>
  reg.registerCommand(
    {
      ...cmdOpts("eco:pay", "轉帳給指定玩家", "Any"),
      mandatoryParameters: [
        { name: "toName", type: mc.CustomCommandParamType.String },
        { name: "amount", type: mc.CustomCommandParamType.Integer },
      ],
    },
    (origin, toName, amount) => {
      const from = origin?.sourceEntity;
      if (!from) return;
      const to = mc.world.getPlayers({ name: String(toName) })[0];
      if (!to) return mc.system.run(() => from.sendMessage("§c找不到該玩家（需要精確名稱且在線）。"));
      mc.system.run(() => doTransfer(from, to, Number(amount)));
    }
  );

  // 範例管理員指令：/eco:give <playerName> <amount>（可改成 Host/Admin）
  reg.registerCommand(
    {
      ...cmdOpts("eco:give", "管理員加錢", hasPermEnum ? "Admin" : "Any"),
      mandatoryParameters: [
        { name: "toName", type: mc.CustomCommandParamType.String },
        { name: "amount", type: mc.CustomCommandParamType.Integer },
      ],
    },
    (origin, toName, amount) => {
      const src = origin?.sourceEntity;
      const to = mc.world.getPlayers({ name: String(toName) })[0];
      if (!to) return src && mc.system.run(() => src.sendMessage("§c找不到該玩家（需在線）。"));
      mc.system.run(() => {
        ensurePlayerInit(to);
        addBal(to.id, Math.max(0, Number(amount)));
        src?.sendMessage(`§a已為 ${to.name} 增加 ${CURRENCY} ${Number(amount).toLocaleString()}`);
        to.sendMessage(`§a管理員發給你 ${CURRENCY} ${Number(amount).toLocaleString()}`);
      });
    }
  );
});

// 世界載入提示
mc.world.afterEvents.worldLoad.subscribe(() => {
  const hint = hasPermEnum ? "" : "（檢測不到 CommandPermissionLevel，已啟用相容模式）";
  mc.world.sendMessage(`§a[Eco] 已載入：/eco:menu、/eco:bal、/eco:pay ${hint}`);
});

// 新玩家初始化
mc.world.afterEvents.playerSpawn.subscribe((ev) => {
  if (ev.initialSpawn) ensurePlayerInit(ev.player);
});
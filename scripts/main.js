// scripts/main.js
import * as mc from "@minecraft/server";

const KEY = "my:addon:homes";

// —— 小工具：安全讀寫世界層級 JSON 動態屬性 ——
function readHomes() {
  try {
    const raw = mc.world.getDynamicProperty(KEY);
    if (typeof raw === "string" && raw.length) return JSON.parse(raw);
  } catch {}
  return {};
}
function writeHomes(obj) {
  try {
    mc.world.setDynamicProperty(KEY, JSON.stringify(obj));
  } catch (e) {
    mc.world.sendMessage("§c[MyPack] 寫入家點資料失敗，請檢查 Content Log。");
    console.warn(e);
  }
}

// —— 註冊指令（穩健處理 permissionLevel）——
mc.system.beforeEvents.startup.subscribe((ev) => {
  const reg = ev.customCommandRegistry;
  if (!reg) {
    mc.world.sendMessage("§c[MyPack] 自訂指令系統不可用（可能是 API 版本不符）。");
    return;
  }

  // 動態組合 options，避免 permissionLevel: undefined
  const canSetPerm =
    mc.CommandPermissionLevel && typeof mc.CommandPermissionLevel.Any === "number";
  const cmdOpts = (name, description) =>
    canSetPerm
      ? { name, description, permissionLevel: mc.CommandPermissionLevel.Any }
      : { name, description };

  // /my:sethome
  reg.registerCommand(
    cmdOpts("my:sethome", "把你目前位置設為家點"),
    (origin) => {
      const p = origin?.sourceEntity;
      if (!p) return;

      const homes = readHomes();
      homes[p.id] = {
        x: p.location.x,
        y: p.location.y,
        z: p.location.z,
        dim: p.dimension.id,
      };
      writeHomes(homes);

      // 在下一個 tick 回饋訊息（避免 before 階段限制）
      mc.system.run(() => p.sendMessage("§a已設定家點！"));
    }
  );

  // /my:home
  reg.registerCommand(
    cmdOpts("my:home", "傳送回家點"),
    (origin) => {
      const p = origin?.sourceEntity;
      if (!p) return;

      const home = readHomes()[p.id];
      if (!home) {
        return mc.system.run(() =>
          p.sendMessage("§e你還沒有家點。先用 §b/my:sethome §e設定吧！")
        );
      }

      mc.system.run(() => {
        try {
          const dim = mc.world.getDimension(home.dim);
          p.teleport({ x: home.x, y: home.y, z: home.z }, { dimension: dim, keepVelocity: false });
          p.sendMessage("§a已傳送到家點！");
        } catch (e) {
          p.sendMessage("§c傳送失敗：目標維度不存在或座標無效。");
          console.warn(e);
        }
      });
    }
  );
});

// —— 世界載入提示 —— 
mc.world.afterEvents.worldLoad.subscribe(() => {
  const hasPerm =
    mc.CommandPermissionLevel && typeof mc.CommandPermissionLevel.Any === "number";
  mc.world.sendMessage(
    `§a[MyPack] 已載入：/my:sethome、/my:home${hasPerm ? "" : "（提示：未偵測到 CommandPermissionLevel，已使用兼容模式）"}`
  );
});

// —— 小建議：若要清除所有家點，可在聊天輸入以下一次性命令（需 OP）：
// /scriptevent my:clearhomes
// 你可以再加一段事件監聽註冊這個 scriptevent 來清空 KEY。
(() => {
  "use strict";
  const storageKey = "dafeiyu-local-connection-v1";
  const standalone = document.body.dataset.chatOnly === "true";
  const panel = document.createElement("section");
  panel.id = "dsh-panel";
  panel.className = "dsh-panel";
  panel.setAttribute("aria-label", "与大肥鱼聊天");
  panel.hidden = !standalone;
  panel.innerHTML = `
    <header class="dsh-heading"><strong>和她聊聊</strong><button type="button" id="dsh-close" aria-label="收起聊天">×</button></header>
    <p id="dsh-status" class="dsh-status" role="status">尚未连接</p>
    <details id="dsh-settings">
      <summary>连接设置与配对</summary>
      <label>本地连接器地址<input id="dsh-url" type="url" spellcheck="false" value="http://127.0.0.1:37621"></label>
      <label>配对码<input id="dsh-code" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="本地连接器显示的八位数字"></label>
      <p id="dsh-pair-label" hidden></p>
      <div class="dsh-buttons"><button type="button" id="dsh-connect">连接 / 重试</button><button type="button" id="dsh-disconnect">断开</button><a id="dsh-browser" target="_blank" rel="noreferrer">浏览器聊天页</a></div>
      <p class="dsh-note">在 DSH 安装并启用 dsh-room-world。桌面程序会自动连接；QQ 消息可同步到这里，桌面回复只留在这里。</p>
    </details>
    <div id="dsh-messages" class="dsh-messages" role="log" aria-label="聊天记录" aria-live="polite"></div>
    <button type="button" id="dsh-refresh" class="dsh-refresh">检查聊天记录</button>
    <form id="dsh-chat-form">
      <label class="dsh-input-label" for="dsh-text">给她发消息</label>
      <textarea id="dsh-text" maxlength="4000" rows="2" placeholder="说点什么吧……" disabled></textarea>
      <div class="dsh-compose"><span>Enter 发送 · Shift+Enter 换行</span><button id="dsh-send" type="submit" disabled>发送</button></div>
    </form>`;
  document.body.append(panel);
  const $ = id => panel.querySelector("#" + id);
  const status = $("dsh-status");
  const settings = $("dsh-settings");
  const urlInput = $("dsh-url");
  const codeInput = $("dsh-code");
  const textInput = $("dsh-text");
  const sendButton = $("dsh-send");
  const messages = $("dsh-messages");
  const browserLink = $("dsh-browser");
  const seen = new Set();
  let base = "http://127.0.0.1:37621";
  let token = "";
  let connection = 0;
  let controller;
  let connected = false;
  let sending = false;
  let bootId = "";
  let cursor = null;
  let roomCursor = null;
  let roomBoot = "";
  let qqCursor = null;
  let qqRole = "";
  let roomAware = false;
  let roomSnapshot = null;
  let syncingRoom = false;
  let roomSyncTimer;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "dsh-open";
  toggle.textContent = "连接 DSH";
  document.querySelector(".settings")?.append(toggle);
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && connected) textInput.focus();
  });
  $("dsh-close").hidden = standalone;
  $("dsh-close").addEventListener("click", () => { panel.hidden = true; });

  function notice(text, error = false) {
    status.textContent = text;
    status.classList.toggle("dsh-error", error);
  }
  function errorText(error) {
    return [error.message || "连接暂时不可用", error.hint || "检查本地连接器和 DSH 后点击连接 / 重试。"].join("。");
  }
  function normalizeBase(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error("本地连接器地址无效"); }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash ||
        !["", "/"].includes(url.pathname)) throw new Error("请使用连接器显示的 http://127.0.0.1 地址");
    return url.origin;
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({ base, token })); } catch { /* Connection remains usable for this page. */ }
  }
  function updateComposer() {
    textInput.disabled = sendButton.disabled = !connected || sending;
    sendButton.textContent = sending ? "等待回复…" : "发送";
  }
  function disconnect(clear = false) {
    connection++;
    controller?.abort();
    connected = false;
    bootId = "";
    cursor = null;
    roomCursor = null;
    roomBoot = "";
    qqCursor = null;
    qqRole = "";
    roomAware = false;
    toggle.textContent = "连接 DSH";
    updateComposer();
    if (clear) { token = ""; persist(); }
  }
  async function request(route, { method = "GET", body, timeout = 35000, signal = controller?.signal } = {}) {
    const requestController = new AbortController();
    const abort = () => requestController.abort();
    if (signal?.aborted) requestController.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeout);
    try {
      const response = await fetch(base + route, {
        method, mode: "cors", credentials: "omit", cache: "no-store",
        headers: { ...(token ? { "x-wallpaper-token": token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: requestController.signal,
      });
      let result;
      try { result = await response.json(); } catch { throw new Error("本地连接器返回了无法读取的内容"); }
      if (!response.ok || result?.ok !== true) {
        throw Object.assign(new Error(result?.error || "连接请求失败"), { code: result?.code, hint: result?.hint });
      }
      return result;
    } catch (error) {
      if (error.name === "TypeError" || error.name === "AbortError") {
        throw Object.assign(new Error("暂时没有收到本地连接器的响应"), { hint: "确认连接器窗口仍在运行。消息发送后超时，可先检查聊天记录，再决定是否重新发送。" });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  function addMessage(message) {
    if (!message?.text) return false;
    const id = String(message.id || "");
    if (id && seen.has(id)) return false;
    if (id) seen.add(id);
    const item = document.createElement("p");
    item.className = "dsh-message " + (message.role === "user" ? "dsh-user" : "dsh-assistant");
    item.textContent = (message.channel === "qq" ? "QQ · " : "") + message.text;
    messages.append(item);
    while (messages.children.length > 80) messages.firstElementChild.remove();
    while (seen.size > 512) seen.delete(seen.values().next().value);
    messages.scrollTop = messages.scrollHeight;
    return true;
  }
  function bubble(text) {
    window.dispatchEvent(new CustomEvent("dafeiyu:dsh-reply", { detail: { text: String(text || "") } }));
  }
  async function history() {
    const result = await request("/api/history");
    messages.replaceChildren();
    seen.clear();
    for (const message of result.messages || []) addMessage(message);
  }
  async function poll(version) {
    let recovering = false;
    while (version === connection) {
      try {
        const query = cursor === null ? "" : "?since=" + cursor;
        const result = await request("/api/events" + query);
        if (version !== connection) return;
        if (recovering) { notice("已恢复 SurfCore 连接。"); recovering = false; }
        const reset = !bootId || result.bootId !== bootId;
        bootId = result.bootId;
        cursor = result.cursor;
        if (!reset) {
          for (const event of result.events || []) {
            if (!["reply", "proactive"].includes(event.type) || !event.text) continue;
            const fresh = addMessage({ id: event.messageId || "event-" + bootId + "-" + event.id, role: "assistant", text: event.text });
            if (fresh && !(event.type === "proactive" && result.focus)) bubble(event.text);
          }
        }
      } catch (error) {
        if (version !== connection) return;
        notice(errorText(error), true);
        recovering = true;
        if (error.code === "PAIR_REQUIRED") {
          disconnect(true);
          settings.open = true;
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  async function pollRoom(version) {
    while (version === connection) {
      try {
        const result = await request("/api/room-events" + (roomCursor === null ? "" : "?since=" + roomCursor));
        if (version !== connection) return;
        const reset = !roomBoot || roomBoot !== result.bootId;
        roomBoot = result.bootId;
        roomCursor = result.cursor;
        if (!reset) {
          for (const event of result.events || []) {
            addMessage(event.userMessage);
            if (addMessage(event.reply)) bubble(event.reply.text);
          }
        }
      } catch (error) {
        if (version !== connection) return;
        notice(errorText(error), true);
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  async function syncRoom() {
    if (!connected || !roomAware || !roomSnapshot || syncingRoom) return;
    syncingRoom = true;
    const version = connection;
    const snapshot = roomSnapshot;
    try {
      await request("/api/room-state", { method: "POST", body: snapshot });
    } catch (error) {
      if (version === connection) notice(errorText(error), true);
    } finally {
      syncingRoom = false;
      if (version === connection && snapshot !== roomSnapshot) void syncRoom();
    }
  }
  window.addEventListener("dafeiyu:room-state", event => {
    roomSnapshot = event.detail;
    clearTimeout(roomSyncTimer);
    roomSyncTimer = setTimeout(() => { void syncRoom(); }, 200);
  });
  window.dispatchEvent(new CustomEvent("dafeiyu:request-room-state"));
  setInterval(() => {
    window.dispatchEvent(new CustomEvent("dafeiyu:request-room-state"));
    void syncRoom();
  }, 10000);

  async function pollQq(version) {
    while (version === connection) {
      try {
        const result = await request("/api/qq-events" + (qqCursor === null ? "" : "?since=" + qqCursor));
        if (version !== connection) return;
        const reset = qqRole !== result.roleId;
        if (reset && qqRole) await history();
        qqRole = result.roleId;
        qqCursor = result.cursor;
        if (!reset) {
          for (const event of result.events || []) {
            const fresh = addMessage(event.message);
            if (fresh && event.message?.role === "assistant") bubble(event.message.text);
            if (event.command && Date.now() - event.message.at < 60000) {
              window.dispatchEvent(new CustomEvent("dafeiyu:room-command", { detail: event.command }));
            }
          }
        }
      } catch (error) {
        if (version !== connection) return;
        notice(errorText(error), true);
      }
      await new Promise(resolve => setTimeout(resolve, 1800));
    }
  }
  async function connect() {
    disconnect();
    const version = connection;
    controller = new AbortController();
    notice("正在连接…");
    try {
      base = normalizeBase(urlInput.value);
      browserLink.href = base + "/chat";
      if (location.origin === base) {
        const result = await request("/api/bootstrap");
        if (version !== connection) return;
        token = result.session;
        $("dsh-pair-label").textContent = "本次配对码  " + result.pairCode;
        $("dsh-pair-label").hidden = false;
      } else if (codeInput.value.trim()) {
        const result = await request("/api/pair", { method: "POST", body: { code: codeInput.value } });
        if (version !== connection) return;
        token = result.session;
        codeInput.value = "";
      } else if (!token) {
        throw Object.assign(new Error("请输入配对码"), { hint: "启动连接器，在浏览器页面的连接设置中查看八位配对码。" });
      }
      const result = await request("/api/status");
      if (version !== connection) return;
      connected = true;
      roomAware = result.roomAware === true;
      persist();
      toggle.textContent = "和她聊聊 · 已连接";
      updateComposer();
      notice(result.chat?.enabled && result.llm?.ready ? "已连接 " + (result.role?.name || "SurfCore") :
        "已连接，需在 DSH 中开启桌宠对话并选择默认模型", !result.chat?.enabled || !result.llm?.ready);
      if (!roomAware) notice("请在 DSH 中启用独立房间插件 dsh-room-world。", true);
      if (result.syncError) notice("房间已连接；QQ 同步：" + result.syncError, true);
      if (roomAware) await syncRoom();
      await history();
      if (version !== connection) return;
      void poll(version);
      void pollRoom(version);
      if (roomAware) { void pollQq(version); void pollWorld(version); }
    } catch (error) {
      if (version !== connection) return;
      connected = false;
      toggle.textContent = "连接 DSH · 重试";
      updateComposer();
      notice(errorText(error), true);
      settings.open = true;
    }
  }
  $("dsh-connect").addEventListener("click", () => { void connect(); });
  $("dsh-disconnect").addEventListener("click", () => { disconnect(true); notice("已断开，本地房间互动仍可使用。"); });
  $("dsh-refresh").addEventListener("click", async () => {
    try { await history(); notice("聊天记录已更新。"); } catch (error) { notice(errorText(error), true); }
  });
  $("dsh-chat-form").addEventListener("submit", async event => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text || !connected || sending) return;
    sending = true;
    updateComposer();
    notice("她正在想怎么回复…");
    const version = connection;
    try {
      const result = await request("/api/chat", { method: "POST",
        body: { text, requestId: crypto.randomUUID(), ...(roomAware && roomSnapshot ? { room: roomSnapshot } : {}) }, timeout: 195000 });
      if (version !== connection) return;
      addMessage(result.userMessage);
      const fresh = addMessage(result.reply);
      textInput.value = "";
      if (fresh) bubble(result.reply.text);
      notice("已收到回复。");
    } catch (error) {
      if (version === connection) notice(errorText(error), true);
    } finally {
      sending = false;
      updateComposer();
    }
  });
  textInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      $("dsh-chat-form").requestSubmit();
    }
  });
  window.addEventListener("beforeunload", () => disconnect());

  // The owner can only look and guide here; every world action is hers (autonomous executor or her plan).
  const worldPanel = document.createElement("section");
  worldPanel.className = "dsh-panel world-panel";
  worldPanel.hidden = true;
  worldPanel.innerHTML = `<header class="dsh-heading"><strong>她的小天地</strong><button id="world-close" aria-label="收起小天地">×</button></header>
    <p id="world-state" class="world-state" role="status">连接 DSH 后查看她的小天地。</p>
    <nav class="world-tabs" role="tablist">
      <button role="tab" data-tab="home" aria-selected="true">概况</button><button role="tab" data-tab="store">仓库</button>
      <button role="tab" data-tab="shop">商店</button><button role="tab" data-tab="codex">图鉴</button><button role="tab" data-tab="log">日记</button>
    </nav>
    <div id="world-body" class="world-body"></div>
    <form id="world-wish" class="world-wish">
      <label for="world-wish-text">给她留个心愿（她会自己决定要不要做、怎么做）</label>
      <div class="world-wish-row"><input id="world-wish-text" maxlength="80" placeholder="比如：想看看大西瓜 / 多陪陪鱼缸里的小鱼"><button type="submit">留下</button></div>
      <div class="world-chips"></div>
    </form>
    <div class="dsh-buttons"><button data-world="replan">请她重新想想打算</button></div>`;
  document.body.append(worldPanel);
  const worldToggle = document.createElement("button"); worldToggle.textContent = "小天地";
  document.querySelector(".settings")?.append(worldToggle);
  worldToggle.onclick = () => { worldPanel.hidden = !worldPanel.hidden; if (!worldPanel.hidden) void refreshTab(); };
  worldPanel.querySelector("#world-close").onclick = () => { worldPanel.hidden = true; };
  const worldState = worldPanel.querySelector("#world-state");
  const worldBody = worldPanel.querySelector("#world-body");
  const wishInput = worldPanel.querySelector("#world-wish-text");
  const areaNames = { room: "小屋", farm: "农场", garden: "花园", pond: "池塘" };
  const phaseNames = { morning: "清晨", day: "白天", dusk: "黄昏", night: "夜晚" };
  const activityNames = { market: "在集市买卖", outing: "出门了", idle: "休息", explore: "散步", plant: "播种", water: "浇水", harvest: "收获", fertilize: "施肥", fishing: "钓鱼", cook: "煮饭", brew: "泡茶", feed: "照顾鱼缸", decorate: "插花" };
  const itemNames = { "rice-bowl": "白米饭", bran: "米糠", bait: "普通鱼饵", "bait-pro": "高级鱼饵", "bait-glow": "夜光鱼饵", fishmeal: "鱼肥", compost: "有机肥", "flower-tea": "花茶" };
  const icons = { crop: "🌾", flower: "🌸", fish: "🐟" };
  const rarityNames = { common: "普通", uncommon: "少见", rare: "稀有", legendary: "传说" };
  const byNames = { self: "她自己", owner: "你", tool: "聊天里" };
  const wishIdeas = ["想看看巨大的果实", "鱼缸里想多几条鱼", "种点好看的花吧", "攒钱扩一块地", "别太累，歇一歇"];
  let worldCommandCursor = 0, worldCommandBoot = "", lastWorld = null, tab = "home", signature = "", extra = null;
  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c != null)); return node; };
  const mins = ms => ms <= 0 ? "马上" : ms < 3600000 ? Math.ceil(ms / 60000) + " 分钟" : (ms / 3600000).toFixed(1) + " 小时";
  const time = at => new Date(at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const gradeName = id => ({ s: "小", m: "中", l: "大", xl: "巨大" })[id] || id;
  const speciesName = id => lastWorld?.names?.[id] || id;
  worldPanel.querySelector(".world-chips").append(...wishIdeas.map(text => {
    const chip = el("button", { type: "button", textContent: text }); chip.onclick = () => { wishInput.value = text; wishInput.focus(); }; return chip;
  }));
  async function worldAction(body) {
    if (!connected) { worldState.textContent = "请先连接 DSH。"; return null; }
    try {
      const result = await request("/api/world", { method: "POST", body: { ...body, requestId: crypto.randomUUID() }, timeout: body.action === "replan" ? 200000 : 35000 });
      if (result.text) flash(result.text);
      if (result.shop || result.codex) extra = { shop: result.shop || extra?.shop, codex: result.codex || extra?.codex };
      signature = ""; renderWorld(result.world);
      return result;
    } catch (e) { flash(e.message || errorText(e), true); return null; }
  }
  let flashTimer, flashing = false;
  function flash(text, error = false) {
    worldState.textContent = text; worldState.classList.toggle("dsh-error", error); flashing = true;
    clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashing = false; worldState.classList.remove("dsh-error"); renderStatus(); }, 6000);
  }
  async function refreshTab() {
    if (!connected) return;
    if (tab === "shop") await worldAction({ action: "shop" });
    else if (tab === "codex") await worldAction({ action: "codex" });
    else renderWorld(lastWorld);
  }
  worldPanel.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => {
    tab = button.dataset.tab;
    worldPanel.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b === button)));
    signature = ""; void refreshTab();
  });
  worldPanel.querySelector("#world-wish").addEventListener("submit", async event => {
    event.preventDefault();
    const text = wishInput.value.trim(); if (!text) return;
    if (await worldAction({ action: "wish", text })) wishInput.value = "";
  });
  worldPanel.querySelector("[data-world=replan]").onclick = async event => {
    const button = event.currentTarget; button.disabled = true; flash("她在想接下来做什么…");
    await worldAction({ action: "replan" }); button.disabled = false;
  };
  function renderStatus() {
    const w = lastWorld; if (!w || flashing) return;
    const mode = w.autonomous ? (activityNames[w.activity] || "忙着") : "歇息中，" + time(w.restUntil) + " 后继续";
    worldState.textContent = `${phaseNames[w.phase] || ""} · ${areaNames[w.location]} · ${mode}｜🐚 ${w.shells} 贝壳 · 仓库 ${w.warehouse.length}/${w.warehouseLimit} · 图鉴 ${w.codex.found}/${w.codex.total}`;
  }
  function plotRow(p, slot, t) {
    let text;
    if (!p) text = `${slot + 1}号 · 空地`;
    else {
      const tags = [p.fertilizer ? "已施肥" : "", p.lineage ? "血统+" + p.lineage : ""].filter(Boolean).join(" · ");
      text = `${slot + 1}号 ${p.name} · ` + (p.ready ? (p.overripe ? "过熟了，等她来收" : "成熟啦，等她来收") : p.thirsty ? `第${p.stage + 1}段 · 口渴，等她来浇` : `第${p.stage + 1}段 · 还差 ${mins(p.stageEndsAt - t)}`) + (tags ? " · " + tags : "");
    }
    const bar = el("span", { className: "world-bar" }); bar.style.setProperty("--p", String(p ? p.progress : 0));
    return el("div", { className: "world-plot" }, el("span", { className: "world-label" }, el("span", { textContent: text }), bar));
  }
  function describeStep(s) {
    const what = s.species ? speciesName(s.species) : s.item ? (s.item.startsWith("seed:") ? speciesName(s.item.slice(5)) + "种子" : itemNames[s.item] || s.item) : "";
    const names = { visit: "去" + (areaNames[s.area] || ""), plant: "种" + what, water: "浇水", harvest: "收获", fertilize: "施肥", cast: "钓鱼", collect: "收竿", buy: "买" + what + (s.qty > 1 ? " ×" + s.qty : ""),
      sell: "卖" + (what || "东西"), cook: "煮饭", brew: "泡花茶", craft: s.recipe === "bait" ? "做鱼饵" : "做鱼肥", keep: "养进鱼缸", release: "放生", decorate: "插花", deliver: "交委托" };
    return names[s.action] || s.action;
  }
  function renderHome(w) {
    const t = w.serverTime;
    const plan = w.plan ? el("div", { className: "world-card" },
      el("strong", { textContent: "她的打算：" + w.plan.goal }),
      w.plan.why ? el("p", { textContent: w.plan.why }) : null,
      w.plan.say ? el("p", { className: "world-say", textContent: "「" + w.plan.say + "」" }) : null,
      el("ol", {}, ...w.plan.steps.map((s, i) => el("li", { className: s.status || (i === w.plan.cursor && w.plan.status === "active" ? "now" : ""),
        textContent: describeStep(s) + (s.error ? "（没成：" + s.error + "）" : s.waiting && i === w.plan.cursor ? "（等待：" + s.waiting + "）" : "") }))),
      el("p", { className: "dsh-note", textContent: `${({ active: "进行中", done: "已完成", failed: "没能完成", expired: "已过期" })[w.plan.status]} · 由${byNames[w.plan.source] || "她"}定下 · 今天规划 ${w.planner?.used ?? 0}/${w.plannerConfig?.maxPerDay ?? 4} 次` + (w.planner?.lastError ? " · " + w.planner.lastError : "") }))
      : el("div", { className: "world-card" }, el("p", { textContent: "她还在想今天要做什么，先按自己的习惯照料小天地。" }),
        w.planner?.lastError ? el("p", { className: "dsh-note", textContent: w.planner.lastError }) : null);
    const wishes = w.wishes?.length ? el("div", { className: "world-card world-wishes" }, el("strong", { textContent: "你留下的心愿" }),
      ...w.wishes.slice().reverse().map(x => el("p", { textContent: `${x.seen ? "💭 她看过了" : "✉️ 还没看到"} · ${x.source === "qq" ? "QQ：" : ""}${x.text}` }))) : null;
    const crave = Object.keys(w.cravings || {}).map(k => k === "rice" ? "想吃白米饭" : k === "tea" ? "想喝花茶" : k).join("、");
    const f = w.fishing;
    const pondText = !f ? "池塘 · 水波轻轻" : f.state === "waiting" ? `池塘 · 她在安静等鱼（${itemNames[f.bait] || "不用鱼饵"}）` : f.state === "bite" ? `池塘 · 有鱼咬钩！她会在 ${mins(f.escapeAt - t)} 内收竿` : "池塘 · 鱼跑掉了";
    const orders = el("div", {}, el("h3", { textContent: "今日委托" }), ...w.orders.map(o => el("p", {
      textContent: `${o.done ? "✅ " : "· "}${speciesName(o.species)} ×${o.count}${o.minGrade ? "（" + gradeName(o.minGrade) + "以上）" : ""} → ${o.reward} 贝壳` })));
    const market = w.market.length ? el("p", { className: "dsh-note", textContent: "今日行情高：" + w.market.slice(0, 4).map(m => m.name + " ×" + m.factor).join("、") }) : null;
    return [plan, wishes, crave ? el("p", { className: "world-crave", textContent: "惦记：" + crave }) : null,
      el("h3", { textContent: "农场" }), ...w.farm.map((p, i) => plotRow(p, i, t)),
      el("h3", { textContent: "花园" }), ...w.garden.map((p, i) => plotRow(p, i, t)),
      el("h3", { textContent: "池塘" }), el("p", { textContent: pondText }), orders, market];
  }
  const iconFor = (kind, species) => ({ crop: "crop-", flower: "flower-", fish: "fish-" })[kind] + species;
  function iconRow(name, fallback, text, extra) {
    const row = el("p", { className: "icon-row" });
    const pic = el("img", { className: "row-icon", alt: "" });
    pic.onerror = () => pic.replaceWith(document.createTextNode(fallback + " "));
    pic.src = "/assets/world/" + name + ".png";
    row.append(pic, document.createTextNode(text));
    if (extra) row.append(extra);
    return row;
  }
  function renderStore(w) {
    const groups = { crop: [], flower: [], fish: [] };
    for (const item of w.warehouse) groups[item.kind]?.push(item);
    const seeds = Object.entries(w.seeds).map(([id, s]) => speciesName(id) + " ×" + s.count + (s.bestLineage ? "（血统+" + s.bestLineage + "）" : "")).join("、") || "没有";
    const items = Object.entries(w.items).map(([id, n]) => (itemNames[id] || id) + " ×" + n).join("、") || "没有";
    return [el("p", { textContent: "种子：" + seeds }), el("div", { className: "item-chips" }, ...Object.entries(w.items).map(([id, n]) => iconRow("item-" + id, "·", `${itemNames[id] || id} ×${n}`))),
      ...["crop", "flower", "fish"].flatMap(kind => groups[kind].length ? [el("h3", { textContent: { crop: "作物", flower: "花", fish: "鱼" }[kind] + "（" + groups[kind].length + "）" }),
        ...groups[kind].map(item => iconRow(iconFor(item.kind, item.species), icons[item.kind], `${item.name} · ${item.sizeText} · ${item.gradeName} · 现价 ${item.price}`))] : []),
      el("h3", { textContent: `鱼缸 ${w.aquarium.length}/${w.aquariumSize}` }),
      ...w.aquarium.map(fish => iconRow("aquarium-fish-" + fish.species, "🐠", `${fish.name} · ${fish.sizeText}`)),
      w.vase ? el("p", { textContent: `花瓶：${w.vase.name}（到 ${time(w.vase.until)}）` }) : null];
  }
  function renderShop() {
    const shop = extra?.shop; if (!shop) return [el("p", { textContent: "正在打开商店…" })];
    return [el("p", { className: "dsh-note", textContent: `商店等级 ${shop.tier}` + (shop.nextTierAt != null ? `，图鉴达到 ${shop.nextTierAt} 种上新` : "，全部商品已解锁") + `。她有 ${lastWorld?.shells ?? "?"} 贝壳。买卖都在镇上集市，她需要时会自己出门去，买什么由她决定。` }),
      ...shop.items.map(i => el("p", { textContent: `${i.name} · ${i.price} 贝壳` }))];
  }
  function renderCodex() {
    const codex = extra?.codex; if (!codex) return [el("p", { textContent: "正在翻开图鉴…" })];
    const kinds = { crop: "作物", flower: "花", fish: "鱼" };
    return [el("p", { textContent: `已收集 ${codex.found}/${codex.total}` }), ...Object.keys(kinds).flatMap(kind => [el("h3", { textContent: kinds[kind] }),
      ...codex.entries.filter(e => e.kind === kind).map(e => el("div", { className: "world-plot codex" + (e.found ? "" : " unknown") },
        iconRow(e.found ? iconFor(kind, e.species) : "codex-unknown", e.found ? icons[kind] : "❔", "").firstChild,
        el("span", { textContent: e.found ? `${e.name}${e.rarity ? "（" + rarityNames[e.rarity] + "）" : ""} · ${e.count} 次 · 最大 ${e.best.text}（${e.best.gradeName}）${e.giant ? " ✨" : ""}` : (e.rarity ? rarityNames[e.rarity] + "的鱼" : "还没见过") }),
        e.found ? el("span", { className: "dsh-note", textContent: "首次 " + time(e.first) }) : null))])];
  }
  function renderLog(w) {
    return [el("h3", { textContent: "里程碑" }), ...(w.milestones.length ? w.milestones.slice().reverse().map(m => el("p", { textContent: `✨ ${time(m.at)} ${m.text}` })) : [el("p", { textContent: "还没有" })]),
      el("h3", { textContent: "最近" }), ...w.log.slice().reverse().filter(e => e.text).map(e => el("p", { className: "world-log", textContent: `${time(e.at)} · ${byNames[e.by] || ""} · ${e.text}` }))];
  }
  function renderWorld(world) {
    if (!world) return;
    // An older dsh-room-world (v1 save format) is still loaded in DSH: explain instead of crashing.
    if (world.version !== 2) {
      lastWorld = null; signature = "";
      worldState.textContent = "DSH 里加载的还是旧版 dsh-room-world 插件。请重启 DSH（或在插件页重载 dsh-room-world），然后点「连接 DSH · 重试」。";
      worldBody.replaceChildren();
      return;
    }
    lastWorld = world; renderStatus();
    onWorld(world);
    // Re-render only when something other than the clock changed; keeps scroll and input focus stable.
    const sig = JSON.stringify([tab, { ...world, serverTime: 0, farm: world.farm.map(p => p && { ...p, progress: 0 }), garden: world.garden.map(p => p && { ...p, progress: 0 }) }, tab === "shop" || tab === "codex" ? extra : null]);
    if (sig === signature) {
      if (tab === "home") worldBody.querySelectorAll(".world-bar").forEach((bar, i) => { const p = [...world.farm, ...world.garden][i]; bar.style.setProperty("--p", String(p ? p.progress : 0)); });
      return;
    }
    signature = sig;
    const scroll = worldPanel.scrollTop;
    worldBody.replaceChildren(...(tab === "store" ? renderStore(world) : tab === "shop" ? renderShop() : tab === "codex" ? renderCodex() : tab === "log" ? renderLog(world) : renderHome(world)).filter(Boolean));
    worldPanel.scrollTop = scroll;
  }
  async function pollWorld(version) {
    while (version === connection) {
      try {
        const result = await request("/api/commands?since=" + worldCommandCursor);
        if (version !== connection) return;
        if (worldCommandBoot && worldCommandBoot !== result.bootId) worldCommandCursor = 0;
        else {
          worldCommandCursor = result.cursor;
          for (const event of result.events || []) if (Date.now() - event.at < 60000)
            window.dispatchEvent(new CustomEvent("dafeiyu:room-command", { detail: { id: event.commandId, action: event.action } }));
        }
        worldCommandBoot = result.bootId;
        const state = await request("/api/world");
        if (version === connection) renderWorld(state.world);
      } catch (e) { if (version === connection) flash(errorText(e), true); }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // ---------- Door menu, outdoor scenes and room props ----------
  // Viewing is the owner's choice; everything she does (going out included) stays hers. Coordinates come from
  // assets/world/layout.json: normalised to the whole 1672x941 image, which is also the stage's aspect ratio.
  const stage = document.querySelector("#stage");
  const embedded = (() => { try { return JSON.parse(document.querySelector("#character-assets").textContent); } catch { return {}; } })();
  const art = name => "/assets/world/" + name + ".png";
  const sceneOf = location => location === "farm" || location === "garden" ? "field" : location === "pond" ? "pond" : location === "away" ? "away" : "room";
  const sceneNames = { room: "小屋", field: "田园", pond: "池塘", away: "外面" };
  const placeNames = { market: "镇上集市", town: "小镇", seaside: "海边", "flower-sea": "花海", "night-market": "夜市" };
  const SW = 1672, SH = 941;
  const P = v => v * 100 + "%";
  // Defaults match the delivered art; layout.json overrides them when present.
  let layout = {
    field: { crop: [], flower: [], stall: { center: [0.502, 0.31], counterRect: [0.427, 0.335, 0.589, 0.413], keeperFoot: [0.502, 0.405] }, defaultFoot: [0.501, 0.844], standing: 0.235, plantHeight: 0.145 },
    pond: { standingFoot: [0.323, 0.638], seatedFoot: [0.322, 0.667], bobber: [0.548, 0.574], standing: 0.25 },
    room: { aquarium: { swimRectInScene: [0.799, 0.391, 0.865, 0.462] }, vase: { anchor: [0.183, 0.747], width: 0.039, flowerRoot: [0.183, 0.686] }, shellJar: { anchor: [0.56, 0.346], width: 0.035 }, codexBook: { anchor: [0.475, 0.297], width: 0.04 } },
    characters: {}, idle: [0.469, 0.946],
  };
  const fallbackCrop = [[0.103, 0.531], [0.206, 0.531], [0.31, 0.531], [0.416, 0.531], [0.077, 0.724], [0.19, 0.724], [0.305, 0.724], [0.416, 0.724]];
  const fallbackFlower = [[0.592, 0.531], [0.696, 0.531], [0.799, 0.531], [0.903, 0.531], [0.598, 0.724], [0.714, 0.724], [0.827, 0.724], [0.937, 0.724]];
  layout.field.crop = fallbackCrop.map(c => ({ center: c, careFoot: [c[0], c[1] + 0.1] }));
  layout.field.flower = fallbackFlower.map(c => ({ center: c, careFoot: [c[0], c[1] + 0.1] }));
  fetch("/assets/world/layout.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(json => {
    if (!json) return;
    const f = json.field || {}, p = json.pond || {}, r = json.room || {};
    const plots = list => list.map(x => ({ center: x.plantingPoint || x.center, careFoot: x.careFoot || [x.center[0], x.center[1] + 0.1] }));
    if (Array.isArray(f.cropPlots)) layout.field.crop = plots(f.cropPlots);
    if (Array.isArray(f.flowerBeds)) layout.field.flower = plots(f.flowerBeds);
    if (f.stall) layout.field.stall = { ...layout.field.stall, ...f.stall };
    if (f.defaultFoot) layout.field.defaultFoot = f.defaultFoot;
    if (f.suggestedStandingHeight) layout.field.standing = f.suggestedStandingHeight;
    const ph = f.cropPlots?.[0]?.suggestedPlantHeight; if (ph) layout.field.plantHeight = ph;
    for (const k of ["standingFoot", "seatedFoot", "bobber"]) if (p[k]) layout.pond[k] = p[k];
    if (p.suggestedStandingHeight) layout.pond.standing = p.suggestedStandingHeight;
    for (const k of ["aquarium", "vase", "shellJar", "codexBook"]) if (r[k]) layout.room[k] = { ...layout.room[k], ...r[k] };
    if (json.characters) layout.characters = json.characters;
    if (json.idleReference?.footAnchorNormalized) layout.idle = json.idleReference.footAnchorNormalized;
    sceneSignature = ""; propsSignature = "";
    if (lastWorld) onWorld(lastWorld);
  }).catch(() => {});

  const img = (names, className) => {
    const node = el("img", { className, alt: "" });
    const list = names.filter(Boolean);
    let i = 0;
    const src = n => n.startsWith("data:") ? n : art(n);
    node.onerror = () => { i++; if (i < list.length) node.src = src(list[i]); else node.remove(); };
    node.src = src(list[0]);
    return node;
  };
  // Place a sprite whose foot/root point (normalised inside the sprite) lands on a scene point, at a height given in scene fractions.
  function placeSprite(node, foot, anchor, height, aspect = 1240 / 1269, flip = false) {
    const h = height, w = h * SH / SW * aspect;
    const ax = flip ? 1 - anchor[0] : anchor[0];
    Object.assign(node.style, { position: "absolute", height: P(h), width: P(w), left: P(foot[0] - ax * w), top: P(foot[1] - anchor[1] * h), transform: flip ? "scaleX(-1)" : "" });
    return node;
  }

  const sceneView = el("section", { className: "scene-view", hidden: true });
  sceneView.setAttribute("aria-label", "户外场景");
  const sceneBg = el("img", { className: "scene-bg", alt: "" });
  const sceneItems = el("div", { className: "scene-items" });
  const sceneActor = el("img", { className: "scene-actor", alt: "大肥鱼" });
  const sceneFront = el("div", { className: "scene-front" });
  const sceneBubble = el("p", { className: "scene-bubble" });
  const sceneCaption = el("div", { className: "scene-caption" });
  const sceneNav = el("nav", { className: "scene-nav" });
  sceneView.append(sceneBg, sceneItems, sceneActor, sceneFront, sceneBubble, sceneCaption, sceneNav);
  stage?.append(sceneView);
  let currentScene = "room", sceneSignature = "", propsSignature = "";

  function setBackground(scene, phase) {
    sceneView.classList.remove("placeholder", "tinted");
    sceneView.dataset.phase = phase;
    const tries = ["outdoor-" + scene + "-" + phase, "outdoor-" + scene + "-day"];
    let i = 0;
    sceneBg.onerror = () => { i++; if (i < tries.length) { sceneView.classList.add("tinted"); sceneBg.src = art(tries[i]); } else { sceneBg.removeAttribute("src"); sceneView.classList.add("placeholder"); } };
    sceneBg.src = art(tries[0]);
  }
  // Soil is painted into the field background: only plants are drawn; watered beds just get darker.
  function plotNode(area, p, slot, spot, built) {
    const group = el("div", { className: "scene-plot" });
    const bed = el("span", { className: "scene-bed" + (!built ? " locked" : p && !p.thirsty ? " watered" : "") });
    Object.assign(bed.style, { left: P(spot.center[0]), top: P(spot.center[1]) });
    group.append(bed);
    if (!built) { bed.title = "还没开垦"; return group; }
    if (!p) { bed.title = (slot + 1) + "号 · 空地"; return group; }
    const flower = area === "garden";
    const names = p.stage === 0 && !p.ready ? [flower ? "flower-stage-1" : "crop-stage-1"]
      : p.stage === 1 && !p.ready ? [p.species + "-stage-2", flower ? "flower-stage-1" : "crop-stage-1"]
      : [p.species + "-stage-3", (flower ? "flower-" : "crop-") + p.species];
    const h = layout.field.plantHeight * (p.stage === 0 && !p.ready ? 0.7 : 1);
    // Roots sit on the bed centre so the plant stands in the middle of its bed.
    const plant = placeSprite(img(names, "scene-plant"), [spot.center[0], spot.center[1] + 0.03], [0.5, 0.96], h, 1);
    group.append(plant);
    const overlay = p.ready ? (p.overripe ? "overlay-overripe" : "overlay-ready") : p.thirsty ? "overlay-thirsty" : p.fertilizer ? "overlay-fertilized" : "";
    if (overlay) group.append(placeSprite(img([overlay], "scene-overlay"), [spot.center[0] + 0.03, spot.center[1] + 0.03 - h], [0.5, 1], 0.05, 1));
    bed.title = `${slot + 1}号 ${p.name} · ${p.ready ? "成熟啦" : p.thirsty ? "口渴，等她来浇" : "第" + (p.stage + 1) + "段"}`;
    return group;
  }
  function poseFor(w) {
    const recent = w.log.filter(e => e.by === "self" || e.by === "tool").at(-1);
    const fresh = recent && w.serverTime - recent.at < 90000;
    if (w.milestones.some(m => m.type === "giant" && w.serverTime - m.at < 120000)) return "cheer-giant";
    if (w.fishing) return w.fishing.state === "bite" ? "fish-reel" : w.serverTime - w.fishing.castAt < 20000 ? "fish-cast" : "fish-wait";
    if (fresh && recent.action === "collect") return /跑/.test(recent.text) ? "fish-empty" : "fish-show";
    return { plant: "plant", water: "water-can", harvest: "harvest", fertilize: "fertilize", sell: "sell", explore: "idle" }[w.activity] || "idle";
  }
  function actorSpot(w, scene, pose) {
    if (scene === "pond") return pose === "fish-wait" || pose === "fish-empty" ? layout.pond.seatedFoot : layout.pond.standingFoot;
    if (pose === "sell") return layout.field.stall.keeperFoot;
    const last = w.log.filter(e => (e.area === "farm" || e.area === "garden") && Number.isInteger(e.slot)).at(-1);
    const spot = last && w.location === last.area ? layout.field[last.area === "farm" ? "crop" : "flower"][last.slot] : null;
    // Stand a little to the left of the bed so the plant she is tending stays visible.
    return spot ? [spot.careFoot[0] - 0.045, spot.careFoot[1]] : layout.field.defaultFoot;
  }
  function navButtons() {
    const go = (scene, label) => { const b = el("button", { type: "button", textContent: label }); b.onclick = () => showScene(scene); b.disabled = scene === currentScene; return b; };
    sceneNav.replaceChildren(go("room", "🏠 回小屋"), go("field", "🌾 田园"), go("pond", "🎣 池塘"));
  }
  function renderScene(w) {
    if (!w || currentScene === "room" || w.version !== 2) return;
    const scene = currentScene, here = sceneOf(w.location) === scene;
    const pose = here ? poseFor(w) : "";
    const sig = JSON.stringify([scene, w.phase, w.location, w.activity, pose, w.fishing?.state, w.farm, w.garden, w.log.at(-1)?.at, w.outing?.until, layout.field.crop[0]?.center]);
    if (sig === sceneSignature) return;
    sceneSignature = sig;
    navButtons();
    sceneItems.replaceChildren(); sceneFront.replaceChildren();
    if (scene === "field") {
      for (const area of ["farm", "garden"]) layout.field[area === "farm" ? "crop" : "flower"].forEach((spot, slot) => { if (spot) sceneItems.append(plotNode(area, w[area][slot], slot, spot, slot < w[area].length)); });
    } else if (scene === "pond" && w.fishing) {
      sceneItems.append(placeSprite(img([w.fishing.state === "bite" ? "pond-bite" : "pond-waiting"], "scene-bobber"), layout.pond.bobber, [0.5, 0.6], 0.09, 1));
    }
    if (here) {
      const info = layout.characters[pose];
      const flip = scene === "pond" && !!info?.flipXAtPond;
      const height = (scene === "pond" ? layout.pond.standing : layout.field.standing) / 0.9;
      sceneActor.hidden = false;
      sceneActor.onerror = () => { sceneActor.onerror = null; sceneActor.src = embedded.idle || ""; placeSprite(sceneActor, actorSpot(w, scene, pose), layout.idle, height); };
      sceneActor.src = art(pose);
      placeSprite(sceneActor, actorSpot(w, scene, pose), info?.footAnchorNormalized || layout.idle, height, 1240 / 1269, flip);
      // Behind the stall: redraw the counter from the same background over her lower body.
      if (pose === "sell" && sceneBg.getAttribute("src")) {
        const [x0, y0, x1, y1] = layout.field.stall.counterRect;
        const counter = el("span", { className: "scene-counter" });
        Object.assign(counter.style, { left: P(x0), top: P(y0), width: P(x1 - x0), height: P(y1 - y0), backgroundImage: `url("${sceneBg.src}")`,
          backgroundSize: `${100 / (x1 - x0)}% ${100 / (y1 - y0)}%`, backgroundPosition: `${x0 / (1 - (x1 - x0)) * 100}% ${y0 / (1 - (y1 - y0)) * 100}%` });
        sceneFront.append(counter);
      }
      const said = w.log.filter(e => (e.by === "self" || e.by === "tool") && e.text && e.action !== "plan").at(-1);
      const foot = actorSpot(w, scene, pose);
      sceneBubble.hidden = !said; sceneBubble.textContent = said?.text || "";
      sceneBubble.style.left = P(foot[0]); sceneBubble.style.top = P(Math.max(0.04, foot[1] - height * 0.95));
      sceneCaption.replaceChildren(el("span", { textContent: "她在" + sceneNames[scene] + (w.autonomous ? "" : "，正在歇一会儿") }));
    } else {
      sceneActor.hidden = true; sceneBubble.hidden = true;
      const where = sceneOf(w.location);
      const text = where === "away" ? awayText(w) : "她现在不在这里，在" + sceneNames[where];
      const action = where === "away" ? el("button", { type: "button", textContent: "叫她回来" }) : el("button", { type: "button", textContent: "去看她" });
      action.onclick = () => where === "away" ? void recall() : showScene(where);
      sceneCaption.replaceChildren(el("span", { textContent: text }), action);
    }
  }
  function showScene(scene) {
    closeDoorMenu();
    currentScene = scene === "away" ? "room" : scene;
    sceneSignature = "";
    sceneView.hidden = currentScene === "room";
    document.body.classList.toggle("viewing-outdoor", currentScene !== "room");
    if (currentScene !== "room" && lastWorld) { setBackground(currentScene, lastWorld.phase); renderScene(lastWorld); }
  }
  async function recall() {
    closeDoorMenu();
    if (await worldAction({ action: "recall" })) showScene("room");
  }

  const doorMenu = el("div", { className: "door-menu", hidden: true });
  doorMenu.setAttribute("role", "menu");
  stage?.append(doorMenu);
  function closeDoorMenu() { doorMenu.hidden = true; }
  const awayText = w => w.outing?.purpose === "market" ? "她去镇上集市买卖东西了，大约 " + time(w.outing.until) + " 前回来"
    : "她去" + (placeNames[w.outing?.place] || "外面") + (w.outing?.place === "market" ? "逛逛" : "走走") + "了，大约 " + time(w.outing?.until) + " 回来";
  // The door only lets you look; where she goes and when she goes out is her own decision. Calling her back stays available.
  function openDoorMenu() {
    const w = lastWorld;
    const where = w ? sceneOf(w.location) : "room";
    const item = (icon, label, run) => { const b = el("button", { type: "button", role: "menuitem" }); b.append(img([icon], "door-icon"), el("span", { textContent: label })); b.onclick = run; return b; };
    const status = !w ? "还没连上 DSH" : where === "away" ? awayText(w) : "她现在在" + sceneNames[where] + (w.autonomous ? "" : "（歇息中）");
    doorMenu.replaceChildren(...[el("p", { className: "door-status", textContent: status }),
      item("nav-field", "去田园看看", () => showScene("field")),
      item("nav-pond", "去池塘看看", () => showScene("pond")),
      w?.outing ? item("nav-room", "叫她回来", () => void recall()) : null,
      el("button", { type: "button", className: "door-cancel", textContent: "算了", onclick: closeDoorMenu })].filter(Boolean));
    doorMenu.hidden = false;
  }
  document.addEventListener("click", event => {
    if (!connected || !roomAware) return;
    if (event.target.closest(".hotspot.doorway")) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (doorMenu.hidden) openDoorMenu(); else closeDoorMenu();
    } else if (event.target.closest("#return-home") && lastWorld) {
      event.preventDefault(); event.stopImmediatePropagation();
      const where = sceneOf(lastWorld.location);
      if (where === "away") void recall(); else if (where !== "room") showScene(where);
    } else if (event.target.closest(".room-codex")) {
      worldPanel.hidden = false; worldPanel.querySelector('[data-tab="codex"]')?.click();
    } else if (!doorMenu.hidden && !event.target.closest(".door-menu")) closeDoorMenu();
  }, true);

  // Results of the little world shown in the room: fish in the existing tank, flowers in the vase, the shell jar and the codex book.
  const roomProps = el("div", { className: "room-props" });
  stage?.append(roomProps);
  function renderRoomProps(w) {
    const sig = JSON.stringify([w.aquarium.map(f => f.species), w.vase?.species, w.shells > 0, layout.room.vase.anchor]);
    if (sig === propsSignature) return;
    propsSignature = sig;
    const r = layout.room, nodes = [];
    const prop = (names, anchor, width, cls) => placeSprite(img(names, "room-prop " + cls), anchor, [0.5, 1], width * SW / SH, 1);
    if (w.vase) {
      nodes.push(prop(["room-vase"], r.vase.anchor, r.vase.width, "vase"));
      nodes.push(prop(["vase-flower-" + w.vase.species], r.vase.flowerRoot, r.vase.width * 1.3, "vase-flower"));
    }
    if (w.shells > 0) nodes.push(prop(["room-shell-jar"], r.shellJar.anchor, r.shellJar.width, "shell-jar"));
    const book = prop(["room-codex-book"], r.codexBook.anchor, r.codexBook.width, "room-codex");
    book.title = "图鉴"; nodes.push(book);
    const [x0, y0, x1, y1] = r.aquarium.swimRectInScene;
    w.aquarium.slice(0, 6).forEach((fish, i) => {
      const node = img(["aquarium-fish-" + fish.species], "room-prop aquarium-fish");
      const h = (y1 - y0) * 0.45;
      Object.assign(node.style, { left: P(x0 + (x1 - x0) * ((i * 0.37) % 0.8)), top: P(y0 + (y1 - y0) * ((i * 0.29) % 0.55)), height: P(h), width: P(h * SH / SW), animationDelay: -i * 1.7 + "s" });
      nodes.push(node);
    });
    roomProps.replaceChildren(...nodes);
  }

  const awayLabel = document.querySelector("#away-label"), returnHome = document.querySelector("#return-home");
  const awayNote = document.querySelector("#away-note");
  let postcard = null, postcardPlace = "";
  function onWorld(w) {
    if (!w || w.version !== 2) return;
    document.body.dataset.worldPhase = w.phase;
    renderRoomProps(w);
    const where = sceneOf(w.location);
    if (awayLabel && where !== "room") awayLabel.textContent = where === "away" ? awayText(w).replace(/^她/, "大肥鱼") : where === "field" ? "她在田园忙" : "她在池塘钓鱼";
    if (returnHome) returnHome.textContent = where === "away" ? "叫她回来" : where === "room" ? "叫她回家" : "去看看她";
    // While she is out, show the postcard of where she went.
    const place = where === "away" ? (w.outing?.place || "town") : "";
    if (place !== postcardPlace) {
      postcard?.remove(); postcard = null; postcardPlace = place;
      if (place && awayNote) { postcard = img(["away-postcard-" + place], "away-postcard"); awayNote.prepend(postcard); }
    }
    if (currentScene !== "room") { if (sceneView.dataset.phase !== w.phase) setBackground(currentScene, w.phase); renderScene(w); }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (saved.base) base = normalizeBase(saved.base);
    if (typeof saved.token === "string" && /^[a-f0-9]{64}$/.test(saved.token)) token = saved.token;
  } catch { /* A missing preference uses the local default. */ }
  if (location.protocol === "http:" && location.hostname === "127.0.0.1") base = location.origin;
  urlInput.value = base;
  browserLink.href = base + "/chat";
  if (location.origin === base || token) void connect();
  else settings.open = true;
})();

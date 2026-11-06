const assets = JSON.parse(document.querySelector("#character-assets").textContent);
const stage = document.querySelector("#stage");
const roomImage = document.querySelector("#room-image");
const petZone = document.querySelector("#pet-zone");
const pet = document.querySelector("#pet");
const petImage = document.querySelector("#pet-image");
const speech = document.querySelector("#speech");
const reaction = document.querySelector("#reaction");
const awayNote = document.querySelector("#away-note");
const awayLabel = document.querySelector("#away-label");
const timeButton = document.querySelector("#time-mode");
const lamp = document.querySelector("#lamp");
const clock = document.querySelector("#clock");
const roomCanvas = document.querySelector("#room-canvas");
const roomContext = roomCanvas.getContext("2d");
const blendFrom = document.createElement("canvas");
blendFrom.width = roomCanvas.width;
blendFrom.height = roomCanvas.height;
const blendContext = blendFrom.getContext("2d");
const roomFrames = new Map();
let lightingRequest = 0;
let lightingFrame;
let roomPainted = false;
let lightingKey = "";
const formatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const phases = [
  { id: "morning", label: "清晨", start: 5 },
  { id: "day", label: "白昼", start: 9 },
  { id: "dusk", label: "黄昏", start: 17 },
  { id: "night", label: "夜晚", start: 20 },
];
const labels = { idle: "在家", pet: "陪你", walk: "散步中", read: "看书中", computer: "玩电脑", sleep: "睡着了", away: "出门了", tea: "喝茶中", snack: "吃点心", stretch: "伸个懒腰", window: "看看窗外", fish: "陪小鱼", choosebook: "挑书中", feed: "给小鱼喂食", water: "照顾绿植", dance: "摇摇尾巴", rice: "吃白米饭" };
const poses = { idle: "idle", pet: "idle", walk: "walk", read: "read", computer: "computer", sleep: "sleep", tea: "tea", snack: "snack", stretch: "stretch", window: "window", fish: "window", choosebook: "window", feed: "window", water: "window", dance: "stretch", rice: "rice" };
const activities = {
  rice: { path: [[72, 74], [77, 76]], pose: [77, 76], lines: ["白米饭！刚煮好的，最喜欢了。", "不用加别的，白米饭本来就很好吃。", "这碗归我。你也盛一碗，一起吃。", "每一口都香香软软的。再来一点点！"] },
  read: { path: [[44, 74]], pose: [44, 74], lines: ["这一页的小鲸鱼，终于找到自己的家了。", "给你留了书签，下次一起接着看。", "这段写得好可爱。你也来看看？"] },
  computer: { path: [[59, 75], [65, 64]], pose: [65, 52], lines: ["小鱼农场上线！今天先喂鱼。", "再过一关就休息。真的。", "今天的桌面也是蓝色小鲸鱼。"] },
  sleep: { path: [[43, 73], [38, 65]], pose: [30, 57], lines: ["抱着小鲸鱼，晚安。", "我眯一会儿。醒来还陪你。"] },
  tea: { path: [[44, 76], [32, 72], [22, 67], [13, 73]], pose: [12, 76], lines: ["刚泡好的茶。先吹一吹，再喝。", "坐一会儿吧，今天可以慢一点。", "这杯留给你，我再去泡一杯。"] },
  snack: { path: [[45, 78], [30, 82]], pose: [30, 82], lines: ["草莓尖尖这一口，分给你。", "今天的小蛋糕，奶油刚刚好。", "吃完再散步。让我再吃一小口。"] },
  stretch: { path: [[53, 76]], pose: [53, 76], lines: ["唔——坐久了，一起伸伸懒腰。", "尾巴也要活动一下。你也起来走两步？"] },
  window: { path: [[49, 74], [45, 65]], pose: [45, 63], lines: ["窗外的云，有一朵像小鲸鱼。", "这里的风刚刚好。要一起看看吗？", "不用急着做什么，看一会儿天也很好。"] },
  fish: { path: [[61, 76], [76, 64]], pose: [78, 61], lines: ["小鱼又凑过来了。是不是认得我了？", "咕噜咕噜。它们也在和你打招呼。"] },
  choosebook: { path: [[56, 59]], pose: [56, 59], lines: ["今天挑一本海底旅行记。等下坐到地毯上看。", "这本的封面也有小鲸鱼，带走啦。"] },
  feed: { path: [[78, 63]], pose: [78, 63], lines: ["一点点就够啦。看它们都游过来了。", "今天的小鱼开饭时间到了。"] },
  water: { path: [[60, 61]], pose: [60, 61], lines: ["给小叶子喝一点水，明天也要精神满满。", "这片新叶子长得真好。"] },
  dance: { path: [[52, 78]], pose: [52, 78], lines: ["左一下，右一下。尾巴也跟着节拍。", "今天的好心情，分你一半。"] },
};
const actor = { x: 50, y: 77, state: "idle", face: 1 };
let phase;
let preview = -1;
let lampOverride = null;
// She always lives by her own routine. A click or command from you is a one-off request:
// she does it, then returns to her own rhythm after a short while.
let autonomous = true;
let resumeAt = 0;
const REQUEST_PAUSE_MS = 90000;
let movementFrame;
// Walking watchdog: rAF can stall (window occluded/minimised); an interrupted walk can also leave the "walk" pose behind.
let movement = null, idleWalkTicks = 0;
let motionVersion = 0;
let returnTimer;
let speechTimer;
let asleepUntil = 0;
let routineTimer;
let routineVersion = 0;
let routineActive = false;
const sceneEffect = document.querySelector("#scene-effect");
const lineCounts = new Map();
let lastRoomEmit = 0;
let lastCommand = null;
const seenRoomCommands = new Set();
const remoteActions = new Set([...Object.keys(activities), "pet", "walk", "roam", "tour", "away", "home", "auto", "pause", "lamp-on", "lamp-off"]);

function publishRoom(force = false) {
  const now = performance.now();
  if (!force && now - lastRoomEmit < 750) return;
  lastRoomEmit = now;
  window.dispatchEvent(new CustomEvent("dafeiyu:room-state", { detail: {
    version: 1, activity: actor.state, phase: phase || "day", autonomous,
    position: { x: Number(actor.x.toFixed(2)), y: Number(actor.y.toFixed(2)) },
    lastCommand: lastCommand ? { ...lastCommand } : null,
  } }));
}

function loadRoomFrame(key) {
  if (!roomFrames.has(key)) {
    const loading = (async () => {
      const image = new Image();
      if (!assets[key]) throw new Error("Missing room frame " + key);
      image.src = assets[key];
      await image.decode();
      return image;
    })();
    roomFrames.set(key, loading);
    loading.catch(() => roomFrames.delete(key));
  }
  return roomFrames.get(key);
}

async function paintRoom(duration) {
  const on = document.body.classList.contains("lit");
  const key = phase === "day" && on ? "room" : "room-" + phase + "-" + (on ? "on" : "off");
  if (key === lightingKey) return;
  const request = ++lightingRequest;
  lightingKey = key;
  cancelAnimationFrame(lightingFrame);
  let image;
  try {
    image = await loadRoomFrame(key);
  } catch {
    if (request === lightingRequest) {
      lightingKey = "";
      say("这组灯光没有读取成功，请重新打开最新版房间，再试一次灯光开关。", 7000);
    }
    return;
  }
  if (request !== lightingRequest) return;
  if (!roomPainted || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) duration = 0;
  blendContext.clearRect(0, 0, blendFrom.width, blendFrom.height);
  blendContext.drawImage(roomCanvas, 0, 0);
  const started = performance.now();
  function draw(now) {
    if (request !== lightingRequest) return;
    const progress = duration ? Math.min((now - started) / duration, 1) : 1;
    const alpha = progress * progress * (3 - 2 * progress);
    roomContext.globalAlpha = 1;
    roomContext.clearRect(0, 0, roomCanvas.width, roomCanvas.height);
    if (roomPainted) roomContext.drawImage(blendFrom, 0, 0);
    roomContext.globalAlpha = alpha;
    roomContext.drawImage(image, 0, 0, roomCanvas.width, roomCanvas.height);
    roomContext.globalAlpha = 1;
    if (progress < 1) lightingFrame = requestAnimationFrame(draw);
    else roomPainted = true;
  }
  draw(started);
  roomCanvas.hidden = false;
  roomImage.hidden = true;
}

function say(text, duration = 4500) {
  clearTimeout(speechTimer);
  if (actor.state === "away") {
    awayLabel.textContent = text;
    return;
  }
  speech.textContent = text;
  speechTimer = setTimeout(() => { speech.textContent = ""; }, duration);
}
function placeActor() {
  petZone.style.left = actor.x + "%";
  petZone.style.bottom = (100 - actor.y) + "%";
  petZone.style.zIndex = actor.y < 75 ? "2" : "4";
  const scale = actor.state === "sleep" ? 1 : Math.max(.84, Math.min(1.05, .84 + (actor.y - 56) / 150));
  petZone.style.setProperty("--depth-scale", scale);
  publishRoom();
}
function setState(state) {
  clearTimeout(returnTimer);
  actor.state = state;
  if (lastCommand?.status === "accepted" && (
    lastCommand.action === state ||
    (lastCommand.action === "choosebook" && state === "read") ||
    (lastCommand.action === "home" && state === "idle" && actor.x === 50 && actor.y === 77) ||
    (["tour", "roam"].includes(lastCommand.action) && state === "idle" && !routineActive))) lastCommand.status = "arrived";
  const away = state === "away";
  petZone.hidden = away;
  awayNote.hidden = !away;
  if (away) awayLabel.textContent = "大肥鱼出门啦";
  petZone.dataset.state = state;
  document.body.classList.toggle("computer-on", state === "computer");
  const source = assets[poses[state] || "idle"];
  if (petImage.getAttribute("src") !== source) petImage.src = source;
  petImage.style.transform = (state === "walk" && actor.face < 0) || ["fish", "feed"].includes(state) ? "scaleX(-1)" : "";
  reaction.textContent = state === "sleep" ? "z Z" : state === "pet" ? "♡" : "";
  sceneEffect.dataset.effect = ["feed", "water"].includes(state) ? state : "";
  pet.setAttribute("aria-label", state === "sleep" ? "叫醒大肥鱼" : "摸摸大肥鱼");
  placeActor();
  updateStatus();
  publishRoom(true);
}
function cancelMovement() {
  movement = null;
  motionVersion++;
  cancelAnimationFrame(movementFrame);
  clearTimeout(returnTimer);
}
function cancelRoutine() {
  routineVersion++;
  routineActive = false;
  clearTimeout(routineTimer);
  cancelMovement();
}

const floorBoundary = [[11, 78], [14, 68], [28, 66], [40, 65], [45, 56], [58, 56], [62, 61], [78, 61], [88, 61], [93, 65], [85, 74], [70, 85], [32, 85], [17, 80]];
function isWalkable(x, y) {
  let inside = false;
  for (let i = 0, j = floorBoundary.length - 1; i < floorBoundary.length; j = i++) {
    const [xi, yi] = floorBoundary[i];
    const [xj, yj] = floorBoundary[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  const table = x > 17 && x < 27 && y > 74 && y < 86;
  const chair = x < 14 && y < 75;
  const cooker = x > 82 && x < 90 && y > 69 && y < 77;
  return inside && !table && !chair && !cooker;
}

const floorGrid = new Map();
for (let x = 12; x <= 92; x += 2) {
  for (let y = 56; y <= 84; y += 2) {
    if (isWalkable(x, y)) floorGrid.set(x + "," + y, { x, y });
  }
}
function floorRoute(start, target) {
  const cells = [...floorGrid.values()];
  const nearest = pos => cells.reduce((best, cell) =>
    Math.hypot((cell.x - pos.x) * 1.7778, cell.y - pos.y) < Math.hypot((best.x - pos.x) * 1.7778, best.y - pos.y) ? cell : best);
  const first = nearest(start);
  const last = nearest(target);
  const keyOf = cell => cell.x + "," + cell.y;
  const parents = new Map([[keyOf(first), null]]);
  const queue = [first];
  for (let i = 0; i < queue.length && !parents.has(keyOf(last)); i++) {
    const cell = queue[i];
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const next = floorGrid.get((cell.x + dx) + "," + (cell.y + dy));
      if (!next || parents.has(keyOf(next))) continue;
      if (dx && dy && (!floorGrid.has((cell.x + dx) + "," + cell.y) || !floorGrid.has(cell.x + "," + (cell.y + dy)))) continue;
      parents.set(keyOf(next), keyOf(cell));
      queue.push(next);
    }
  }
  if (!parents.has(keyOf(last))) return null;
  const route = [];
  for (let key = keyOf(last); key; key = parents.get(key)) route.unshift(floorGrid.get(key));
  const clearLine = (a, b) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 3);
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      if (!isWalkable(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  };
  const smooth = [route[0]];
  let index = 0;
  while (index < route.length - 1) {
    let farthest = route.length - 1;
    while (farthest > index + 1 && !clearLine(route[index], route[farthest])) farthest--;
    smooth.push(route[farthest]);
    index = farthest;
  }
  if (isWalkable(target.x, target.y) && clearLine(last, target)) smooth.push(target);
  return smooth;
}

function walkPath(path, arrived) {
  cancelMovement();
  const version = motionVersion;
  let from = actor;
  const points = [];
  for (const [x, y] of path) {
    const segment = floorRoute(from, { x, y });
    if (!segment) { routineActive = false; say("这里暂时走不过去，换个地方叫我吧。"); setState("idle"); return; }
    points.push(...segment);
    from = segment[segment.length - 1];
  }
  if (!points.length) { arrived(); return; }
  setState("walk");
  let previousTime = performance.now();
  movement = { points, arrived, lastFrameAt: performance.now(), frame: null };
  function frame(now) {
    if (version !== motionVersion) return;
    if (movement) movement.lastFrameAt = performance.now();
    const step = Math.min((now - previousTime) / 1000, .08) * 12;
    previousTime = now;
    const next = points[0];
    const dx = next.x - actor.x;
    const dy = next.y - actor.y;
    const distance = Math.hypot(dx, dy);
    if (Math.abs(dx) > .02) actor.face = dx > 0 ? -1 : 1;
    petImage.style.transform = actor.face < 0 ? "scaleX(-1)" : "";
    if (distance <= step) {
      actor.x = next.x;
      actor.y = next.y;
      points.shift();
      if (!points.length) { movement = null; arrived(); return; }
    } else {
      actor.x += dx / distance * step;
      actor.y += dy / distance * step;
    }
    placeActor();
    movementFrame = requestAnimationFrame(frame);
  }
  movement.frame = frame;
  movementFrame = requestAnimationFrame(frame);
}
setInterval(() => {
  if (movement) {
    idleWalkTicks = 0;
    const stalled = performance.now() - movement.lastFrameAt;
    if (stalled > 4000) {
      // Frames are not coming back: finish the walk at its destination instead of freezing mid-step.
      const { points, arrived } = movement;
      const last = points[points.length - 1];
      cancelMovement();
      if (last) { actor.x = last.x; actor.y = last.y; placeActor(); }
      arrived();
    } else if (stalled > 1200) {
      cancelAnimationFrame(movementFrame);
      movementFrame = requestAnimationFrame(movement.frame);
    }
  } else if (actor.state === "walk") {
    // "walk" with no walk running: an interrupted walk left the pose behind.
    if (++idleWalkTicks >= 2) { idleWalkTicks = 0; setState("idle"); }
  } else idleWalkTicks = 0;
}, 1000);

function routine(steps) {
  cancelRoutine();
  routineActive = true;
  const version = routineVersion;
  function next(index) {
    if (version !== routineVersion) return;
    if (index >= steps.length) { routineActive = false; setState("idle"); return; }
    const step = steps[index];
    walkPath([step.at], () => {
      if (version !== routineVersion) return;
      setState(step.state || "idle");
      if (step.line) say(step.line);
      routineTimer = setTimeout(() => next(index + 1), step.wait || 1800);
    });
  }
  next(0);
}
function nextLine(action, lines) {
  const count = lineCounts.get(action) || 0;
  lineCounts.set(action, count + 1);
  return lines[count % lines.length];
}
function setAutomatic(on) {
  autonomous = on;
  resumeAt = on ? 0 : Date.now() + REQUEST_PAUSE_MS;
  publishRoom(true);
}
function perform(action, manual = true) {
  if (manual && lastCommand?.status === "accepted") lastCommand.status = "cancelled";
  if (manual) setAutomatic(false);
  if (actor.state === "away") {
    say("我还在外面呢，点「叫她回家」就回来。");
    return;
  }
  cancelRoutine();
  if (action === "tour") {
    routine([
      { at: [45, 63], state: "window", wait: 5000, line: phase === "night" ? "窗外已经有星星了。" : "先看看窗外。今天的天色真好。" },
      { at: [56, 59], state: "choosebook", wait: 3500, line: "书都摆得好好的。" },
      { at: [60, 61], state: "water", wait: 4000, line: "给新叶子一点水。" },
      { at: [78, 63], state: "feed", wait: 5000, line: "小鱼们也都在，开饭啦。" },
      { at: [53, 78], state: "stretch", wait: 3500, line: "巡视完毕。这里真让人安心。" },
    ]);
    return;
  }
  if (action === "roam") {
    const cells = [...floorGrid.values()];
    const steps = Array.from({ length: 5 }, () => {
      const cell = cells[Math.floor(Math.random() * cells.length)];
      return { at: [cell.x, cell.y], wait: 1500 + Math.random() * 2500 };
    });
    say("我在屋里转一会儿。你忙你的就好。");
    routine(steps);
    return;
  }
  if (action === "choosebook") {
    routine([
      { at: [56, 59], state: "choosebook", wait: 3500, line: nextLine("choosebook", activities.choosebook.lines) },
      { at: [44, 74], state: "read", wait: 18000, line: "坐好了，一起翻开第一页。" },
    ]);
    return;
  }
  if (action === "pet") {
    cancelMovement();
    const waking = actor.state === "sleep";
    if (waking) { actor.x = 39; actor.y = 66; }
    setState("pet");
    say(nextLine("pet", waking ? ["嗯……醒啦。刚才梦见一条好大的鱼。"] : ["唔……再摸一下也可以。", "尾巴也想被摸摸。", "今天也有好好陪着你。"]));
    returnTimer = setTimeout(() => setState("idle"), 5000);
    return;
  }
  if (action === "away") {
    say("出门转一圈。等我回来呀。");
    walkPath([[59, 76], [76, 70], [92, 65]], () => {
      setState("away");
      speech.textContent = "";
    });
    return;
  }
  if (action === "walk") {
    const cells = [...floorGrid.values()];
    const target = cells[Math.floor(Math.random() * cells.length)];
    walkPath([[target.x, target.y]], () => { setState("idle"); });
    return;
  }
  const activity = activities[action];
  if (!activity) { if (actor.state === "walk") setState("idle"); return; }
  walkPath(activity.path, () => {
    actor.x = activity.pose[0];
    actor.y = activity.pose[1];
    setState(action);
    if (action === "sleep") asleepUntil = Date.now() + 120000;
    say(action === "window" && phase === "night" ? "月亮在窗边。我们一起安静地看一会儿。" : nextLine(action, activity.lines));
    if (action === "stretch") returnTimer = setTimeout(() => setState("idle"), 7000);
    if (action === "snack") returnTimer = setTimeout(() => setState("idle"), 16000);
    if (action === "rice") returnTimer = setTimeout(() => setState("idle"), 24000);
    if (["feed", "water", "dance"].includes(action)) returnTimer = setTimeout(() => setState("idle"), 10000);
  });
}
function updateLamp(duration = 1800) {
  const on = lampOverride ?? (phase === "dusk" || phase === "night");
  document.body.classList.toggle("lit", on);
  lamp.setAttribute("aria-pressed", String(on));
  lamp.setAttribute("aria-label", on ? "关闭房间灯光" : "打开房间灯光");
  void paintRoom(duration);
}
function updateStatus() {
  const label = phases.find(item => item.id === phase)?.label || "";
  document.querySelector("#phase-label").textContent = label + (preview >= 0 ? "预览" : " · " + labels[actor.state]);
}
function updateTime() {
  const now = new Date();
  clock.textContent = formatter.format(now);
  clock.dateTime = now.toISOString();
  const actual = [...phases].reverse().find(item => now.getHours() >= item.start) || phases[3];
  const selected = phases[preview] || actual;
  if (phase !== selected.id) {
    phase = selected.id;
    document.body.dataset.phase = phase;
    updateLamp(preview >= 0 ? 4200 : 8000);
    publishRoom(true);
  }
  timeButton.textContent = preview < 0 ? "◷ 跟随时间" : "◷ " + selected.label;
  updateStatus();
}

roomImage.addEventListener("error", () => say("房间底图没有读取成功，请重新打开完整的最新版页面。", 8000));
petImage.addEventListener("error", () => say("角色图未能读取，请重新打开完整的最新版房间。", 6000));
roomImage.src = assets.room;
document.querySelector("#cooker-image").src = assets["rice-cooker"];
pet.addEventListener("click", () => perform("pet"));
document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => perform(button.dataset.action)));
lamp.addEventListener("click", () => {
  lampOverride = !document.body.classList.contains("lit");
  updateLamp();
  if (actor.state !== "away") say(lampOverride ? "灯亮啦，暖暖的。" : "灯关好啦。休息一下眼睛吧。");
});
timeButton.addEventListener("click", () => {
  preview = preview === 3 ? -1 : preview + 1;
  lampOverride = null;
  updateTime();
  updateLamp();
});
document.querySelector("#return-home").addEventListener("click", () => {
  setAutomatic(false);
  cancelRoutine();
  actor.x = 92; actor.y = 65;
  setState("idle");
  walkPath([[76, 70], [58, 76], [50, 77]], () => {
    setState("idle");
    say("回来啦。有没有想我？");
  });
});
stage.addEventListener("click", event => {
  if (event.target !== roomImage && event.target !== stage) return;
  if (actor.state === "away") return;
  const rect = stage.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * 100;
  const y = (event.clientY - rect.top) / rect.height * 100;
  if (!isWalkable(x, y)) return;
  setAutomatic(false);
  cancelRoutine();
  const marker = document.querySelector("#destination");
  marker.style.left = x + "%";
  marker.style.top = y + "%";
  marker.classList.remove("active");
  void marker.offsetWidth;
  marker.classList.add("active");
  walkPath([[x, y]], () => setState("idle"));
});

setState("idle");
updateTime();
setAutomatic(true);
say("欢迎回家。茶和点心都准备好了。");
setInterval(updateTime, 1000);
document.addEventListener("visibilitychange", updateTime);
window.addEventListener("dafeiyu:dsh-reply", event => {
  const text = String(event.detail?.text || "").trim().slice(0, 2000);
  if (!text) return;
  if (actor.state === "away") { say(text); return; }
  const duration = Math.min(15000, Math.max(6500, text.length * 90));
  say(text, duration);
});
window.addEventListener("dafeiyu:request-room-state", () => publishRoom(true));
window.addEventListener("dafeiyu:room-command", event => {
  const command = event.detail;
  if (!command || !/^[a-zA-Z0-9-]{1,90}$/.test(command.id) || !remoteActions.has(command.action) || seenRoomCommands.has(command.id)) return;
  seenRoomCommands.add(command.id);
  while (seenRoomCommands.size > 200) seenRoomCommands.delete(seenRoomCommands.values().next().value);
  lastCommand = { id: command.id, action: command.action, status: "accepted" };
  if (actor.state === "away" && !["home", "auto", "lamp-on", "lamp-off"].includes(command.action)) {
    lastCommand.status = "rejected";
    publishRoom(true);
    return;
  }
  if (command.action === "home") {
    if (actor.state === "away") document.querySelector("#return-home").click();
    else { setAutomatic(false); cancelRoutine(); walkPath([[50, 77]], () => setState("idle")); }
  }
  else if (command.action === "auto") { setAutomatic(true); lastCommand.status = "arrived"; }
  else if (command.action === "pause") {
    setAutomatic(false); cancelRoutine();
    if (actor.state === "sleep") { actor.x = 39; actor.y = 66; }
    setState("idle"); lastCommand.status = "arrived";
  }
  else if (command.action.startsWith("lamp-")) {
    lampOverride = command.action === "lamp-on"; updateLamp(); lastCommand.status = "arrived";
  } else { setAutomatic(false); perform(command.action, false); }
  publishRoom(true);
});
setInterval(() => {
  if (!autonomous && Date.now() >= resumeAt) { autonomous = true; publishRoom(true); }
  if (!autonomous || document.hidden || routineActive || actor.state === "walk" || actor.state === "away") return;
  if (actor.state === "sleep" && (phase === "night" || Date.now() < asleepUntil)) return;
  const options = phase === "night" ? ["tea", "read", "window", "sleep", "roam"] :
    phase === "morning" ? ["stretch", "rice", "tea", "window", "water", "choosebook", "roam"] :
    ["walk", "roam", "tour", "choosebook", "computer", "rice", "rice", "tea", "snack", "stretch", "window", "feed", "water", "dance"];
  perform(options[Math.floor(Math.random() * options.length)], false);
}, 35000);

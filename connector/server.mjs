import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const prefix = "/dsh-room-world/api";
const loopbacks = new Set(["127.0.0.1", "localhost", "[::1]"]);

function problem(code, error, hint, status = 400) {
  return Object.assign(new Error(error), { code, hint, status });
}

function sameSecret(actual, expected) {
  const a = Buffer.from(String(actual || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function localUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw problem("LOCAL_URL_INVALID", "本地连接地址无效", "使用连接器显示的 http://127.0.0.1 地址。"); }
  if (url.protocol !== "http:" || !loopbacks.has(url.hostname) || url.username || url.password ||
      url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw problem("LOCAL_URL_INVALID", "连接地址必须是本机 HTTP 地址", "检查本地连接器和 DSH 的地址配置。");
  }
  return url.origin;
}

async function readJsonBody(req) {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw problem("JSON_REQUIRED", "请求格式不正确", "刷新房间后重试。", 415);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32768) throw problem("BODY_TOO_LARGE", "消息内容过长", "缩短消息后再发。", 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON object");
    return value;
  }
  catch { throw problem("JSON_INVALID", "请求内容无法读取", "刷新房间后重试。"); }
}

function publicMessage(message) {
  return { id: String(message.id || ""), role: message.role === "user" ? "user" : "assistant",
    text: String(message.text || ""), at: Number(message.at) || 0,
    channel: message.channel === "qq" ? "qq" : "pet" };
}

export async function startConnector({
  port = 37621,
  root = defaultRoot,
  hostFile = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "room-world", "host.json"),
  fetchImpl = fetch,
} = {}) {
  const session = randomBytes(32).toString("hex");
  const pairCode = String(randomInt(10000000, 100000000));
  const attempts = [];
  const requests = new Map();
  let chatBusy = false;
  let origin;
  let lastDshToken = "";
  const roomBoot = randomBytes(8).toString("hex");
  const roomEvents = [];
  let roomSequence = 0;

  function redact(value) {
    let text = String(value || "").slice(0, 1200);
    for (const secret of [lastDshToken, session, pairCode]) {
      if (secret) text = text.split(secret).join("[已隐藏]");
    }
    return text.replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, "$1[已隐藏]").slice(0, 260);
  }

  async function discoverHost() {
    let value;
    try { value = JSON.parse(await readFile(hostFile, "utf8")); }
    catch { throw problem("DSH_HOST_MISSING", "还没读到独立房间插件的连接配置", "在 DSH 中安装并启用 dsh-room-world 插件，然后点重试。", 503); }
    if (typeof value.token !== "string" || value.token.length < 8 || value.api !== prefix) {
      throw problem("DSH_HOST_INVALID", "独立房间插件的连接配置不完整", "在 DSH 中重载 dsh-room-world，然后点重试。", 503);
    }
    lastDshToken = value.token;
    return { baseUrl: localUrl(value.baseUrl), token: value.token };
  }

  async function upstream(route, { method = "GET", body, timeout = 12000 } = {}) {
    const host = await discoverHost();
    let response;
    try {
      response = await fetchImpl(host.baseUrl + prefix + route, {
        method, redirect: "error", headers: { "x-pet-token": host.token,
          ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw problem("DSH_UNREACHABLE", "本地连接器暂时连不上 DSH", "确认 DSH 正在运行并启用了 dsh-room-world，然后点重试。", 503);
    }
    let value;
    try { value = await response.json(); }
    catch { throw problem("DSH_RESPONSE_INVALID", "DSH 返回了无法读取的内容", "在 DSH 中检查房间插件状态，再点重试。", 502); }
    if (!response.ok || value?.ok !== true) {
      if (route.startsWith("/room/") && response.status === 404) {
        throw problem("ROOM_LINK_NOT_READY", "房间互通接口尚未加载", "在 DSH 中重载 dsh-room-world 插件，再重新连接房间。", 503);
      }
      const hint = response.status === 401 ? "在 DSH 中重载 dsh-room-world，再点重试。" :
        "检查 DSH 的房间插件对话开关、默认模型和额度，再点重试。";
      throw problem(response.status === 401 ? "DSH_AUTH_FAILED" : "DSH_REJECTED",
        redact(value?.error || "DSH 暂时无法完成请求"), hint, 502);
    }
    return value;
  }

  function respond(res, statusCode, value) {
    res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(value));
  }

  async function chat(body) {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const id = typeof body.requestId === "string" ? body.requestId : "";
    if (!text || text.length > 4000 || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
      throw problem("MESSAGE_INVALID", "消息为空、过长或发送标识无效", "输入 1 到 4000 字的消息后重试。");
    }
    const existing = requests.get(id);
    if (existing) {
      if (existing.text !== text) throw problem("REQUEST_CONFLICT", "这次重试的消息内容已经改变", "重新发送修改后的消息。", 409);
      return existing.promise;
    }
    if (chatBusy) throw problem("CHAT_BUSY", "她正在回复上一条消息", "等上一条回复完成后再发。", 409);
    for (const [key, item] of requests) if (item.done && Date.now() - item.at > 600000) requests.delete(key);
    if (requests.size >= 128) {
      for (const [key, item] of requests) {
        if (item.done) { requests.delete(key); break; }
      }
    }
    chatBusy = true;
    const entry = { text, at: Date.now(), done: false };
    entry.promise = (async () => {
      try {
        if (body.room) await upstream("/room/state", { method: "POST", body: body.room });
        const result = await upstream("/chat", { method: "POST", body: { text, requestId: id }, timeout: 185000 });
        if (!result.reply?.text) throw problem("REPLY_EMPTY", "她这次没有返回文字", "检查 DSH 模型状态后重新发送。", 502);
        const reply = publicMessage(result.reply);
        const userMessage = publicMessage(result.userMessage || { text, role: "user" });
        roomEvents.push({ id: ++roomSequence, reply, userMessage });
        if (roomEvents.length > 128) roomEvents.shift();
        return { ok: true, reply, userMessage, latencyMs: Number(result.latencyMs) || 0 };
      } finally { entry.done = true; chatBusy = false; }
    })();
    requests.set(id, entry);
    return entry.promise;
  }

  const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/chat", ["chat.html", "text/html; charset=utf-8"]],
    ["/room.css", ["room.css", "text/css; charset=utf-8"]],
    ["/room.js", ["room.js", "text/javascript; charset=utf-8"]],
    ["/dsh-client.js", ["dsh-client.js", "text/javascript; charset=utf-8"]],
    ["/dsh.css", ["dsh.css", "text/css; charset=utf-8"]],
  ]);

  const server = http.createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    try {
      if (req.headers.host !== new URL(origin).host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
        throw problem("LOCAL_ONLY", "只接受本机连接", "使用连接器显示的 127.0.0.1 地址。", 403);
      }
      const url = new URL(req.url, origin);
      const api = url.pathname.startsWith("/api/");
      const source = req.headers.origin;
      if (source && source !== origin && !(source === "null" && api && url.pathname !== "/api/bootstrap")) {
        throw problem("ORIGIN_REJECTED", "此页面来源不能访问本地连接器", "从本地壁纸文件或连接器提供的页面连接。", 403);
      }
      if (api && source === "null" && url.pathname !== "/api/bootstrap") {
        res.setHeader("access-control-allow-origin", "null");
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
        res.setHeader("access-control-allow-headers", "content-type, x-wallpaper-token");
        res.setHeader("access-control-max-age", "600");
      }
      if (req.method === "OPTIONS" && api) { res.writeHead(204); res.end(); return; }
      if (req.method === "GET" && url.pathname === "/api/bootstrap") {
        if (source === "null" || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) {
          throw problem("PAIR_REQUIRED", "请先配对本地壁纸", "在连接器页面查看配对码，再填到壁纸的连接面板。", 403);
        }
        respond(res, 200, { ok: true, session, pairCode, origin });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/pair") {
        const now = Date.now();
        while (attempts.length && now - attempts[0] > 60000) attempts.shift();
        if (attempts.length >= 5) throw problem("PAIR_RATE_LIMIT", "配对尝试过于频繁", "等一分钟后输入连接器显示的配对码。", 429);
        attempts.push(now);
        const body = await readJsonBody(req);
        if (!sameSecret(String(body.code || "").replace(/\s/g, ""), pairCode)) {
          throw problem("PAIR_CODE_INVALID", "配对码不正确", "打开本地连接器页面，复制当前八位配对码。", 401);
        }
        respond(res, 200, { ok: true, session });
        return;
      }
      if (api) {
        if (!sameSecret(req.headers["x-wallpaper-token"], session)) {
          throw problem("PAIR_REQUIRED", "本地连接已失效或还未配对", "点连接面板，使用当前配对码重新连接。", 401);
        }
        if (req.method === "GET" && url.pathname === "/api/status") {
          const result = await upstream("/status");
          respond(res, 200, { ok: true, role: { name: String(result.role?.name || "") },
            chat: { enabled: !!result.chat?.enabled, remember: !!result.chat?.remember, busy: chatBusy || !!result.chat?.busy },
            llm: { ready: !!result.llm?.ready }, focus: !!result.focus?.enabled,
            mode: "room-world", pluginOnline: true, roomAware: result.roomLink?.version === 1,
            syncError: String(result.syncError || "") });
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/history") {
          const result = await upstream("/history?limit=60");
          respond(res, 200, { ok: true, messages: (result.messages || []).map(publicMessage) });
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/events") {
          const since = url.searchParams.get("since");
          if (since !== null && !/^\d{1,15}$/.test(since)) throw problem("CURSOR_INVALID", "事件游标无效", "断开后重新连接。");
          const query = new URLSearchParams({ wait: "20000", client: "wallpaper" });
          if (since !== null) query.set("since", since);
          const result = await upstream("/events?" + query, { timeout: 28000 });
          respond(res, 200, { ok: true, cursor: Number(result.cursor) || 0, bootId: String(result.bootId || ""),
            focus: !!result.config?.focus?.enabled, events: (result.events || []).map(event => ({
              id: Number(event.id) || 0, type: String(event.type || ""), text: String(event.text || ""),
              messageId: String(event.messageId || ""), at: Number(event.at) || 0,
            })) });
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/room-events") {
          const raw = url.searchParams.get("since");
          if (raw !== null && !/^\d{1,15}$/.test(raw)) throw problem("CURSOR_INVALID", "事件游标无效", "断开后重新连接。");
          const since = raw === null ? null : Number(raw);
          respond(res, 200, { ok: true, bootId: roomBoot, cursor: roomSequence,
            events: since === null || since > roomSequence ? [] : roomEvents.filter(event => event.id > since) });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/room-state") {
          const result = await upstream("/room/state", { method: "POST", body: await readJsonBody(req) });
          respond(res, 200, result);
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/qq-events") {
          const raw = url.searchParams.get("since");
          if (raw !== null && !/^\d{1,15}$/.test(raw)) throw problem("CURSOR_INVALID", "QQ 同步游标无效", "重新连接房间。");
          const result = await upstream("/room/events" + (raw === null ? "" : "?since=" + raw));
          respond(res, 200, { ok: true, cursor: result.cursor, roleId: result.roleId,
            events: (result.events || []).map(event => ({
              id: event.id, message: publicMessage({ ...event, id: "qq-" + event.sourceId, channel: "qq" }),
              command: event.role === "user" && event.action ? { id: event.commandId, action: event.action } : null,
            })) });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/chat") {
          respond(res, 200, await chat(await readJsonBody(req)));
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/commands") {
          const since = url.searchParams.get("since");
          if (since !== null && !/^\d{1,15}$/.test(since)) throw problem("CURSOR_INVALID", "指令游标无效", "重新连接。");
          respond(res, 200, await upstream("/commands" + (since === null ? "" : "?since=" + since)));
          return;
        }
        if (["GET", "POST"].includes(req.method) && url.pathname === "/api/world") {
          respond(res, 200, await upstream("/world", { method: req.method,
            ...(req.method === "POST" ? { body: await readJsonBody(req) } : {}) }));
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/shutdown") {
          if (chatBusy) throw problem("CHAT_BUSY", "还有一条消息正在等待回复", "等回复完成后再停止连接器。", 409);
          respond(res, 200, { ok: true });
          setTimeout(() => { server.close(); server.closeAllConnections(); }, 100);
          return;
        }
        throw problem("ROUTE_NOT_FOUND", "没有这个连接接口", "刷新最新版房间后重试。", 404);
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw problem("METHOD_NOT_ALLOWED", "请求方式不支持", "刷新页面后重试。", 405);
      // Outdoor art is served read-only by plain file name; no paths, no other folders.
      const art = /^\/assets\/world\/([a-z0-9-]{1,80})\.(png|json)$/.exec(url.pathname);
      const file = art ? ['assets/world/' + art[1] + '.' + art[2], art[2] === 'png' ? 'image/png' : 'application/json; charset=utf-8'] : staticFiles.get(url.pathname);
      if (!file) throw problem("FILE_NOT_FOUND", "没有这个页面", "打开连接器显示的房间地址。", 404);
      const absolute = path.join(root, file[0]);
      let info;
      try { info = await stat(absolute); }
      catch { throw problem("FILE_NOT_FOUND", "本地页面文件缺失", "把连接器放回完整的壁纸目录，再启动。", 404); }
      res.writeHead(200, { "content-type": file[1], "content-length": info.size, "cache-control": "no-store" });
      if (req.method === "HEAD") res.end();
      else {
        const stream = createReadStream(absolute);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      }
    } catch (error) {
      respond(res, error.status || 500, { ok: false, code: error.code || "CONNECTOR_ERROR",
        error: redact(error.message || "本地连接器发生错误"), hint: error.hint || "关闭连接器后重新启动，再点重试。" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      origin = "http://127.0.0.1:" + server.address().port;
      resolve();
    });
  });
  server.requestTimeout = 210000;
  return { server, origin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.WALLPAPER_BRIDGE_PORT || 37621);
  if (process.argv.includes("--stop")) {
    const base = "http://127.0.0.1:" + port;
    (async () => {
      const bootstrap = await (await fetch(base + "/api/bootstrap", { signal: AbortSignal.timeout(3000) })).json();
      const result = await (await fetch(base + "/api/shutdown", { method: "POST",
        headers: { "x-wallpaper-token": bootstrap.session }, signal: AbortSignal.timeout(3000) })).json();
      if (!result.ok) throw new Error(result.error);
      console.log("本地连接器已停止。");
    })().catch(() => { console.error("连接器未运行，或仍在等待聊天回复。"); process.exitCode = 1; });
  } else startConnector({ port }).then(({ origin, server }) => {
    console.log("大肥鱼本地连接器已启动");
    console.log("房间与配对码  " + origin + "/");
    console.log("浏览器聊天页  " + origin + "/chat");
    console.log("保持此窗口运行，按 Ctrl+C 停止。");
    process.on("SIGINT", () => { server.close(); server.closeAllConnections(); });
  }).catch(error => {
    console.error(error.code === "EADDRINUSE" ? "37621 端口已被使用。若连接器已启动，打开 http://127.0.0.1:37621/ 即可。" :
      "连接器启动失败。检查 Node.js 是否为 22 或更新版本，以及文件夹是否完整。");
    process.exitCode = 1;
  });
}

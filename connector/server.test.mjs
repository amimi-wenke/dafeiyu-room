import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startConnector } from "./server.mjs";

const upstreamToken = "fixture-surfcore-token-not-a-real-secret";

async function fixture(t, handler) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dafeiyu-connector-test-"));
  const hostFile = path.join(dir, "host.json");
  await writeFile(hostFile, JSON.stringify({ token: upstreamToken, baseUrl: "http://127.0.0.1:45678", api: "/dsh-room-world/api" }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.origin, undefined);
    return handler ? handler(url, options) : Response.json({ ok: true, role: { name: "测试小鱼" },
      chat: { enabled: true, remember: true }, llm: { ready: true } });
  };
  const app = await startConnector({ port: 0, hostFile, fetchImpl });
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    await unlink(hostFile);
    await rmdir(dir);
  });
  const bootstrap = await (await fetch(app.origin + "/api/bootstrap")).json();
  const headers = { "x-wallpaper-token": bootstrap.session };
  const post = (route, body, extra = {}) => fetch(app.origin + route, {
    method: "POST", headers: { ...headers, "content-type": "application/json", ...extra },
    body: JSON.stringify(body),
  });
  return { ...app, bootstrap, headers, post, calls, hostFile };
}

async function failure(response, code) {
  assert.ok(response.status >= 400);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.ok(result.error);
  assert.ok(result.hint);
  return result;
}

test("requires pairing, blocks outside origins, and never returns the SurfCore token", async t => {
  const app = await fixture(t);
  await failure(await fetch(app.origin + "/api/status"), "PAIR_REQUIRED");
  await failure(await fetch(app.origin + "/api/bootstrap", { headers: { origin: "null" } }), "ORIGIN_REJECTED");
  await failure(await fetch(app.origin + "/api/status", { headers: { ...app.headers, origin: "https://example.org" } }), "ORIGIN_REJECTED");
  const response = await fetch(app.origin + "/api/status", { headers: { ...app.headers, origin: "null" } });
  assert.equal(response.headers.get("access-control-allow-origin"), "null");
  const text = await response.text();
  assert.ok(text.includes("测试小鱼"));
  assert.ok(!text.includes(upstreamToken));
  assert.equal(app.calls[0].options.headers["x-pet-token"], upstreamToken);
  const preflight = await fetch(app.origin + "/api/chat", { method: "OPTIONS", headers: { origin: "null" } });
  assert.equal(preflight.status, 204);
  const denied = await fetch(app.origin + "/connector/server.mjs");
  await failure(denied, "FILE_NOT_FOUND");
});

test("pairs a local wallpaper using the current eight-digit code and limits guesses", async t => {
  const app = await fixture(t);
  await failure(await app.post("/api/pair", { code: "wrong" }, { origin: "null" }), "PAIR_CODE_INVALID");
  const response = await app.post("/api/pair", { code: app.bootstrap.pairCode }, { origin: "null" });
  assert.equal((await response.json()).session, app.bootstrap.session);
  for (let i = 0; i < 3; i++) await failure(await app.post("/api/pair", { code: "wrong" }), "PAIR_CODE_INVALID");
  await failure(await app.post("/api/pair", { code: app.bootstrap.pairCode }), "PAIR_RATE_LIMIT");
});

test("deduplicates retried chat requests and synchronizes browser replies to the wallpaper", async t => {
  let chatCalls = 0;
  let release;
  const started = new Promise(resolve => { release = resolve; });
  const app = await fixture(t, async (url, options) => {
    if (url.endsWith("/chat")) {
      chatCalls++;
      await started;
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { text: "白米饭煮好了", requestId: "fixture-request-1" });
      return Response.json({ ok: true, userMessage: { id: "u1", role: "user", text: body.text },
        reply: { id: "a1", role: "assistant", text: "我要吃一大碗！", audio: { url: "?token=" + upstreamToken } } });
    }
    return Response.json({ ok: true });
  });
  const initial = await (await fetch(app.origin + "/api/room-events", { headers: app.headers })).json();
  assert.deepEqual(initial.events, []);
  const body = { requestId: "fixture-request-1", text: "白米饭煮好了" };
  const a = app.post("/api/chat", body);
  const b = app.post("/api/chat", body);
  await new Promise(resolve => setTimeout(resolve, 30));
  await failure(await app.post("/api/chat", { requestId: "fixture-request-2", text: "另一条消息" }), "CHAT_BUSY");
  release();
  const [one, two] = await Promise.all([a, b]);
  const left = await one.json();
  assert.deepEqual(left, await two.json());
  assert.equal(chatCalls, 1);
  assert.equal(left.reply.text, "我要吃一大碗！");
  assert.equal(left.reply.audio, undefined);
  await failure(await app.post("/api/chat", { requestId: body.requestId, text: "修改过的消息" }), "REQUEST_CONFLICT");
  const events = await (await fetch(app.origin + "/api/room-events?since=" + initial.cursor, { headers: app.headers })).json();
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].reply.id, "a1");
  assert.equal(events.events[0].userMessage.text, body.text);
});

test("rediscovers changed DSH ports and tokens, with visible errors on stale host data", async t => {
  const app = await fixture(t);
  await fetch(app.origin + "/api/status", { headers: app.headers });
  await writeFile(app.hostFile, JSON.stringify({ token: "fixture-new-token", baseUrl: "http://127.0.0.1:45679", api: "/dsh-room-world/api" }));
  await fetch(app.origin + "/api/status", { headers: app.headers });
  assert.match(app.calls[1].url, /:45679/);
  assert.equal(app.calls[1].options.headers["x-pet-token"], "fixture-new-token");
  await writeFile(app.hostFile, "not JSON");
  await failure(await fetch(app.origin + "/api/status", { headers: app.headers }), "SURFCORE_HOST_MISSING");
  await writeFile(app.hostFile, JSON.stringify({ token: upstreamToken, baseUrl: "http://example.org", api: "/dsh-room-world/api" }));
  await failure(await fetch(app.origin + "/api/status", { headers: app.headers }), "LOCAL_URL_INVALID");
});

test("normalizes upstream failure messages and validates client input", async t => {
  const app = await fixture(t, () => Response.json({ ok: false, error: "bad " + upstreamToken }, { status: 401 }));
  const denied = await failure(await fetch(app.origin + "/api/status", { headers: app.headers }), "SURFCORE_AUTH_FAILED");
  assert.ok(!denied.error.includes(upstreamToken));
  await failure(await app.post("/api/chat", { text: "", requestId: "fixture-request-1" }), "MESSAGE_INVALID");
  await failure(await app.post("/api/chat", null), "JSON_INVALID");
  await failure(await fetch(app.origin + "/api/events?since=not-a-number", { headers: app.headers }), "CURSOR_INVALID");
});

test("stops only the local connector through its authenticated shutdown endpoint", async t => {
  const app = await fixture(t);
  const response = await fetch(app.origin + "/api/shutdown", { method: "POST", headers: app.headers });
  assert.equal((await response.json()).ok, true);
  await new Promise(resolve => app.server.once("close", resolve));
  assert.equal(app.server.listening, false);
  assert.equal(app.calls.length, 0);
});

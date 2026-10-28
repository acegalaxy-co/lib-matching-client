import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { matchNode, confirmRoom, releaseNode, classify, classifyAction, buildMatchBody, BUCKETS, LUDO_BUCKETS } from '../dist/index.js';

const OK = { ok: true, nodeId: 2000, serverBase: 2000, label: 'Gse-Engine', host: 'game.example.com', port: 443, ssl: true, zone: 'ludo', bucket: '2P_6', ticket: 't', reused: false, leaseNode: true };
const input = { userId: 14246, game: 'ludo', gameToken: 'gt-123', loginName: '14246', bucket: '2P_6' };

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => handler(req, b, res)); });
    s.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

test('ok: sends body + X-Game-Token only (no Authorization), returns node', async () => {
  let seen;
  const { s, url } = await server((req, b, res) => { seen = { path: req.url, auth: req.headers.authorization, gt: req.headers['x-game-token'], body: JSON.parse(b) }; res.end(JSON.stringify(OK)); });
  try {
    const r = await matchNode({ baseUrl: url + '/' }, input);
    assert.equal(r.kind, 'ok');
    assert.equal(r.node.host, 'game.example.com'); assert.equal(r.node.zone, 'ludo'); assert.equal(r.node.port, 443);
    assert.deepEqual(seen, { path: '/v1/match', auth: undefined, gt: 'gt-123', body: { userId: '14246', game: 'ludo', loginName: '14246', bucket: '2P_6' } });
  } finally { s.close(); }
});

test('no bucket for non-Ludo games', () => {
  assert.deepEqual(buildMatchBody({ userId: '1', game: 'fish', gameToken: 'x', loginName: 'Bob' }), { userId: '1', game: 'fish', loginName: 'Bob' });
});

test('classify: presence -> blocked, business errors -> fallback', () => {
  const ob = classify(200, { ok: false, reason: 'PRESENCE_OTHER_GAME' });
  assert.equal(ob.kind, 'blocked'); assert.equal(ob.reason, 'PRESENCE_OTHER_GAME'); assert.equal(ob.retryAfterMs, null); assert.equal(ob.ms, 0);
  assert.equal(classify(200, { ok: false, reason: 'PRESENCE_LOCKED', retryAfterMs: 5000 }).retryAfterMs, 5000);
  for (const reason of ['NO_NODE', 'UNKNOWN_GAME', 'UNKNOWN_BUCKET']) assert.equal(classify(200, { ok: false, reason }).kind, 'fallback');
  assert.equal(classify(401, { ok: false, reason: 'UNAUTHORIZED' }).reason, 'UNAUTHORIZED');
  assert.equal(classify(503, null).reason, 'HTTP_503');
  assert.equal(classify(403, { ok: false, reason: 'USER_MISMATCH' }).kind, 'fallback');
  assert.equal(classify(200, { ok: true, host: '', port: 0 }).reason, 'BAD_RESPONSE');
});

test('timeout -> fallback TIMEOUT, never throws', async () => {
  const { s, url } = await server(() => { /* never answers */ });
  try {
    const r = await matchNode({ baseUrl: url, timeoutMs: 100 }, input);
    assert.equal(r.kind, 'fallback'); assert.equal(r.reason, 'TIMEOUT');
  } finally { s.closeAllConnections(); s.close(); }
});

test('network error / missing config -> fallback', async () => {
  assert.equal((await matchNode({ baseUrl: 'http://127.0.0.1:1' }, input)).reason, 'NETWORK');
  assert.equal((await matchNode({ baseUrl: '' }, input)).reason, 'NO_CONFIG');
});

test('XMLHttpRequest transport is used when present (Cocos)', async () => {
  const calls = [];
  globalThis.XMLHttpRequest = class {
    open(m, u) { calls.push([m, u]); } setRequestHeader(k, v) { calls.push([k, v]); }
    send(b) { calls.push(['body', b]); this.status = 200; this.responseText = JSON.stringify(OK); setTimeout(() => this.onload(), 0); }
  };
  try {
    const { matchNode: m } = await import('../dist/index.js?xhr');
    const r = await m({ baseUrl: 'https://mm.example.com' }, input);
    assert.equal(r.kind, 'ok');
    assert.deepEqual(calls[0], ['POST', 'https://mm.example.com/v1/match']);
    assert.ok(calls.some(([k, v]) => k === 'X-Game-Token' && v === 'gt-123'));
  } finally { delete globalThis.XMLHttpRequest; }
});

test('xhr: no Authorization header is set', async () => {
  const hdrs = [];
  globalThis.XMLHttpRequest = class {
    open() {} setRequestHeader(k) { hdrs.push(k); }
    send() { this.status = 200; this.responseText = JSON.stringify(OK); setTimeout(() => this.onload(), 0); }
  };
  try {
    const { matchNode: m } = await import('../dist/index.js?xhr2');
    await m({ baseUrl: 'https://mm.example.com' }, input);
    assert.ok(hdrs.includes('X-Game-Token')); assert.ok(!hdrs.some((h) => h.toLowerCase() === 'authorization'));
  } finally { delete globalThis.XMLHttpRequest; }
});

test('missing gameToken -> NO_GAME_TOKEN without network', async () => {
  let hit = 0;
  const t = async () => { hit++; return { status: 200, body: OK }; };
  for (const gameToken of [undefined, '']) {
    const r = await matchNode({ baseUrl: 'http://x.example.com', transport: t }, { ...input, gameToken });
    assert.deepEqual(r, { kind: 'fallback', reason: 'NO_GAME_TOKEN', status: null, ms: 0 });
  }
  assert.equal(hit, 0);
});

test('userId omitted from body when not given', async () => {
  let sent;
  const t = async (u, body) => { sent = JSON.parse(body); return { status: 200, body: OK }; };
  await matchNode({ baseUrl: 'http://x.example.com', transport: t }, { game: 'fish', gameToken: 'g', loginName: 'Bob' });
  assert.deepEqual(sent, { game: 'fish', loginName: 'Bob' });
  assert.deepEqual(buildMatchBody({ userId: 7, game: 'fish', gameToken: 'g', loginName: 'Bob' }), { userId: '7', game: 'fish', loginName: 'Bob' });
});

test('503 AUTH_UNAVAILABLE reason preserved', () => {
  const r = classify(503, { ok: false, reason: 'AUTH_UNAVAILABLE' }, 5);
  assert.deepEqual(r, { kind: 'fallback', reason: 'AUTH_UNAVAILABLE', status: 503, ms: 5, raw: { ok: false, reason: 'AUTH_UNAVAILABLE' } });
  assert.equal(classify(503, { reason: '' }).reason, 'HTTP_503');
});

test('callback: called once with same object as the promise; roomId passed through', async () => {
  const t = async () => ({ status: 200, body: { ...OK, roomId: 'R-77' } });
  const calls = [];
  const r = await matchNode({ baseUrl: 'http://x.example.com', transport: t }, input, (o) => calls.push(o));
  assert.equal(calls.length, 1);
  assert.equal(calls[0], r);
  assert.equal(r.kind, 'ok'); assert.equal(r.node.roomId, 'R-77');
});

test('callback fires for NO_GAME_TOKEN and NETWORK fallbacks', async () => {
  const got = [];
  const r1 = await matchNode({ baseUrl: 'http://x.example.com' }, { ...input, gameToken: '' }, (o) => got.push(o));
  const bad = async () => { throw new Error('NETWORK'); };
  const r2 = await matchNode({ baseUrl: 'http://x.example.com', transport: bad }, input, (o) => got.push(o));
  assert.equal(got.length, 2);
  assert.equal(got[0], r1); assert.equal(got[0].reason, 'NO_GAME_TOKEN');
  assert.equal(got[1], r2); assert.equal(got[1].reason, 'NETWORK');
});

test('callback that throws does not break matchNode', async () => {
  const t = async () => ({ status: 200, body: OK });
  const orig = console.error; let logged = 0;
  console.error = () => { logged++; };
  try {
    const r = await matchNode({ baseUrl: 'http://x.example.com', transport: t }, input, () => { throw new Error('boom'); });
    assert.equal(r.kind, 'ok'); assert.equal(logged, 1);
  } finally { console.error = orig; }
});

test('classify: roomId null/missing -> no key; numeric -> string', () => {
  assert.equal('roomId' in classify(200, { ...OK, roomId: null }).node, false);
  assert.equal('roomId' in classify(200, { ...OK }).node, false);
  assert.equal('roomId' in classify(200, { ...OK, roomId: '' }).node, false);
  assert.equal(classify(200, { ...OK, roomId: 12 }).node.roomId, '12');
});

// ---- v0.4.0 ----
const fake = (status, body, calls = []) => (url, b, headers, t) => { calls.push({ url, body: JSON.parse(b), headers, t }); return Promise.resolve({ status, body }); };

test('bucket: any game bucket is sent, malformed bucket dropped', () => {
  const base = { userId: '1', gameToken: 'x', loginName: 'u' };
  assert.equal(buildMatchBody({ ...base, game: 'dominoqq', bucket: '3' }).bucket, '3');
  assert.equal(buildMatchBody({ ...base, game: 'chess', bucket: 'rapid10:r' }).bucket, 'rapid10:r');
  assert.equal(buildMatchBody({ ...base, game: 'ludo', bucket: '2P_6' }).bucket, '2P_6');
  for (const bad of ['', 'a b', 'x'.repeat(33), 'a/b', '<x>', 5]) assert.equal('bucket' in buildMatchBody({ ...base, game: 'g', bucket: bad }), false, String(bad));
  assert.equal(BUCKETS, LUDO_BUCKETS); assert.equal(BUCKETS.length, 9);
});

test('match keeps status/raw; presence keeps reason/retryAfterMs/heldGame; UNKNOWN_GAME fallback keeps reason', async () => {
  const ok = await matchNode({ baseUrl: 'http://x', transport: fake(200, OK) }, input);
  assert.equal(ok.kind, 'ok'); assert.equal(ok.status, 200); assert.equal(ok.raw.nodeId, 2000);
  assert.equal(ok.node.nodeId, 2000); assert.equal(ok.node.label, 'Gse-Engine'); assert.equal(ok.node.reused, false); assert.equal(ok.node.leaseNode, true);
  const locked = await matchNode({ baseUrl: 'http://x', transport: fake(200, { ok: false, reason: 'PRESENCE_LOCKED', retryAfterMs: 7000, heldGame: 'holdem' }) }, input);
  assert.equal(locked.kind, 'blocked'); assert.equal(locked.reason, 'PRESENCE_LOCKED'); assert.equal(locked.retryAfterMs, 7000); assert.equal(locked.heldGame, 'holdem'); assert.equal(locked.status, 200);
  const other = await matchNode({ baseUrl: 'http://x', transport: fake(200, { ok: false, reason: 'PRESENCE_OTHER_GAME' }) }, input);
  assert.equal(other.kind, 'blocked'); assert.equal(other.retryAfterMs, null); assert.equal('heldGame' in other, false);
  const unk = await matchNode({ baseUrl: 'http://x', transport: fake(200, { ok: false, reason: 'UNKNOWN_GAME' }) }, input);
  assert.equal(unk.kind, 'fallback'); assert.equal(unk.reason, 'UNKNOWN_GAME'); assert.equal(unk.status, 200);
  const auth = await matchNode({ baseUrl: 'http://x', transport: fake(503, { ok: false, reason: 'AUTH_UNAVAILABLE' }) }, input);
  assert.equal(auth.reason, 'AUTH_UNAVAILABLE'); assert.equal(auth.status, 503); assert.equal(auth.raw.reason, 'AUTH_UNAVAILABLE');
});

test('confirmRoom happy: POST /v1/confirm, X-Game-Token header, token not in body, callback once', async () => {
  const calls = []; const cbs = [];
  const r = await confirmRoom({ baseUrl: 'https://mm.example.com/', timeoutMs: 500, transport: fake(200, { ok: true }, calls) },
    { userId: 14246, game: 'ludo', roomId: 99, gameToken: 'gt-123' }, (o) => cbs.push(o));
  assert.equal(r.kind, 'ok'); assert.equal(r.status, 200); assert.equal(r.reason, undefined);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://mm.example.com/v1/confirm');
  assert.deepEqual(calls[0].body, { userId: '14246', game: 'ludo', roomId: '99' });
  assert.equal(calls[0].headers['X-Game-Token'], 'gt-123'); assert.equal(calls[0].headers.Authorization, undefined); assert.equal(calls[0].t, 500);
  assert.equal(cbs.length, 1); assert.equal(cbs[0], r);
});

test('releaseNode happy: POST /v1/release without userId', async () => {
  const calls = []; const cbs = [];
  const r = await releaseNode({ baseUrl: 'https://mm.example.com', transport: fake(200, { ok: true }, calls) }, { game: 'gaple', gameToken: 'gt' }, (o) => cbs.push(o));
  assert.equal(r.kind, 'ok'); assert.equal(calls[0].url, 'https://mm.example.com/v1/release');
  assert.deepEqual(calls[0].body, { game: 'gaple' }); assert.equal(cbs.length, 1); assert.equal(cbs[0], r);
});

test('confirm/release: missing gameToken / config / roomId -> fail without calling transport', async () => {
  let n = 0; const transport = () => { n++; return Promise.resolve({ status: 200, body: { ok: true } }); };
  const cbs = [];
  const a = await confirmRoom({ baseUrl: 'http://x', transport }, { game: 'ludo', roomId: '1', gameToken: '' }, (o) => cbs.push(o));
  const b = await releaseNode({ baseUrl: 'http://x', transport }, { game: 'ludo', gameToken: undefined });
  const c = await confirmRoom({ baseUrl: 'http://x', transport }, { game: 'ludo', roomId: '', gameToken: 't' });
  const d = await releaseNode({ baseUrl: '', transport }, { game: 'ludo', gameToken: 't' });
  assert.deepEqual([a.kind, a.reason, a.status], ['fail', 'NO_GAME_TOKEN', null]);
  assert.equal(b.reason, 'NO_GAME_TOKEN'); assert.equal(c.reason, 'NO_ROOM_ID'); assert.equal(d.reason, 'NO_CONFIG');
  assert.equal(n, 0); assert.equal(cbs.length, 1);
});

test('confirm/release: HTTP errors keep status + reason', async () => {
  const run = (status, body) => confirmRoom({ baseUrl: 'http://x', transport: fake(status, body) }, { game: 'ludo', roomId: '1', gameToken: 't' });
  let r = await run(200, { ok: false, reason: 'NO_RESERVATION' });
  assert.deepEqual([r.kind, r.reason, r.status], ['fail', 'NO_RESERVATION', 200]);
  r = await run(401, { ok: false, reason: 'UNAUTHORIZED' }); assert.deepEqual([r.kind, r.reason, r.status], ['fail', 'UNAUTHORIZED', 401]);
  r = await run(403, { ok: false, reason: 'USER_MISMATCH' }); assert.equal(r.reason, 'USER_MISMATCH');
  r = await run(503, { ok: false, reason: 'AUTH_UNAVAILABLE' }); assert.equal(r.reason, 'AUTH_UNAVAILABLE');
  r = await run(404, null); assert.deepEqual([r.kind, r.reason], ['fail', 'HTTP_404']);
  r = await run(500, 'x'); assert.equal(r.reason, 'HTTP_500');
  assert.equal(classifyAction(200, null).kind, 'ok');
});

test('confirm/release: timeout and network errors -> fail with reason, never throw', async () => {
  const { s, url } = await server(() => { /* never answers */ });
  try {
    const r = await releaseNode({ baseUrl: url, timeoutMs: 100 }, { game: 'ludo', gameToken: 't' });
    assert.deepEqual([r.kind, r.reason, r.status], ['fail', 'TIMEOUT', null]);
  } finally { s.closeAllConnections(); s.close(); }
  assert.equal((await confirmRoom({ baseUrl: 'http://127.0.0.1:1' }, { game: 'ludo', roomId: '1', gameToken: 't' })).reason, 'NETWORK');
  const thrower = () => Promise.reject(new Error('boom'));
  assert.equal((await confirmRoom({ baseUrl: 'http://x', transport: thrower }, { game: 'g', roomId: '1', gameToken: 't' })).reason, 'NETWORK');
});

test('callback that throws does not break confirm/release', async () => {
  const orig = console.error; console.error = () => {};
  try {
    const r = await releaseNode({ baseUrl: 'http://x', transport: fake(200, { ok: true }) }, { game: 'g', gameToken: 't' }, () => { throw new Error('cb'); });
    assert.equal(r.kind, 'ok');
  } finally { console.error = orig; }
});

// ---- v0.5.0: listRooms + roomId/nodeId ----
import { listRooms, MatchingClient } from '../dist/index.js';

const LR = { ok: true, ts: 1, game: 'ludo', cmd: 'room.list', data: { rooms: [1] } };
const lrCfg = (status, body, headers, extra) => ({ baseUrl: 'http://d', transport: () => Promise.resolve({ status, body, headers }), ...extra });

test('listRooms ok: GET /v1/rooms?game=&bucket= with X-Game-Token, data passthrough', async () => {
  let seen;
  const { s, url } = await server((req, b, res) => { seen = { method: req.method, path: req.url, gt: req.headers['x-game-token'] }; res.end(JSON.stringify(LR)); });
  try {
    const r = await new MatchingClient({ baseUrl: url + '/' }).listRooms({ game: 'ludo', bucket: '2P_6', gameToken: 'gt-1' });
    assert.deepEqual(r, { ok: true, cmd: 'room.list', data: { rooms: [1] } });
    assert.deepEqual(seen, { method: 'GET', path: '/v1/rooms?game=ludo&bucket=2P_6', gt: 'gt-1' });
    await listRooms({ baseUrl: url }, { game: 'ludo', bucket: 'bad bucket!', gameToken: 'gt-1' });
    assert.equal(seen.path, '/v1/rooms?game=ludo');
  } finally { s.close(); }
});

test('listRooms: missing gameToken -> NO_GAME_TOKEN, transport not called', async () => {
  let n = 0;
  const cfg = { baseUrl: 'http://d', transport: async () => { n++; return { status: 200, body: LR }; } };
  assert.deepEqual(await listRooms(cfg, { game: 'g' }), { ok: false, reason: 'NO_GAME_TOKEN', status: null });
  assert.equal((await listRooms(cfg, { game: 'g', gameToken: '' })).reason, 'NO_GAME_TOKEN');
  assert.equal(n, 0);
});

test('listRooms: 401/403 -> UNAUTHORIZED, 429 -> RATE_LIMITED + retryAfterMs, 400 UNKNOWN_GAME, 5xx, bad body', async () => {
  const inp = { game: 'g', gameToken: 't' };
  assert.deepEqual(await listRooms(lrCfg(401, { ok: false }), inp), { ok: false, reason: 'UNAUTHORIZED', status: 401 });
  assert.deepEqual(await listRooms(lrCfg(403, null), inp), { ok: false, reason: 'UNAUTHORIZED', status: 403 });
  assert.deepEqual(await listRooms(lrCfg(429, { ok: false }, { 'retry-after': '3' }), inp), { ok: false, reason: 'RATE_LIMITED', status: 429, retryAfterMs: 3000 });
  assert.equal((await listRooms(lrCfg(429, { ok: false }), inp)).retryAfterMs, null);
  assert.equal((await listRooms(lrCfg(400, { ok: false, reason: 'UNKNOWN_GAME' }), inp)).reason, 'UNKNOWN_GAME');
  assert.deepEqual(await listRooms(lrCfg(503, null), inp), { ok: false, reason: 'HTTP_503', status: 503 });
  assert.deepEqual(await listRooms(lrCfg(200, null), inp), { ok: false, reason: 'HTTP_200', status: 200 });
});

test('listRooms: timeout, network, not configured; never throws', async () => {
  const { s, url } = await server(() => { /* never answers */ });
  try {
    assert.equal((await listRooms({ baseUrl: url, timeoutMs: 100 }, { game: 'ludo', gameToken: 't' })).reason, 'TIMEOUT');
  } finally { s.closeAllConnections(); s.close(); }
  assert.equal((await listRooms({ baseUrl: 'http://127.0.0.1:1' }, { game: 'ludo', gameToken: 't' })).reason, 'NETWORK');
  assert.equal((await listRooms({}, { game: 'ludo', gameToken: 't' })).reason, 'NOT_CONFIGURED');
  assert.equal((await listRooms(undefined, { game: 'ludo' })).reason, 'NOT_CONFIGURED');
});

test('listRooms legacy: roomApiUrl only -> old public path, no auth header, no token needed; baseUrl wins when both', async () => {
  const calls = [];
  const transport = async (u, b, h) => { calls.push({ u, h }); return { status: 200, body: LR }; };
  const r = await listRooms({ roomApiUrl: 'http://r/', transport }, { game: 'ludo' });
  assert.equal(r.ok, true);
  assert.equal(calls[0].u, 'http://r/v1/public/rooms?game=ludo');
  assert.equal('X-Game-Token' in calls[0].h, false);
  await listRooms({ baseUrl: 'http://d', roomApiUrl: 'http://r', transport }, { game: 'ludo', gameToken: 'T' });
  assert.equal(calls[1].u, 'http://d/v1/rooms?game=ludo');
  assert.equal(calls[1].h['X-Game-Token'], 'T');
  assert.equal((await listRooms({ baseUrl: 'http://d', roomApiUrl: 'http://r', transport }, { game: 'ludo' })).reason, 'NO_GAME_TOKEN');
});

test('matchNode: roomId/nodeId in body only when provided', async () => {
  const bodies = [];
  const transport = async (u, b) => { bodies.push(JSON.parse(b)); return { status: 200, body: OK }; };
  await matchNode({ baseUrl: 'http://x', transport }, input);
  await matchNode({ baseUrl: 'http://x', transport }, { ...input, roomId: 77, nodeId: '2000' });
  assert.equal('roomId' in bodies[0] || 'nodeId' in bodies[0], false);
  assert.equal(bodies[1].roomId, '77'); assert.equal(bodies[1].nodeId, '2000');
});

test('matchNode: 409 ROOM_UNAVAILABLE and 400 ROOM_NODE_REQUIRED -> fallback with reason', async () => {
  for (const [status, reason] of [[409, 'ROOM_UNAVAILABLE'], [400, 'ROOM_NODE_REQUIRED']]) {
    const r = await matchNode({ baseUrl: 'http://x', transport: fake(status, { ok: false, reason }) }, { ...input, roomId: '1' });
    assert.deepEqual([r.kind, r.reason, r.status], ['fallback', reason, status]);
  }
});

test('listRooms: balance forwarded as query param, omitted when undefined', async () => {
  const urls = [];
  const transport = async (u) => { urls.push(u); return { status: 200, body: { ok: true, cmd: 'c', data: {} } }; };
  const cfg = { baseUrl: 'http://d', transport };
  await listRooms(cfg, { game: 'gaple', bucket: '1', balance: 12500, gameToken: 't' });
  await listRooms(cfg, { game: 'gaple', balance: '0', gameToken: 't' });
  await listRooms(cfg, { game: 'gaple', gameToken: 't' });
  assert.deepEqual(urls, [
    'http://d/v1/rooms?game=gaple&bucket=1&balance=12500',
    'http://d/v1/rooms?game=gaple&balance=0',
    'http://d/v1/rooms?game=gaple',
  ]);
});

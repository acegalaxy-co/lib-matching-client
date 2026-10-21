import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { matchNode, classify, buildMatchBody } from '../dist/index.js';

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
  assert.deepEqual(classify(200, { ok: false, reason: 'PRESENCE_OTHER_GAME' }), { kind: 'blocked', reason: 'PRESENCE_OTHER_GAME', retryAfterMs: null, ms: 0 });
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
  assert.deepEqual(r, { kind: 'fallback', reason: 'AUTH_UNAVAILABLE', status: 503, ms: 5 });
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

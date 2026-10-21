// Client for the matching director (step 4): POST /v1/match, /v1/confirm, /v1/release.
// Zero dependencies; works in Cocos Creator 3.8 (XMLHttpRequest) and Node 18+ (fetch).
// The lib only picks a suitable server; it never opens or touches the SFS socket.
// The result goes to the caller's callback and the lobby connects to the game with it.

export interface MatchConfig {
  baseUrl: string;
  /** v0.5.0: base URL of the public room API (GET /v1/public/rooms). Absent = listRooms returns NOT_CONFIGURED. */
  roomApiUrl?: string;
  /** Request timeout in ms (default 2000). */
  timeoutMs?: number;
  /** Override the HTTP transport (tests / custom stacks). Default: XHR when present, else fetch. */
  transport?: MatchTransport;
}

export interface MatchInput {
  /** Optional: the director takes the userId from the game token. */
  userId?: string | number;
  game: string;
  gameToken: string;
  loginName: string;
  /**
   * Table type for games whose director policy uses buckets (Ludo "2P_6", dominoqq "1".."18", gaple "1".."6",
   * chess "rapid10:r", ...). The lib does not check it against any game list, only its syntax
   * (1-32 chars of [A-Za-z0-9_:.-]); a malformed bucket is NOT sent. Games without buckets ignore it.
   */
  bucket?: string;
  /** v0.5.0: join this specific room (requires nodeId, else the director answers 400 ROOM_NODE_REQUIRED). Sent only when provided. */
  roomId?: string | number;
  /** v0.5.0: node that owns roomId. Sent only when provided. */
  nodeId?: string | number;
}

export interface ConfirmInput {
  /** Optional: the director takes the userId from the game token. */
  userId?: string | number;
  game: string;
  /** The real room the player joined (after SFS login + join). */
  roomId: string | number;
  gameToken: string;
}

export interface ReleaseInput {
  userId?: string | number;
  game: string;
  gameToken: string;
}

/** Result of confirmRoom / releaseNode. ok = HTTP < 400 and body.ok !== false. Never thrown. */
export interface ActionResult {
  kind: 'ok' | 'fail';
  /** HTTP status, null when no response (NO_CONFIG, NO_GAME_TOKEN, NO_ROOM_ID, TIMEOUT, NETWORK). */
  status: number | null;
  /** Set on fail: director reason (NO_RESERVATION, USER_MISMATCH, UNAUTHORIZED, AUTH_UNAVAILABLE, ...), HTTP_<status>, or a local reason. */
  reason?: string;
  ms: number;
  /** Parsed JSON body of the director response (null when none / not JSON). */
  raw?: any;
}

export type ActionCallback = (obj: ActionResult) => void;

export interface MatchNode {
  host: string;
  port: number;
  ssl: boolean;
  zone: string;
  bucket: string;
  ticket: string;
  reused: boolean;
  nodeId: number;
  label?: string;
  serverBase?: number;
  leaseNode?: boolean;
  /** Room to join right after login when the director knows one (Ludo); absent = the lobby picks. */
  roomId?: string;
}

/**
 * v0.4.0 added (additive) `status` on ok/blocked, `heldGame` on blocked, `raw` on all.
 * `status` is the HTTP status, null when no response was received.
 * `raw` is the parsed director body (null when none); never contains the game token.
 */
export type MatchResult =
  | { kind: 'ok'; node: MatchNode; ms: number; status?: number | null; raw?: any }
  | { kind: 'fallback'; reason: string; status: number | null; ms: number; raw?: any }
  | { kind: 'blocked'; reason: string; retryAfterMs: number | null; ms: number; status?: number | null; heldGame?: string; raw?: any };

/** Receives the full result once; the lobby uses it to connect on ok, or to decide on fallback/blocked. */
export type MatchCallback = (obj: MatchResult) => void;

export type MatchTransport = (
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  /** v0.5.0: HTTP method, 'POST' (default) or 'GET' (listRooms; body is ''). */
  method?: 'GET' | 'POST'
) => Promise<{ status: number; body: any }>;

export interface ListRoomsInput {
  game: string;
  bucket?: string;
  /** v0.5.0: forwarded as `balance` query param (String(), omitted when undefined/null) for games whose list depends on the player's balance. */
  balance?: string | number;
}

/** Result of listRooms. data is the room API payload as-is (same shape the game's SFS list reply carries). */
export type ListRoomsResult =
  | { ok: true; cmd: string; data: any }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'UNKNOWN_GAME' | string };

/** Ludo buckets only (kept for compatibility). Other games have their own buckets; the lib does not list them. */
export const LUDO_BUCKETS = ['2P_6', '2P_56', '2P_246', '3P_6', '3P_56', '3P_246', '4P_6', '4P_56', '4P_246'] as const;
/** @deprecated alias of LUDO_BUCKETS (Ludo only). */
export const BUCKETS = LUDO_BUCKETS;

const BUCKET_RE = /^[A-Za-z0-9_:.-]{1,32}$/;
/** Syntax check only (no per-game list). */
export function isValidBucket(b: unknown): b is string {
  return typeof b === 'string' && BUCKET_RE.test(b);
}

const hasId = (v: unknown) => v !== undefined && v !== null && v !== '';

/** Request body. gameToken is deliberately excluded (it goes in a header). */
export function buildMatchBody(input: MatchInput): Record<string, string> {
  const body: Record<string, string> = {};
  if (hasId(input.userId)) body.userId = String(input.userId);
  body.game = input.game;
  body.loginName = input.loginName;
  if (isValidBucket(input.bucket)) body.bucket = input.bucket; // malformed bucket is dropped, not sent
  if (hasId(input.roomId)) body.roomId = String(input.roomId);
  if (hasId(input.nodeId)) body.nodeId = String(input.nodeId);
  return body;
}

export function buildConfirmBody(input: ConfirmInput): Record<string, string> {
  const body: Record<string, string> = {};
  if (hasId(input.userId)) body.userId = String(input.userId);
  body.game = input.game;
  body.roomId = String(input.roomId);
  return body;
}

export function buildReleaseBody(input: ReleaseInput): Record<string, string> {
  const body: Record<string, string> = {};
  if (hasId(input.userId)) body.userId = String(input.userId);
  body.game = input.game;
  return body;
}

/** Map an HTTP status + parsed JSON to ok / fallback / blocked. */
export function classify(status: number, json: any, ms = 0): MatchResult {
  const raw = json ?? null;
  if (status >= 500) {
    const r = json && typeof json.reason === 'string' && json.reason ? json.reason : `HTTP_${status}`;
    return { kind: 'fallback', reason: r, status, ms, raw };
  }
  if (json && json.ok === true) {
    const port = Number(json.port);
    if (!json.host || !isFinite(port) || port <= 0) {
      return { kind: 'fallback', reason: 'BAD_RESPONSE', status, ms, raw };
    }
    const node: MatchNode = { ...json, port, ssl: json.ssl !== false, bucket: String(json.bucket ?? '*') };
    if (json.roomId !== undefined && json.roomId !== null && json.roomId !== '') node.roomId = String(json.roomId);
    else delete node.roomId;
    return { kind: 'ok', node, ms, status, raw };
  }
  const reason: string = (json && json.reason) || `HTTP_${status}`;
  if (reason === 'PRESENCE_OTHER_GAME' || reason === 'PRESENCE_LOCKED') {
    const b: MatchResult = {
      kind: 'blocked',
      reason,
      retryAfterMs: reason === 'PRESENCE_LOCKED' ? Number(json.retryAfterMs) || 30000 : null,
      ms,
      status,
      raw,
    };
    if (json && typeof json.heldGame === 'string' && json.heldGame) b.heldGame = json.heldGame;
    return b;
  }
  return { kind: 'fallback', reason, status, ms, raw };
}

function xhrTransport(url: string, body: string, headers: Record<string, string>, timeoutMs: number, method: 'GET' | 'POST' = 'POST') {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url, true);
    x.timeout = timeoutMs;
    for (const k of Object.keys(headers)) x.setRequestHeader(k, headers[k]);
    x.onload = () => {
      let parsed: any = null;
      try { parsed = JSON.parse(x.responseText); } catch (_) { parsed = null; }
      resolve({ status: x.status, body: parsed });
    };
    x.onerror = () => reject(new Error('NETWORK'));
    x.ontimeout = () => reject(new Error('TIMEOUT'));
    if (method === 'GET') x.send(); else x.send(body);
  });
}

async function fetchTransport(url: string, body: string, headers: Record<string, string>, timeoutMs: number, method: 'GET' | 'POST' = 'POST') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, method === 'GET' ? { method, headers, signal: ctrl.signal } : { method, headers, body, signal: ctrl.signal });
    let parsed: any = null;
    try { parsed = await res.json(); } catch (_) { parsed = null; }
    return { status: res.status, body: parsed };
  } catch (e: any) {
    throw new Error(e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

// Pick the transport at call time so the module has no load-time dependency on fetch/XHR.
function defaultTransport(): MatchTransport {
  return typeof XMLHttpRequest !== 'undefined' ? xhrTransport : fetchTransport;
}

const now = () => Date.now();

async function requestMatch(cfg: MatchConfig, input: MatchInput): Promise<MatchResult> {
  if (!cfg || !cfg.baseUrl) {
    return { kind: 'fallback', reason: 'NO_CONFIG', status: null, ms: 0 };
  }
  if (!input || !input.gameToken) {
    return { kind: 'fallback', reason: 'NO_GAME_TOKEN', status: null, ms: 0 };
  }
  const t0 = now();
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/match`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Game-Token': input.gameToken,
  };
  try {
    const send = cfg.transport || defaultTransport();
    const res = await send(url, JSON.stringify(buildMatchBody(input)), headers, cfg.timeoutMs ?? 2000);
    return classify(res.status, res.body, now() - t0);
  } catch (e: any) {
    const reason = e && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK';
    return { kind: 'fallback', reason, status: null, ms: now() - t0 };
  }
}

/**
 * Ask the director for a node. Never throws, never touches the SFS socket.
 * callbackFun (optional) is called exactly once with the same result object the promise resolves to
 * (also for NO_CONFIG / NO_GAME_TOKEN / TIMEOUT / NETWORK fallbacks); errors it throws are logged, not propagated.
 */
export async function matchNode(cfg: MatchConfig, input: MatchInput, callbackFun?: MatchCallback): Promise<MatchResult> {
  const result = await requestMatch(cfg, input);
  if (typeof callbackFun === 'function') {
    try { callbackFun(result); } catch (e) { console.error('[lib-matching-client] callbackFun threw', e); }
  }
  return result;
}

/** Classify a confirm/release HTTP answer. */
export function classifyAction(status: number, json: any, ms = 0): ActionResult {
  const raw = json ?? null;
  if (status < 400 && !(json && json.ok === false)) return { kind: 'ok', status, ms, raw };
  const reason = json && typeof json.reason === 'string' && json.reason ? json.reason : `HTTP_${status}`;
  return { kind: 'fail', status, reason, ms, raw };
}

async function requestAction(
  cfg: MatchConfig,
  path: string,
  gameToken: string | undefined,
  body: () => Record<string, string>,
  precheck?: () => string | null
): Promise<ActionResult> {
  if (!cfg || !cfg.baseUrl) return { kind: 'fail', status: null, reason: 'NO_CONFIG', ms: 0 };
  if (!gameToken) return { kind: 'fail', status: null, reason: 'NO_GAME_TOKEN', ms: 0 };
  const bad = precheck ? precheck() : null;
  if (bad) return { kind: 'fail', status: null, reason: bad, ms: 0 };
  const t0 = now();
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Game-Token': gameToken };
  try {
    const send = cfg.transport || defaultTransport();
    const res = await send(url, JSON.stringify(body()), headers, cfg.timeoutMs ?? 2000);
    return classifyAction(res.status, res.body, now() - t0);
  } catch (e: any) {
    const reason = e && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK';
    return { kind: 'fail', status: null, reason, ms: now() - t0 };
  }
}

function finish(result: ActionResult, cb?: ActionCallback): ActionResult {
  if (typeof cb === 'function') {
    try { cb(result); } catch (e) { console.error('[lib-matching-client] callbackFun threw', e); }
  }
  return result;
}

/**
 * Tell the director the player is really in `roomId` (POST /v1/confirm). Call after SFS login + join.
 * Never throws; callbackFun is called exactly once with the same object the promise resolves to.
 */
export async function confirmRoom(cfg: MatchConfig, input: ConfirmInput, callbackFun?: ActionCallback): Promise<ActionResult> {
  const r = await requestAction(
    cfg, '/v1/confirm', input && input.gameToken, () => buildConfirmBody(input),
    () => (!input.game ? 'BAD_REQUEST' : !hasId(input.roomId) ? 'NO_ROOM_ID' : null)
  );
  return finish(r, callbackFun);
}

/**
 * Release the player's presence lease (POST /v1/release). Call when the player leaves the table / game ends.
 * Never throws; callbackFun is called exactly once with the same object the promise resolves to.
 */
export async function releaseNode(cfg: MatchConfig, input: ReleaseInput, callbackFun?: ActionCallback): Promise<ActionResult> {
  const r = await requestAction(
    cfg, '/v1/release', input && input.gameToken, () => buildReleaseBody(input),
    () => (!input.game ? 'BAD_REQUEST' : null)
  );
  return finish(r, callbackFun);
}

/**
 * v0.5.0: list rooms from the public room API: GET ${roomApiUrl}/v1/public/rooms?game=&bucket=.
 * No auth headers. Never throws. ok:true -> {cmd, data} (data = the SFS-shaped list payload);
 * otherwise {ok:false, reason}: NOT_CONFIGURED (no roomApiUrl), NETWORK, TIMEOUT, RATE_LIMITED (429),
 * UNKNOWN_GAME, or HTTP_<status>. A malformed bucket is dropped, not sent.
 */
export async function listRooms(cfg: MatchConfig, input: ListRoomsInput): Promise<ListRoomsResult> {
  if (!cfg || !cfg.roomApiUrl) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (!input || typeof input.game !== 'string' || !input.game) return { ok: false, reason: 'UNKNOWN_GAME' };
  let url = `${cfg.roomApiUrl.replace(/\/+$/, '')}/v1/public/rooms?game=${encodeURIComponent(input.game)}`;
  if (isValidBucket(input.bucket)) url += `&bucket=${encodeURIComponent(input.bucket)}`;
  if (input.balance !== undefined && input.balance !== null) url += `&balance=${encodeURIComponent(String(input.balance))}`;
  try {
    const send = cfg.transport || defaultTransport();
    const res = await send(url, '', { Accept: 'application/json' }, cfg.timeoutMs ?? 2000, 'GET');
    const j = res.body;
    if (res.status === 429) return { ok: false, reason: 'RATE_LIMITED' };
    if (res.status < 400 && j && j.ok === true) return { ok: true, cmd: String(j.cmd ?? ''), data: j.data };
    if (j && j.reason === 'UNKNOWN_GAME') return { ok: false, reason: 'UNKNOWN_GAME' };
    return { ok: false, reason: `HTTP_${res.status}` };
  } catch (e: any) {
    return { ok: false, reason: e && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK' };
  }
}

/** Object wrapper over the functions above: `new MatchingClient({baseUrl, roomApiUrl?, timeoutMs?, transport?})`. */
export class MatchingClient {
  constructor(public readonly config: MatchConfig) {}
  matchNode(input: MatchInput, cb?: MatchCallback) { return matchNode(this.config, input, cb); }
  confirmRoom(input: ConfirmInput, cb?: ActionCallback) { return confirmRoom(this.config, input, cb); }
  releaseNode(input: ReleaseInput, cb?: ActionCallback) { return releaseNode(this.config, input, cb); }
  listRooms(input: ListRoomsInput) { return listRooms(this.config, input); }
}

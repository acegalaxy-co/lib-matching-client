// Client for the matching director (step 4): POST /v1/match.
// Zero dependencies; works in Cocos Creator 3.8 (XMLHttpRequest) and Node 18+ (fetch).

export interface MatchConfig {
  baseUrl: string;
  clientToken: string;
  /** Request timeout in ms (default 2000). */
  timeoutMs?: number;
}

export interface MatchInput {
  userId: string | number;
  game: string;
  gameToken: string;
  loginName: string;
  /** Ludo only. */
  bucket?: string;
}

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
}

export type MatchResult =
  | { kind: 'ok'; node: MatchNode; ms: number }
  | { kind: 'fallback'; reason: string; status: number | null; ms: number }
  | { kind: 'blocked'; reason: string; retryAfterMs: number | null; ms: number };

export type MatchTransport = (
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number
) => Promise<{ status: number; body: any }>;

export const BUCKETS = ['2P_6', '2P_56', '2P_246', '3P_6', '3P_56', '3P_246', '4P_6', '4P_56', '4P_246'] as const;

/** Request body. gameToken is deliberately excluded (it goes in a header). */
export function buildMatchBody(input: MatchInput): Record<string, string> {
  const body: Record<string, string> = {
    userId: String(input.userId),
    game: input.game,
    loginName: input.loginName,
  };
  if (input.bucket) body.bucket = input.bucket;
  return body;
}

/** Map an HTTP status + parsed JSON to ok / fallback / blocked. */
export function classify(status: number, json: any, ms = 0): MatchResult {
  if (status >= 500) return { kind: 'fallback', reason: `HTTP_${status}`, status, ms };
  if (json && json.ok === true) {
    const port = Number(json.port);
    if (!json.host || !isFinite(port) || port <= 0) {
      return { kind: 'fallback', reason: 'BAD_RESPONSE', status, ms };
    }
    const node: MatchNode = { ...json, port, ssl: json.ssl !== false, bucket: String(json.bucket ?? '*') };
    return { kind: 'ok', node, ms };
  }
  const reason: string = (json && json.reason) || `HTTP_${status}`;
  if (reason === 'PRESENCE_OTHER_GAME') return { kind: 'blocked', reason, retryAfterMs: null, ms };
  if (reason === 'PRESENCE_LOCKED') {
    return { kind: 'blocked', reason, retryAfterMs: Number(json.retryAfterMs) || 30000, ms };
  }
  return { kind: 'fallback', reason, status, ms };
}

function xhrTransport(url: string, body: string, headers: Record<string, string>, timeoutMs: number) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url, true);
    x.timeout = timeoutMs;
    for (const k of Object.keys(headers)) x.setRequestHeader(k, headers[k]);
    x.onload = () => {
      let parsed: any = null;
      try { parsed = JSON.parse(x.responseText); } catch (_) { parsed = null; }
      resolve({ status: x.status, body: parsed });
    };
    x.onerror = () => reject(new Error('NETWORK'));
    x.ontimeout = () => reject(new Error('TIMEOUT'));
    x.send(body);
  });
}

async function fetchTransport(url: string, body: string, headers: Record<string, string>, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
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

/** Ask the director for a node. Never throws. */
export async function matchNode(cfg: MatchConfig, input: MatchInput, transport?: MatchTransport): Promise<MatchResult> {
  if (!cfg || !cfg.baseUrl || !cfg.clientToken) {
    return { kind: 'fallback', reason: 'NO_CONFIG', status: null, ms: 0 };
  }
  const t0 = now();
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/match`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.clientToken}`,
  };
  if (input.gameToken) headers['X-Game-Token'] = input.gameToken;
  try {
    const send = transport || defaultTransport();
    const res = await send(url, JSON.stringify(buildMatchBody(input)), headers, cfg.timeoutMs ?? 2000);
    return classify(res.status, res.body, now() - t0);
  } catch (e: any) {
    const reason = e && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK';
    return { kind: 'fallback', reason, status: null, ms: now() - t0 };
  }
}

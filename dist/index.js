// Client for the matching director (step 4): POST /v1/match.
// Zero dependencies; works in Cocos Creator 3.8 (XMLHttpRequest) and Node 18+ (fetch).
// The lib only picks a suitable server; it never opens or touches the SFS socket.
// The result goes to the caller's callback and the lobby connects to the game with it.
export const BUCKETS = ['2P_6', '2P_56', '2P_246', '3P_6', '3P_56', '3P_246', '4P_6', '4P_56', '4P_246'];
/** Request body. gameToken is deliberately excluded (it goes in a header). */
export function buildMatchBody(input) {
    const body = {};
    if (input.userId !== undefined && input.userId !== null && input.userId !== '')
        body.userId = String(input.userId);
    body.game = input.game;
    body.loginName = input.loginName;
    if (input.bucket)
        body.bucket = input.bucket;
    return body;
}
/** Map an HTTP status + parsed JSON to ok / fallback / blocked. */
export function classify(status, json, ms = 0) {
    var _a;
    if (status >= 500) {
        const r = json && typeof json.reason === 'string' && json.reason ? json.reason : `HTTP_${status}`;
        return { kind: 'fallback', reason: r, status, ms };
    }
    if (json && json.ok === true) {
        const port = Number(json.port);
        if (!json.host || !isFinite(port) || port <= 0) {
            return { kind: 'fallback', reason: 'BAD_RESPONSE', status, ms };
        }
        const node = { ...json, port, ssl: json.ssl !== false, bucket: String((_a = json.bucket) !== null && _a !== void 0 ? _a : '*') };
        if (json.roomId !== undefined && json.roomId !== null && json.roomId !== '')
            node.roomId = String(json.roomId);
        else
            delete node.roomId;
        return { kind: 'ok', node, ms };
    }
    const reason = (json && json.reason) || `HTTP_${status}`;
    if (reason === 'PRESENCE_OTHER_GAME')
        return { kind: 'blocked', reason, retryAfterMs: null, ms };
    if (reason === 'PRESENCE_LOCKED') {
        return { kind: 'blocked', reason, retryAfterMs: Number(json.retryAfterMs) || 30000, ms };
    }
    return { kind: 'fallback', reason, status, ms };
}
function xhrTransport(url, body, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', url, true);
        x.timeout = timeoutMs;
        for (const k of Object.keys(headers))
            x.setRequestHeader(k, headers[k]);
        x.onload = () => {
            let parsed = null;
            try {
                parsed = JSON.parse(x.responseText);
            }
            catch (_) {
                parsed = null;
            }
            resolve({ status: x.status, body: parsed });
        };
        x.onerror = () => reject(new Error('NETWORK'));
        x.ontimeout = () => reject(new Error('TIMEOUT'));
        x.send(body);
    });
}
async function fetchTransport(url, body, headers, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
        let parsed = null;
        try {
            parsed = await res.json();
        }
        catch (_) {
            parsed = null;
        }
        return { status: res.status, body: parsed };
    }
    catch (e) {
        throw new Error(e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
    }
    finally {
        clearTimeout(timer);
    }
}
// Pick the transport at call time so the module has no load-time dependency on fetch/XHR.
function defaultTransport() {
    return typeof XMLHttpRequest !== 'undefined' ? xhrTransport : fetchTransport;
}
const now = () => Date.now();
async function requestMatch(cfg, input) {
    var _a;
    if (!cfg || !cfg.baseUrl) {
        return { kind: 'fallback', reason: 'NO_CONFIG', status: null, ms: 0 };
    }
    if (!input || !input.gameToken) {
        return { kind: 'fallback', reason: 'NO_GAME_TOKEN', status: null, ms: 0 };
    }
    const t0 = now();
    const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/match`;
    const headers = {
        'Content-Type': 'application/json',
        'X-Game-Token': input.gameToken,
    };
    try {
        const send = cfg.transport || defaultTransport();
        const res = await send(url, JSON.stringify(buildMatchBody(input)), headers, (_a = cfg.timeoutMs) !== null && _a !== void 0 ? _a : 2000);
        return classify(res.status, res.body, now() - t0);
    }
    catch (e) {
        const reason = e && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK';
        return { kind: 'fallback', reason, status: null, ms: now() - t0 };
    }
}
/**
 * Ask the director for a node. Never throws, never touches the SFS socket.
 * callbackFun (optional) is called exactly once with the same result object the promise resolves to
 * (also for NO_CONFIG / NO_GAME_TOKEN / TIMEOUT / NETWORK fallbacks); errors it throws are logged, not propagated.
 */
export async function matchNode(cfg, input, callbackFun) {
    const result = await requestMatch(cfg, input);
    if (typeof callbackFun === 'function') {
        try {
            callbackFun(result);
        }
        catch (e) {
            console.error('[lib-matching-client] callbackFun threw', e);
        }
    }
    return result;
}

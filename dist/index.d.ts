export interface MatchConfig {
    baseUrl: string;
    /** @deprecated v0.6.0: use baseUrl (listRooms now calls the director with X-Game-Token). Honoured for one more version only when baseUrl is absent: old public GET /v1/public/rooms, no auth. */
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
export type MatchResult = {
    kind: 'ok';
    node: MatchNode;
    ms: number;
    status?: number | null;
    raw?: any;
} | {
    kind: 'fallback';
    reason: string;
    status: number | null;
    ms: number;
    raw?: any;
} | {
    kind: 'blocked';
    reason: string;
    retryAfterMs: number | null;
    ms: number;
    status?: number | null;
    heldGame?: string;
    raw?: any;
};
/** Receives the full result once; the lobby uses it to connect on ok, or to decide on fallback/blocked. */
export type MatchCallback = (obj: MatchResult) => void;
export type MatchTransport = (url: string, body: string, headers: Record<string, string>, timeoutMs: number, 
/** v0.5.0: HTTP method, 'POST' (default) or 'GET' (listRooms; body is ''). */
method?: 'GET' | 'POST') => Promise<{
    status: number;
    body: any; /** v0.6.0: optional response headers (lower-case keys), used for Retry-After. */
    headers?: Record<string, string>;
}>;
export interface ListRoomsInput {
    game: string;
    /** v0.6.0 (required): player's game token, sent as X-Game-Token. Missing -> {ok:false, reason:'NO_GAME_TOKEN'}. Not needed in legacy roomApiUrl-only mode. */
    gameToken?: string;
    bucket?: string;
    /** v0.5.0: forwarded as `balance` query param (String(), omitted when undefined/null) for games whose list depends on the player's balance. */
    balance?: string | number;
}
/** Result of listRooms. data is the room API payload as-is (same shape the game's SFS list reply carries). */
export type ListRoomsResult = {
    ok: true;
    cmd: string;
    data: any;
} | {
    ok: false;
    reason: 'NOT_CONFIGURED' | 'NO_GAME_TOKEN' | 'UNAUTHORIZED' | 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'UNKNOWN_GAME' | string;
    status?: number | null;
    retryAfterMs?: number | null;
};
/** Ludo buckets only (kept for compatibility). Other games have their own buckets; the lib does not list them. */
export declare const LUDO_BUCKETS: readonly ["2P_6", "2P_56", "2P_246", "3P_6", "3P_56", "3P_246", "4P_6", "4P_56", "4P_246"];
/** @deprecated alias of LUDO_BUCKETS (Ludo only). */
export declare const BUCKETS: readonly ["2P_6", "2P_56", "2P_246", "3P_6", "3P_56", "3P_246", "4P_6", "4P_56", "4P_246"];
/** Syntax check only (no per-game list). */
export declare function isValidBucket(b: unknown): b is string;
/** Request body. gameToken is deliberately excluded (it goes in a header). */
export declare function buildMatchBody(input: MatchInput): Record<string, string>;
export declare function buildConfirmBody(input: ConfirmInput): Record<string, string>;
export declare function buildReleaseBody(input: ReleaseInput): Record<string, string>;
/** Map an HTTP status + parsed JSON to ok / fallback / blocked. */
export declare function classify(status: number, json: any, ms?: number): MatchResult;
/**
 * Ask the director for a node. Never throws, never touches the SFS socket.
 * callbackFun (optional) is called exactly once with the same result object the promise resolves to
 * (also for NO_CONFIG / NO_GAME_TOKEN / TIMEOUT / NETWORK fallbacks); errors it throws are logged, not propagated.
 */
export declare function matchNode(cfg: MatchConfig, input: MatchInput, callbackFun?: MatchCallback): Promise<MatchResult>;
/** Classify a confirm/release HTTP answer. */
export declare function classifyAction(status: number, json: any, ms?: number): ActionResult;
/**
 * Tell the director the player is really in `roomId` (POST /v1/confirm). Call after SFS login + join.
 * Never throws; callbackFun is called exactly once with the same object the promise resolves to.
 */
export declare function confirmRoom(cfg: MatchConfig, input: ConfirmInput, callbackFun?: ActionCallback): Promise<ActionResult>;
/**
 * Release the player's presence lease (POST /v1/release). Call when the player leaves the table / game ends.
 * Never throws; callbackFun is called exactly once with the same object the promise resolves to.
 */
export declare function releaseNode(cfg: MatchConfig, input: ReleaseInput, callbackFun?: ActionCallback): Promise<ActionResult>;
/**
 * v0.6.0: list rooms via the director: GET ${baseUrl}/v1/rooms?game=&bucket=&balance= with X-Game-Token. Never throws.
 * ok:true -> {cmd, data}. Otherwise {ok:false, reason, status?, retryAfterMs?}: NO_GAME_TOKEN (nothing sent),
 * UNAUTHORIZED (401/403), RATE_LIMITED (429, retryAfterMs from Retry-After), UNKNOWN_GAME, NETWORK, TIMEOUT, HTTP_<status>.
 * A malformed bucket is dropped, not sent.
 * Deprecated: with only cfg.roomApiUrl (no baseUrl) the old public GET /v1/public/rooms (no auth) is used; baseUrl wins if both set.
 */
export declare function listRooms(cfg: MatchConfig, input: ListRoomsInput): Promise<ListRoomsResult>;
/** Object wrapper over the functions above: `new MatchingClient({baseUrl, timeoutMs?, transport?})`. */
export declare class MatchingClient {
    readonly config: MatchConfig;
    constructor(config: MatchConfig);
    matchNode(input: MatchInput, cb?: MatchCallback): Promise<MatchResult>;
    confirmRoom(input: ConfirmInput, cb?: ActionCallback): Promise<ActionResult>;
    releaseNode(input: ReleaseInput, cb?: ActionCallback): Promise<ActionResult>;
    listRooms(input: ListRoomsInput): Promise<ListRoomsResult>;
}

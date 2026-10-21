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
export type MatchResult = {
    kind: 'ok';
    node: MatchNode;
    ms: number;
} | {
    kind: 'fallback';
    reason: string;
    status: number | null;
    ms: number;
} | {
    kind: 'blocked';
    reason: string;
    retryAfterMs: number | null;
    ms: number;
};
export type MatchTransport = (url: string, body: string, headers: Record<string, string>, timeoutMs: number) => Promise<{
    status: number;
    body: any;
}>;
export declare const BUCKETS: readonly ["2P_6", "2P_56", "2P_246", "3P_6", "3P_56", "3P_246", "4P_6", "4P_56", "4P_246"];
/** Request body. gameToken is deliberately excluded (it goes in a header). */
export declare function buildMatchBody(input: MatchInput): Record<string, string>;
/** Map an HTTP status + parsed JSON to ok / fallback / blocked. */
export declare function classify(status: number, json: any, ms?: number): MatchResult;
/** Ask the director for a node. Never throws. */
export declare function matchNode(cfg: MatchConfig, input: MatchInput, transport?: MatchTransport): Promise<MatchResult>;

// Try step 4 against a real director from the terminal (Node 18+), same code path the Cocos client uses (fetch instead of XHR).
// Secrets come from env (not argv, so they stay out of shell history / ps): MM_BASE_URL, MM_GAME_TOKEN.
// Usage: npm run build && node examples/try-match.mjs [--user-id 14246] --game ludo --login-name 14246 --bucket 2P_6
// Prints the request body and the result; the ticket is shown as its length only.
import { parseArgs } from 'node:util';
import { matchNode, buildMatchBody } from '../dist/index.js';

const { values: a } = parseArgs({ options: { 'user-id': { type: 'string' }, game: { type: 'string' }, 'login-name': { type: 'string' }, bucket: { type: 'string' }, timeout: { type: 'string' } } });
const missing = ['MM_BASE_URL', 'MM_GAME_TOKEN'].filter((k) => !process.env[k]).concat(['game'].filter((k) => !a[k]).map((k) => '--' + k));
if (missing.length) { console.error('missing: ' + missing.join(', ')); process.exit(2); }

const input = { userId: a['user-id'], game: a.game, loginName: a['login-name'] ?? a['user-id'] ?? '', bucket: a.bucket, gameToken: process.env.MM_GAME_TOKEN };
console.log('POST', process.env.MM_BASE_URL.replace(/\/+$/, '') + '/v1/match', JSON.stringify(buildMatchBody(input)), `+ X-Game-Token <len ${input.gameToken.length}>`);
matchNode({ baseUrl: process.env.MM_BASE_URL, timeoutMs: Number(a.timeout) || 2000 }, input, (r) => {
  const shown = r.kind === 'ok' ? { ...r, node: { ...r.node, ticket: `<len ${String(r.node.ticket ?? '').length}>` } } : r;
  console.log(JSON.stringify(shown, null, 2));
  if (r.kind === 'ok') console.log(`=> connect ${r.node.ssl ? 'wss' : 'ws'}://${r.node.host}:${r.node.port} zone=${r.node.zone} bucket=${r.node.bucket} login=${input.loginName}${r.node.roomId ? ` roomId=${r.node.roomId}` : ''} + mmTicket`);
  process.exitCode = r.kind === 'ok' ? 0 : 3;
});

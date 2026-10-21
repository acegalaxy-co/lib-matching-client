# @acegalaxy/lib-matching-client

## Giới thiệu

Client TypeScript không phụ thuộc thư viện nào cho **bước 4** của luồng vào game: hỏi *matching director* xem nên kết nối tới node SFS nào **trước khi mở socket SFS**. Chạy được trong Cocos Creator 3.8 (web + Android/iOS native) và Node 18+. Lib **chỉ tìm server phù hợp, không mở/không can thiệp socket SFS** — lobby tự connect từ kết quả (`obj`) nhận được trong callback. Lib cũng gọi `confirm` / `release` của director (báo presence), nhưng **không bao giờ connect/login SFS, không chọn ws/tcp** — caller tự làm.

## Cài đặt

Ở thư mục gốc project Cocos Creator 3.8:

```bash
npm install github:acegalaxy-co/lib-matching-client#v0.4.0
```

```ts
import { matchNode } from '@acegalaxy/lib-matching-client';
```

Cocos Creator 3.8 đọc package npm từ `node_modules`.

Nếu project không dùng npm: copy `src/index.ts` vào `assets/scripts/` rồi import tương đối (vd `import { matchNode } from './index';`).

## Ví dụ

```ts
import { matchNode, MatchResult } from '@acegalaxy/lib-matching-client';

const cfg = { baseUrl: ENV.MM_BASE_URL }; // từ config build

// Ludo
matchNode(cfg, {
  game: 'ludo',
  gameToken,
  loginName: String(user.id),
  bucket: '2P_6',
}, onMatched);
// Fish: { game: 'fish', gameToken, loginName: user.displayName }

function onMatched(obj: MatchResult) {
  switch (obj.kind) {
    case 'ok':
      // Lobby tự connect: ssl -> wss
      connectSfs({ host: obj.node.host, port: obj.node.port, useSSL: obj.node.ssl });
      // LoginRequest: zone = obj.node.zone, param mmTicket = obj.node.ticket
      // Ludo: gửi kèm bucket + roomId (nếu có) -> server tự join phòng, trả 1 response room.join
      login(obj.node.zone, loginName, {
        mmTicket: obj.node.ticket,
        bucket: obj.node.bucket,
        ...(obj.node.roomId ? { roomId: obj.node.roomId } : {}),
      });
      break;
    case 'fallback':
      connectSfs(STATIC_HOST); // như hiện tại
      break;
    case 'blocked':
      if (obj.reason === 'PRESENCE_OTHER_GAME') showMsg('Bạn đang ở trong một ván khác');
      else setTimeout(retry, obj.retryAfterMs ?? 30000); // PRESENCE_LOCKED: chờ rồi gọi lại
      // KHÔNG vào game
      break;
  }
}
```

`await matchNode(cfg, input)` vẫn dùng được (trả về đúng object đó); callback được gọi đúng 1 lần với cùng object.

## Luồng đầy đủ (bot Node và client Cocos dùng chung)

1. `matchNode(cfg, {game, gameToken, loginName, bucket?})` -> `ok` + `node`.
2. Caller tự connect + login SFS (host/port/ssl/zone/ticket từ `node`, kèm `bucket`/`roomId`).
3. Vào bàn thật -> `confirmRoom(cfg, {game, roomId, gameToken})` với roomId thật.
4. Chơi xong / rời bàn -> `releaseNode(cfg, {game, gameToken})`.
Lần chơi sau gọi lại `matchNode`.

```ts
import { matchNode, confirmRoom, releaseNode } from '@acegalaxy/lib-matching-client';

const r = await matchNode(cfg, { game: 'dominoqq', gameToken, loginName: name, bucket: '3' });
if (r.kind === 'ok') {
  await myConnectAndLoginSfs(r.node);              // việc của caller, không phải của lib
  await confirmRoom(cfg, { game: 'dominoqq', roomId, gameToken });
  /* ...chơi... */
  await releaseNode(cfg, { game: 'dominoqq', gameToken });
}
```

Bot Node (`.mjs`, Node 18+, dùng fetch mặc định):

```js
import { matchNode, confirmRoom, releaseNode } from '@acegalaxy/lib-matching-client';
const cfg = { baseUrl: process.env.MM_BASE_URL, timeoutMs: 2000 };
const m = await matchNode(cfg, { game, gameToken, loginName, bucket });
// log: m.node.nodeId, label, reused, leaseNode, ticket (độ dài), roomId, bucket, m.ms
```

### Kết quả `matchNode` -> hành vi bot gợi ý

| Kết quả lib | Bot (matchmaker cũ) | Hành vi gợi ý |
|---|---|---|
| `kind:'ok'` | `ok` | Connect `node.host:port` (ssl, zone, ticket), log `nodeId/label/reused/leaseNode/bucket/roomId/ms` |
| `kind:'blocked'` (`PRESENCE_LOCKED` / `PRESENCE_OTHER_GAME`) | `skip` | Chờ rồi thử lại: `retryMs = clamp(retryAfterMs ?? 30000, 1000, 120000)`; log `reason`, `heldGame` |
| `kind:'fallback'`, `reason:'UNKNOWN_GAME'` | `unserved` | Director không phục vụ game: bot chạy kiểu thường, nhớ một thời gian |
| `kind:'fallback'`, `reason` ∈ `UNAUTHORIZED` / `USER_MISMATCH` (`status` 401/403) | `fail` ("auth") | Fail closed, cảnh báo 1 lần |
| `kind:'fallback'`, khác (`NO_NODE`, `AUTH_UNAVAILABLE`, `HTTP_5xx`, `BAD_RESPONSE`, `TIMEOUT`, `NETWORK`, `NO_GAME_TOKEN`, `NO_CONFIG`...) | `fail` | Fail closed + backoff; `reason`/`status`/`raw` để log |

(Client Cocos thì `fallback` = dùng host tĩnh, xem bảng reason dưới.) Mọi kết quả có `ms`; `raw` là body director (không chứa token).

### `confirmRoom` / `releaseNode`

```ts
confirmRoom(cfg: MatchConfig, input: { userId?: string|number; game: string; roomId: string|number; gameToken: string }, cb?: (r: ActionResult) => void): Promise<ActionResult>
releaseNode(cfg: MatchConfig, input: { userId?: string|number; game: string; gameToken: string }, cb?: (r: ActionResult) => void): Promise<ActionResult>
// ActionResult = { kind: 'ok' | 'fail'; status: number | null; reason?: string; ms: number; raw?: any }
```

| Tình huống | kind | status | reason |
|---|---|---|---|
| HTTP < 400 và body `ok !== false` | `ok` | HTTP status | - |
| 200 `{ok:false,reason:'NO_RESERVATION'}` (confirm khi chưa có lease) | `fail` | 200 | `NO_RESERVATION` |
| 401 / 403 / 503 | `fail` | 401 / 403 / 503 | `UNAUTHORIZED` / `USER_MISMATCH` / `AUTH_UNAVAILABLE` |
| HTTP lỗi khác, không có reason | `fail` | status | `HTTP_<status>` |
| Thiếu `gameToken` / `roomId` (confirm) / `baseUrl` | `fail` | null | `NO_GAME_TOKEN` / `NO_ROOM_ID` / `NO_CONFIG` (không gọi mạng) |
| Timeout / lỗi mạng | `fail` | null | `TIMEOUT` / `NETWORK` |

Cả hai không throw, callback (nếu có) gọi đúng 1 lần với cùng object promise trả về. Best effort: caller thường chỉ log lỗi.

## Input

| Field | Ý nghĩa |
|---|---|
| `userId` | Tuỳ chọn. Server lấy userId từ game token; nếu truyền thì gửi dạng string và phải khớp token (không khớp -> `USER_MISMATCH`) |
| `gameToken` | `game_token` từ `GET /api/internal-game/game-token`; gửi ở header `X-Game-Token`, không nằm trong body. Đây là cách xác thực DUY NHẤT (không có client token / header `Authorization`) |
| `game` | `ludo`, `billiard`, `holdem`, `rummy`, `chess`, `dominoqq`, `dominobet`, `dominowild`, `gaple`, `fish` (là `fish`, không phải `fishshooting`) |
| `loginName` | Đúng username dùng trong SFS `LoginRequest`: `ludo`/`billiard`/`holdem`/`rummy` = userId; `chess`/`dominoqq`/`dominobet`/`dominowild`/`gaple`/`fish` = display name |
| `bucket` | Loại bàn, mọi game có thể có bucket riêng (Ludo `2P_6`, dominoqq `"1".."18"`, gaple `"1".."6"`, chess `rapid10:r`...). Lib KHÔNG kiểm theo danh sách game (director quyết, sai -> `UNKNOWN_BUCKET`); chỉ kiểm cú pháp 1-32 ký tự `[A-Za-z0-9_:.-]`, sai cú pháp thì **không gửi** bucket (không lỗi). `LUDO_BUCKETS` (alias `BUCKETS`) chỉ là danh sách của Ludo. Game không dùng bucket nhận lại `"*"` |

## Response (`r.node`)

| Field | Ý nghĩa |
|---|---|
| `host`, `port`, `ssl` | Địa chỉ kết nối (`ssl` true -> wss) |
| `zone` | Zone dùng khi login SFS |
| `bucket` | Bucket được gán (`"*"` nếu game không có bucket) |
| `ticket` | Hiệu lực 30s; truyền vào `LoginRequest` param `mmTicket` |
| `reused` | `true` nếu trả lại đúng node cũ (reconnect) |
| `roomId` | Tuỳ chọn (Ludo): phòng director chọn; truyền vào param `roomId` của `LoginRequest` để server tự join. Không có -> server tự xếp theo `bucket` |
| `nodeId`, `label`, `serverBase`, `leaseNode` | Chỉ để log/debug |

Ngoài `node`, kết quả `ok` còn có `ms`, `status`, `raw`; `blocked` có `reason`, `retryAfterMs`, `heldGame?`, `status`, `raw`.

## reason -> kind

| Reason | kind | Xử lý |
|---|---|---|
| (thành công) | `ok` | Kết nối theo `r.node` |
| `PRESENCE_OTHER_GAME` | `blocked` | Không vào; báo "Bạn đang ở trong một ván khác" |
| `PRESENCE_LOCKED` | `blocked` | Chờ `retryAfterMs` (mặc định 30000) rồi gọi lại |
| `NO_NODE`, `UNKNOWN_GAME`, `UNKNOWN_BUCKET`, `BAD_REQUEST`, `BAD_USER_ID`, `UNAUTHORIZED` (401), `USER_MISMATCH` (403, `userId` không khớp token), `AUTH_UNAVAILABLE` (503, hệ thống xác thực lỗi), `HTTP_5xx`, `BAD_RESPONSE` | `fallback` | Dùng host tĩnh như hiện tại |
| `TIMEOUT`, `NETWORK`, `NO_CONFIG`, `NO_GAME_TOKEN` (thiếu `gameToken`, không gọi mạng) | `fallback` | Dùng host tĩnh như hiện tại |

## Lưu ý

- `baseUrl` lấy từ config môi trường của build, không hard-code. Xác thực chỉ bằng game token (`X-Game-Token`); userId do server lấy từ token.
- Timeout mặc định 2 giây (`timeoutMs`); hết giờ -> `fallback`/`TIMEOUT`. `matchNode` không bao giờ throw; callback ném lỗi chỉ bị log (`console.error`).
- `cfg.transport` (tuỳ chọn) thay transport HTTP mặc định, dùng cho test hoặc stack riêng.
- Gọi trước **mỗi** lần connect SFS, kể cả reconnect (`reused: true` trả lại đúng node cũ).
- Bản web build gọi được (director đã bật CORS).
- Không log token, `game_token`, `ticket`.

## Request/response thô

```http
POST https://mm.example.com/v1/match
Content-Type: application/json
X-Game-Token: <game-token>

{"game":"ludo","loginName":"14246","bucket":"2P_6"}
```

```json
{
  "ok": true,
  "nodeId": 2000,
  "host": "game.example.com",
  "port": 443,
  "ssl": true,
  "zone": "ludo",
  "bucket": "2P_6",
  "ticket": "<ticket>",
  "reused": false
}
```

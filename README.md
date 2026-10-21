# @acegalaxy/lib-matching-client

## Giới thiệu

Client TypeScript không phụ thuộc thư viện nào cho **bước 4** của luồng vào game: hỏi *matching director* xem nên kết nối tới node SFS nào **trước khi mở socket SFS**. Chạy được trong Cocos Creator 3.8 (web + Android/iOS native) và Node 18+. Việc confirm/release nằm ngoài phạm vi lib này.

## Cài đặt

Ở thư mục gốc project Cocos Creator 3.8:

```bash
npm install github:acegalaxy-co/lib-matching-client#v0.2.0
```

```ts
import { matchNode } from '@acegalaxy/lib-matching-client';
```

Cocos Creator 3.8 đọc package npm từ `node_modules`.

Nếu project không dùng npm: copy `src/index.ts` vào `assets/scripts/` rồi import tương đối (vd `import { matchNode } from './index';`).

## Ví dụ

```ts
import { matchNode } from '@acegalaxy/lib-matching-client';

const cfg = { baseUrl: ENV.MM_BASE_URL }; // từ config build

// Ludo
const r = await matchNode(cfg, {
  game: 'ludo',
  gameToken,
  loginName: String(user.id),
  bucket: '2P_6',
});
// Fish: { game: 'fish', gameToken, loginName: user.displayName }

switch (r.kind) {
  case 'ok':
    // ssl -> wss
    connectSfs({ host: r.node.host, port: r.node.port, useSSL: r.node.ssl });
    // LoginRequest: zone = r.node.zone, param mmTicket = r.node.ticket
    login(r.node.zone, loginName, { mmTicket: r.node.ticket });
    break;
  case 'fallback':
    connectSfs(STATIC_HOST); // như hiện tại
    break;
  case 'blocked':
    if (r.reason === 'PRESENCE_OTHER_GAME') showMsg('Bạn đang ở trong một ván khác');
    else setTimeout(retry, r.retryAfterMs ?? 30000); // PRESENCE_LOCKED: chờ rồi gọi lại
    // KHÔNG vào game
    break;
}
```

## Input

| Field | Ý nghĩa |
|---|---|
| `userId` | Tuỳ chọn. Server lấy userId từ game token; nếu truyền thì gửi dạng string và phải khớp token (không khớp -> `USER_MISMATCH`) |
| `gameToken` | `game_token` từ `GET /api/internal-game/game-token`; gửi ở header `X-Game-Token`, không nằm trong body. Đây là cách xác thực DUY NHẤT (không có client token / header `Authorization`) |
| `game` | `ludo`, `billiard`, `holdem`, `rummy`, `chess`, `dominoqq`, `dominobet`, `dominowild`, `gaple`, `fish` (là `fish`, không phải `fishshooting`) |
| `loginName` | Đúng username dùng trong SFS `LoginRequest`: `ludo`/`billiard`/`holdem`/`rummy` = userId; `chess`/`dominoqq`/`dominobet`/`dominowild`/`gaple`/`fish` = display name |
| `bucket` | **Chỉ Ludo**: loại bàn = số người × luật ra chuồng (vd `2P_6` = 2 người, ra chuồng khi đổ 6), KHÔNG phải mức cược. Giá trị: `BUCKETS`. Game khác bỏ qua, nhận lại `"*"` |

## Response (`r.node`)

| Field | Ý nghĩa |
|---|---|
| `host`, `port`, `ssl` | Địa chỉ kết nối (`ssl` true -> wss) |
| `zone` | Zone dùng khi login SFS |
| `bucket` | Bucket được gán (`"*"` nếu game không có bucket) |
| `ticket` | Hiệu lực 30s; truyền vào `LoginRequest` param `mmTicket` |
| `reused` | `true` nếu trả lại đúng node cũ (reconnect) |
| `nodeId`, `label`, `serverBase`, `leaseNode` | Chỉ để log/debug |

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
- Timeout mặc định 2 giây (`timeoutMs`); hết giờ -> `fallback`/`TIMEOUT`. `matchNode` không bao giờ throw.
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

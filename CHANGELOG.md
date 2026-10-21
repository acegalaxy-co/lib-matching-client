# Changelog

## 0.5.0

- Mới (additive, tương thích ngược): `listRooms(cfg, {game, bucket?, balance?})` -> `{ok:true, cmd, data}` | `{ok:false, reason}` (GET `${roomApiUrl}/v1/public/rooms?game=&bucket=`, không header auth). reason: `NOT_CONFIGURED` (thiếu `roomApiUrl`), `NETWORK`, `TIMEOUT`, `RATE_LIMITED` (429), `UNKNOWN_GAME`, `HTTP_<status>`. Không throw.
- `MatchConfig.roomApiUrl?`; class `MatchingClient` bọc các hàm (`new MatchingClient({baseUrl, roomApiUrl?})`).
- `matchNode` nhận `roomId?`, `nodeId?` (chỉ gửi trong body /v1/match khi có). 409 `ROOM_UNAVAILABLE` và 400 `ROOM_NODE_REQUIRED` trả `fallback` với `reason` tương ứng như các reason director khác.
- `MatchTransport` thêm tham số thứ 5 tuỳ chọn `method` ('GET' | 'POST'); transport tự viết cần xử lý 'GET' cho `listRooms`.

## 0.4.0

- Mới: `confirmRoom(cfg, {userId?, game, roomId, gameToken}, cb?)` (POST /v1/confirm) và `releaseNode(cfg, {userId?, game, gameToken}, cb?)` (POST /v1/release). Không throw; callback đúng 1 lần với cùng object promise trả về; kết quả `ActionResult {kind:'ok'|'fail', status, reason?, ms, raw?}`. Thiếu `gameToken` -> `fail`/`NO_GAME_TOKEN`, thiếu `roomId` -> `NO_ROOM_ID`, thiếu `baseUrl` -> `NO_CONFIG` (đều không gọi mạng); timeout/lỗi mạng -> `TIMEOUT`/`NETWORK`.
- Bucket dùng cho mọi game (dominoqq "1".."18", gaple "1".."6", chess "rapid10:r"...). Lib không kiểm theo danh sách game, chỉ kiểm cú pháp `[A-Za-z0-9_:.-]{1,32}`; bucket sai cú pháp KHÔNG được gửi. Thêm `isValidBucket`, `LUDO_BUCKETS`; `BUCKETS` giữ làm alias (chỉ Ludo).
- `MatchResult` thêm field (không đổi nghĩa field cũ): `raw` (body director) trên mọi kind, `status` trên ok/blocked, `heldGame` trên blocked.
- `blocked` / `PRESENCE_OTHER_GAME|PRESENCE_LOCKED` vẫn như cũ (`retryAfterMs` null / mặc định 30000).
- Thêm `classifyAction`, `buildConfirmBody`, `buildReleaseBody`.

## 0.3.0

- BREAKING: `matchNode(cfg, input, callbackFun?)` — tham số thứ 3 giờ là callback; `transport` chuyển vào `cfg.transport`.
- `callbackFun(obj)` được gọi đúng 1 lần với kết quả đầy đủ (cùng object với giá trị promise trả về, kể cả các fallback `NO_CONFIG` / `NO_GAME_TOKEN` / `TIMEOUT` / `NETWORK`); lỗi trong callback chỉ được log, không throw.
- Lib chỉ tìm server phù hợp, không mở/không can thiệp socket SFS — lobby tự connect từ kết quả.
- `node.roomId` tuỳ chọn: director có thể trả `roomId` (vd Ludo) để lobby vào thẳng phòng sau khi login.

## 0.2.0

- BREAKING: bỏ `clientToken` khỏi `MatchConfig` (chỉ còn `baseUrl`, `timeoutMs`); không gửi header `Authorization`. Director chỉ xác thực bằng `X-Game-Token`.
- `MatchInput.userId` thành tuỳ chọn (director lấy userId từ token); body chỉ có `userId` khi truyền vào.
- Thiếu `gameToken` -> `fallback`/`NO_GAME_TOKEN`, không gọi mạng.
- HTTP 5xx giữ `reason` từ body nếu có (vd `AUTH_UNAVAILABLE`), không thì `HTTP_<status>`.

## 0.1.0

- Bản đầu: `matchNode`, `classify`, `buildMatchBody`, `BUCKETS`.
- Transport chọn lúc gọi: `XMLHttpRequest` (Cocos web + native) hoặc `fetch` (Node 18+).
- Kết quả phân loại `ok` / `fallback` / `blocked`; `matchNode` không bao giờ throw.

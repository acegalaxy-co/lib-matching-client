# Changelog

## 0.2.0

- BREAKING: bỏ `clientToken` khỏi `MatchConfig` (chỉ còn `baseUrl`, `timeoutMs`); không gửi header `Authorization`. Director chỉ xác thực bằng `X-Game-Token`.
- `MatchInput.userId` thành tuỳ chọn (director lấy userId từ token); body chỉ có `userId` khi truyền vào.
- Thiếu `gameToken` -> `fallback`/`NO_GAME_TOKEN`, không gọi mạng.
- HTTP 5xx giữ `reason` từ body nếu có (vd `AUTH_UNAVAILABLE`), không thì `HTTP_<status>`.

## 0.1.0

- Bản đầu: `matchNode`, `classify`, `buildMatchBody`, `BUCKETS`.
- Transport chọn lúc gọi: `XMLHttpRequest` (Cocos web + native) hoặc `fetch` (Node 18+).
- Kết quả phân loại `ok` / `fallback` / `blocked`; `matchNode` không bao giờ throw.

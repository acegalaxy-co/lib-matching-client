# Changelog

## 0.1.0

- Bản đầu: `matchNode`, `classify`, `buildMatchBody`, `BUCKETS`.
- Transport chọn lúc gọi: `XMLHttpRequest` (Cocos web + native) hoặc `fetch` (Node 18+).
- Kết quả phân loại `ok` / `fallback` / `blocked`; `matchNode` không bao giờ throw.

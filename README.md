# Trend Radar

App xem trend TikTok (Việt Nam, Mỹ) trên iPhone. Mỗi ngày lúc 8h sáng GitHub tự lấy dữ liệu từ
TikTok Creative Center, so với hôm qua, cập nhật app và gửi thông báo qua ntfy.

- `scraper/fetch_trends.py`: lấy hashtag + video trend, phân tích, ghi `docs/data/latest.json`
- `docs/`: web app (mở bằng Safari → Chia sẻ → Thêm vào MH chính)
- `data/snapshots/`: dữ liệu từng ngày để so sánh
- `config.json`: quốc gia, số lượng, kênh thông báo ntfy
- `.github/workflows/daily.yml`: lịch chạy 8h sáng

Secret cần có trên GitHub: `TIKTOK_COOKIE` (cookie đăng nhập ads.tiktok.com). Thiếu hoặc hết hạn thì
chỉ lấy được top 3 và app sẽ hiện cảnh báo.

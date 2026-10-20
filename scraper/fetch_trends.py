"""Lấy trend TikTok mỗi ngày từ TikTok Creative Center, so với hôm qua, ghi ra JSON cho web app.

Chạy:  python scraper/fetch_trends.py
Biến môi trường:
  TIKTOK_COOKIE  chuỗi Cookie của tài khoản TikTok for Business (thiếu thì chỉ lấy được top 3-4)
  NTFY_TOPIC     tên kênh ntfy để gửi thông báo (thiếu thì không gửi)
  APP_URL        link web app, gắn vào thông báo
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAP_DIR = ROOT / "data" / "snapshots"
OUT_DIR = ROOT / "docs" / "data"
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))

BASE = "https://ads.tiktok.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
VN_TZ = dt.timezone(dt.timedelta(hours=7))


# ---------------------------------------------------------------- HTTP

class Client:
    def __init__(self, cookie: str):
        self.cookie = cookie.strip()
        m = re.search(r"csrftoken=([^;\s]+)", self.cookie)
        self.csrf = m.group(1) if m else ""

    def request(self, path, body=None, retries=3):
        headers = {
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Agw-Js-Conv": "str",
            "Referer": f"{BASE}/creative/creativeCenter/trends/hashtag",
        }
        if self.cookie:
            headers["Cookie"] = self.cookie
        if self.csrf:
            headers["X-CSRFToken"] = self.csrf
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        for attempt in range(retries):
            try:
                req = urllib.request.Request(BASE + path, data=data, headers=headers)
                with urllib.request.urlopen(req, timeout=30) as resp:
                    j = json.loads(resp.read().decode("utf-8"))
                code = (j.get("BaseResp") or {}).get("StatusCode", 0)
                if code != 0:
                    raise RuntimeError(f"TikTok trả lỗi {code}: {j.get('BaseResp')}")
                return j
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                if attempt == retries - 1:
                    raise
                print(f"  thử lại {path}: {e}")
                time.sleep(3 * (attempt + 1))


def fetch_hashtags(c: Client, country: str, limit: int):
    items, page = [], 1
    while len(items) < limit:
        j = c.request("/CreativeOne/KnowledgeAPI/GetHashtagList",
                      {"timeRange": 7, "countryCode": country, "page": page, "limit": 50})
        batch = j.get("items") or []
        items += batch
        if not batch or not (j.get("pagination") or {}).get("hasMore"):
            break
        page += 1
        time.sleep(1)
    out = []
    for rank, it in enumerate(items[:limit], 1):  # tự đánh số: rankIndex của TikTok có lúc nhảy cóc
        out.append({
            "id": it.get("hashtagID"),
            "name": it.get("hashtagName"),
            "rank": rank,
            "posts": int(it.get("publishCnt") or 0),
            "views": int(it.get("vv") or 0),
            "curve": [round(float(p.get("value") or 0), 1) for p in it.get("popularityCurve") or []],
            "creators": [
                {"handle": cr.get("handleName"), "name": cr.get("nickname"),
                 "followers": int(cr.get("followedCnt") or 0)}
                for cr in (it.get("topCreators") or [])[:3]
            ],
        })
    return out


def fetch_hashtag_videos(c: Client, country: str, tag_id: str):
    """10 video tiêu biểu của một hashtag (trang chi tiết hashtag trên Creative Center)."""
    j = c.request("/CreativeOne/KnowledgeAPI/GetHashtagDetail",
                  {"hashtagID": tag_id, "countryCode": country, "timeRange": 7})
    return [{"id": v.get("itemID"), "cover": v.get("coverURL")}
            for v in j.get("videoList") or [] if v.get("itemID")]


def fetch_videos(c: Client, country: str, limit: int, organic_only: bool):
    ov = c.request("/CreativeOne/Report/GetTopContentsOverview")
    end_ts = ov.get("lastWeeklyEndTimestamp") or ov.get("lastDailyEndTimestamp")
    items, page = [], 1
    seen = set()
    while len(items) < limit:
        q = urllib.parse.urlencode({
            "contentLabelIDs": "", "countryCode": country, "limit": 50,
            "orderByMetric": 1, "organicOnly": str(organic_only).lower(), "page": page,
            "periodDimension": 3, "periodEndTimestamp": end_ts,
        })
        j = c.request(f"/CreativeOne/Report/CreativeCenterGetTopContentsList?{q}")
        batch = [e for e in (j.get("entityInfos") or [])
                 if e["itemInfo"]["itemID"] not in seen]
        if not batch:  # chưa đăng nhập thì trang nào cũng trả lại cùng vài video
            break
        for e in batch:
            seen.add(e["itemInfo"]["itemID"])
        items += batch
        if not (j.get("pagination") or {}).get("hasMore"):
            break
        page += 1
        time.sleep(1)
    out = []
    for rank, e in enumerate(items[:limit], 1):
        info, m = e.get("itemInfo") or {}, e.get("itemMetrics") or {}
        author = e.get("itemAuthorInfo") or {}
        out.append({
            "id": info.get("itemID"),
            "rank": rank,
            "title": (info.get("title") or "").strip(),
            "cover": info.get("coverURL"),
            "created": int(info.get("createTime") or 0),
            "author": author.get("handlerName"),
            "authorName": author.get("nickName"),
            "avatar": author.get("avatarURI"),
            "followers": int((e.get("itemAuthorMetrics") or {}).get("followers") or 0),
            "category": ", ".join(t.get("contentLabelName", "") for t in e.get("contentTags") or []),
            "views": int(m.get("videoViews") or 0),
            "viewsLifetime": int(m.get("videoViewsLifeTime") or 0),
            "organicViews": int(m.get("organicVideoViews") or 0),
            "engagement": round(float(m.get("engagementRate") or 0), 4),
            "vtr6s": round(float(m.get("sixSecondsVTR") or 0), 4),
        })
    return out


# ---------------------------------------------------------------- Phân tích

def fmt(n):
    n = float(n)
    for div, suf in ((1e9, " tỷ"), (1e6, "M"), (1e3, "K")):
        if abs(n) >= div:
            return f"{n / div:.1f}".rstrip("0").rstrip(".") + suf
    return f"{int(n)}"


def curve_phase(curve):
    """Đọc đường độ hot 7 ngày (0-100) → trạng thái trend."""
    if len(curve) < 3:
        return "unknown", ""
    last, prev, peak = curve[-1], curve[-2], max(curve)
    peak_day = curve.index(peak)
    jump = max(curve[i + 1] - curve[i] for i in range(len(curve) - 1))
    if last >= 99 or (last > prev + 5 and last >= 60):
        phase, text = "rising", "Đang lên mạnh, độ hot cao nhất là hôm qua"
    elif last >= 60:
        phase, text = "peak", f"Đang ở gần đỉnh ({last:.0f}% so với đỉnh)"
    elif last >= 25:
        phase, text = "cooling", f"Bắt đầu hạ nhiệt, còn {last:.0f}% so với đỉnh"
    else:
        phase, text = "fading", f"Đã qua đỉnh, chỉ còn {last:.0f}% độ hot"
    if jump >= 50 and curve[0] <= 10:
        text += f". Bùng nổ đột ngột: tăng {jump:.0f} điểm chỉ trong 1 ngày"
    elif peak_day >= len(curve) - 2 and phase == "rising":
        text += ". Còn đang leo, nên bắt trend ngay"
    return phase, text


def analyze_hashtags(today, yesterday):
    prev = {h["name"]: h for h in yesterday or []}
    for h in today:
        reasons = []
        phase, ptext = curve_phase(h["curve"])
        h["phase"] = phase
        if ptext:
            reasons.append(ptext)
        p = prev.get(h["name"])
        if yesterday is None:
            h["change"] = None
        elif p is None:
            h["change"] = "new"
            reasons.insert(0, "Mới lọt vào top hôm nay")
        else:
            diff = p["rank"] - h["rank"]
            h["change"] = diff
            if diff >= 5:
                reasons.insert(0, f"Tăng {diff} hạng so với hôm qua")
            grow = h["posts"] - p["posts"]
            if p["posts"] and grow > 0:
                reasons.append(f"+{fmt(grow)} video mới dùng hashtag trong 1 ngày "
                               f"(+{grow / p['posts'] * 100:.0f}%)")
            vgrow = h["views"] - p["views"]
            if p["views"] and vgrow > 0:
                reasons.append(f"+{fmt(vgrow)} lượt xem trong 1 ngày")
        if h["posts"]:
            vpp = h["views"] / h["posts"]
            reasons.append(f"Trung bình {fmt(vpp)} lượt xem mỗi video")
            if vpp >= 10000:
                reasons.append("Ít người làm nhưng lượt xem cao, dễ ăn view nếu làm sớm")
        c = h["curve"]
        h["momentum"] = round(c[-1] - c[-4], 1) if len(c) >= 4 else 0
        score = h["momentum"]
        if h.get("change") == "new":
            score += 30
        elif isinstance(h.get("change"), int) and h["change"] > 0:
            score += h["change"] * 2
        if p and p["posts"] and h["posts"] > p["posts"]:
            h["postsGrowth"] = round((h["posts"] - p["posts"]) / p["posts"] * 100, 1)
            score += min(h["postsGrowth"], 100) / 2
        h["score"] = round(score, 1)
        if h["momentum"] >= 20:
            reasons.insert(1 if reasons else 0, f"Độ hot tăng {h['momentum']:.0f} điểm trong 3 ngày gần nhất")
        h["reasons"] = reasons
    return today


def analyze_videos(today, yesterday, hashtags, now):
    prev = {v["id"]: v for v in yesterday or []}
    trending_tags = {h["name"].lower() for h in hashtags}
    for v in today:
        reasons = []
        p = prev.get(v["id"])
        if yesterday is None:
            v["change"] = None
        elif p is None:
            v["change"] = "new"
            reasons.append("Mới vào top hôm nay")
        else:
            v["change"] = p["rank"] - v["rank"]
        age_days = max(0, (now - v["created"]) / 86400) if v["created"] else None
        if age_days is not None:
            v["ageDays"] = round(age_days, 1)
        if v["followers"] and v["views"]:
            ratio = v["views"] / v["followers"]
            if ratio >= 10:
                reasons.append(f"Lượt xem gấp {ratio:.0f} lần số follower: TikTok đang đẩy video "
                               "cho người lạ, không phải nhờ fan")
        if v["viewsLifetime"]:
            share = v["views"] / v["viewsLifetime"]
            if share >= 0.9 and age_days is not None and age_days <= 10:
                reasons.append(f"Video mới ({age_days:.0f} ngày), gần như toàn bộ "
                               f"{fmt(v['views'])} lượt xem đến trong 7 ngày qua")
            elif age_days is not None and age_days > 30 and share >= 0.3:
                reasons.append(f"Video cũ ({age_days:.0f} ngày) đang được 'hồi sinh': "
                               f"{share * 100:.0f}% lượt xem đến trong tuần này")
        if v["vtr6s"]:
            reasons.append(f"{v['vtr6s'] * 100:.0f}% người xem coi quá 6 giây"
                           + (": mở đầu rất cuốn" if v["vtr6s"] >= 0.4 else ""))
        if v["engagement"]:
            reasons.append(f"Tỉ lệ tương tác (thích, bình luận, chia sẻ) {v['engagement'] * 100:.1f}%"
                           + (": rất cao" if v["engagement"] >= 0.08 else ""))
        tags = [t.lower() for t in re.findall(r"#(\w+)", v["title"])]
        hit = [t for t in tags if t in trending_tags]
        if hit:
            reasons.append("Dùng hashtag đang trend: " + ", ".join("#" + t for t in hit))
        v["tags"] = tags
        v["reasons"] = reasons
    return today


def summarize(region):
    """Tóm tắt thay đổi chính để hiện đầu app và gửi thông báo."""
    new_tags = [h["name"] for h in region["hashtags"] if h.get("change") == "new"]
    jumps = sorted((h for h in region["hashtags"] if isinstance(h.get("change"), int) and h["change"] >= 5),
                   key=lambda h: -h["change"])
    rising = [h["name"] for h in region["hashtags"] if h.get("phase") == "rising"]
    new_videos = [v for v in region["videos"] if v.get("change") == "new"]
    # Trend tăng nhanh: hashtag có điểm đà tăng cao nhất (cần có video để xem)
    hot = sorted((h for h in region["hashtags"] if h["score"] > 0 and h.get("videos")),
                 key=lambda h: -h["score"])
    return {
        "newHashtags": new_tags[:10],
        "jumpHashtags": [{"name": h["name"], "by": h["change"]} for h in jumps[:10]],
        "risingHashtags": rising[:10],
        "newVideos": len(new_videos),
        "hotTrends": [h["name"] for h in hot[:12]],
    }


# ---------------------------------------------------------------- Lưu + thông báo

def load_previous(today_str):
    files = sorted(p for p in SNAP_DIR.glob("*.json") if p.stem < today_str)
    if not files:
        return None
    return json.loads(files[-1].read_text(encoding="utf-8"))


def notify(topic, title, message, click):
    req = urllib.request.Request(
        f"https://ntfy.sh/{topic}", data=message.encode("utf-8"),
        headers={"Title": title.encode("utf-8"), "Click": click, "Tags": "fire"} if click
        else {"Title": title.encode("utf-8"), "Tags": "fire"})
    try:
        urllib.request.urlopen(req, timeout=20).read()
        print("Đã gửi thông báo ntfy")
    except Exception as e:
        print("Gửi thông báo thất bại:", e)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cookie = os.environ.get("TIKTOK_COOKIE", "")
    topic = os.environ.get("NTFY_TOPIC") or CONFIG.get("ntfy_topic", "")
    app_url = os.environ.get("APP_URL") or CONFIG.get("app_url", "")
    client = Client(cookie)
    now = time.time()
    today_str = dt.datetime.now(VN_TZ).strftime("%Y-%m-%d")

    prev_snap = load_previous(today_str)
    snapshot = {"date": today_str, "generatedAt": int(now), "regions": {}}
    warnings = []
    for reg in CONFIG["regions"]:
        code = reg["code"]
        print(f"[{code}] lấy hashtag...")
        tags = fetch_hashtags(client, code, CONFIG["hashtag_limit"])
        print(f"[{code}] {len(tags)} hashtag. Lấy video...")
        vids = fetch_videos(client, code, CONFIG["video_limit"], CONFIG.get("organic_only", True))
        print(f"[{code}] {len(vids)} video. Lấy video theo từng hashtag...")
        got = 0
        for h in tags:
            try:
                h["videos"] = fetch_hashtag_videos(client, code, h["id"])
                got += bool(h["videos"])
            except Exception as e:  # một hashtag lỗi thì bỏ qua, không làm hỏng cả lần chạy
                print(f"  bỏ qua #{h['name']}: {e}")
                h["videos"] = []
            time.sleep(0.4)
        print(f"[{code}] có video cho {got}/{len(tags)} hashtag")
        if len(tags) <= 3:
            warnings.append(f"{code}: chỉ lấy được {len(tags)} hashtag, phiên đăng nhập TikTok "
                            "có thể đã hết hạn")
        prev_reg = (prev_snap or {}).get("regions", {}).get(code)
        analyze_hashtags(tags, prev_reg and prev_reg["hashtags"])
        analyze_videos(vids, prev_reg and prev_reg["videos"], tags, now)
        region = {"code": code, "name": reg["name"], "hashtags": tags, "videos": vids}
        region["summary"] = summarize(region)
        snapshot["regions"][code] = region
    snapshot["warnings"] = warnings
    snapshot["previousDate"] = prev_snap and prev_snap["date"]

    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    (SNAP_DIR / f"{today_str}.json").write_text(text, encoding="utf-8")
    (OUT_DIR / "latest.json").write_text(text, encoding="utf-8")
    # Lịch sử thứ hạng hashtag 30 ngày để vẽ biểu đồ trong app
    history = {}
    for f in sorted(SNAP_DIR.glob("*.json"))[-30:]:
        s = json.loads(f.read_text(encoding="utf-8"))
        for code, r in s["regions"].items():
            for h in r["hashtags"]:
                history.setdefault(code, {}).setdefault(h["name"], {})[s["date"]] = {
                    "rank": h["rank"], "posts": h["posts"], "views": h["views"]}
    (OUT_DIR / "history.json").write_text(
        json.dumps(history, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Đã ghi", OUT_DIR / "latest.json")

    if topic and not os.environ.get("NO_NOTIFY"):
        main_reg = snapshot["regions"][CONFIG["regions"][0]["code"]]
        s = main_reg["summary"]
        lines = []
        if warnings:
            lines.append("⚠️ " + warnings[0])
        if s["newHashtags"]:
            lines.append("🆕 Mới: " + ", ".join("#" + t for t in s["newHashtags"][:5]))
        if s["jumpHashtags"]:
            lines.append("🚀 Tăng hạng: " + ", ".join(f"#{j['name']} (+{j['by']})" for j in s["jumpHashtags"][:3]))
        if s["risingHashtags"]:
            lines.append("📈 Đang lên: " + ", ".join("#" + t for t in s["risingHashtags"][:5]))
        top = main_reg["hashtags"][:3]
        if top:
            lines.append("🔥 Top: " + ", ".join("#" + h["name"] for h in top))
        if s["newVideos"]:
            lines.append(f"🎬 {s['newVideos']} video mới vào top")
        notify(topic, f"Trend TikTok {main_reg['name']} {today_str}", "\n".join(lines) or "Đã cập nhật", app_url)
    return 0


if __name__ == "__main__":
    sys.exit(main())

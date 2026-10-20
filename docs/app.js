"use strict";

const state = {
  data: null,
  history: {},
  region: localGet("region") || "VN",
  tagFilter: "all",
  view: "today",
  feedTag: null,
  muted: true,
  animate: true,   // hiệu ứng xuất hiện chỉ chạy ở lần mở đầu tiên
  todayScroll: 0,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (name, cls = "") => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function fmt(n) {
  n = Number(n) || 0;
  for (const [d, s] of [[1e9, " tỷ"], [1e6, "M"], [1e3, "K"]]) if (Math.abs(n) >= d) return (n / d).toFixed(1).replace(/\.0$/, "") + s;
  return String(Math.round(n));
}
const pct = (x, digits = 0) => ((x || 0) * 100).toFixed(digits) + "%";
const fmtDate = (s) => { if (!s) return ""; const [, m, d] = s.split("-"); return `${d}/${m}`; };
const WEEKDAY = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

const PHASE = {
  rising: ["Đang lên", "trend"],
  peak: ["Đỉnh", "flame"],
  cooling: ["Hạ nhiệt", "trend-down"],
  fading: ["Đã qua đỉnh", "trend-down"],
};
const phaseHTML = (p) => PHASE[p] ? `<span class="phase ${p}">${ic(PHASE[p][1])}${PHASE[p][0]}</span>` : "";

function deltaHTML(change) {
  if (change === "new") return `<span class="delta new">MỚI</span>`;
  if (typeof change !== "number" || change === 0) return "";
  return change > 0
    ? `<span class="delta up" aria-label="tăng ${change} hạng">${ic("up")}${change}</span>`
    : `<span class="delta down" aria-label="giảm ${-change} hạng">${ic("down")}${-change}</span>`;
}

let gradId = 0;
function areaPath(curve, w, h, padTop = 4, padBottom = 3) {
  const max = Math.max(100, ...curve);
  const pts = curve.map((v, i) => [(i / (curve.length - 1)) * w, padTop + (1 - v / max) * (h - padTop - padBottom)]);
  // Đường cong mượt (Catmull-Rom → Bezier)
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return { d, pts };
}

function spark(curve, { w = 72, h = 36, cls = "spark", color } = {}) {
  if (!curve || curve.length < 2) return "";
  const { d, pts } = areaPath(curve, w, h);
  const last = curve.at(-1), prev = curve.at(-2);
  color = color || (last >= prev ? "var(--up)" : "var(--down)");
  const id = "g" + gradId++;
  const [lx, ly] = pts.at(-1);
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${lx}" cy="${ly}" r="3" fill="${color}"/></svg>`;
}

// ------------------------------------------------------------ Tải dữ liệu

async function load() {
  const bust = "?t=" + Date.now();
  try {
    const [d, h] = await Promise.all([
      fetch("data/latest.json" + bust).then((r) => r.json()),
      fetch("data/history.json" + bust).then((r) => r.json()).catch(() => ({})),
    ]);
    state.data = d;
    state.history = h;
  } catch (e) {
    $("#view-today").innerHTML = `<div class="empty">Chưa có dữ liệu. Thử mở lại sau nhé.</div>`;
    return;
  }
  if (!state.data.regions[state.region]) state.region = Object.keys(state.data.regions)[0];
  renderRegions();
  render();
}

const region = () => state.data.regions[state.region];

function renderRegions() {
  $("#regions").innerHTML = Object.values(state.data.regions)
    .map((r) => `<button class="pressable" data-r="${r.code}" aria-pressed="${r.code === state.region}">${esc(r.name)}</button>`).join("");
}

function render() {
  renderToday();
  if (state.view === "feed") renderFeed();
}

// ------------------------------------------------------------ Tab Hôm nay

function renderToday() {
  const d = state.data, r = region(), s = r.summary;
  const genAt = new Date(d.generatedAt * 1000);
  const [y, m, dd] = d.date.split("-").map(Number);
  const weekday = WEEKDAY[new Date(y, m - 1, dd).getDay()];
  let i = 0; // thứ tự hiệu ứng xuất hiện
  const rise = state.animate ? "rise" : "";

  const hero = r.hashtags[0];
  const heroHTML = hero ? `
    <button class="hero pressable ${rise}" style="--i:${i++}" data-tag="${esc(hero.name)}">
      <div class="eyebrow">${ic("flame")} Trend #1 ${esc(r.name)} ${deltaHTML(hero.change)}</div>
      <h2><span class="hash">#</span>${esc(hero.name)}</h2>
      <p class="why">${phaseHTML(hero.phase)} ${esc(hero.reasons?.[0] || "")}</p>
      <div class="nums">
        <div><b>${fmt(hero.posts)}</b><span>video đăng</span></div>
        <div><b>${fmt(hero.views)}</b><span>lượt xem</span></div>
        <div><b>${fmt(hero.posts ? hero.views / hero.posts : 0)}</b><span>xem / video</span></div>
      </div>
      ${spark(hero.curve, { w: 340, h: 86, cls: "area", color: "#ff5a4e" })}
    </button>` : "";

  const names = (arr) => arr.map((x) => "#" + (x.name ?? x)).join(" · ");
  const tile = (key, cls, icon, title, count, list, empty, big) => `
    <button class="tile ${cls} ${big ? "big" : ""} pressable ${rise}" style="--i:${i++}" data-f="${key}" aria-pressed="${state.tagFilter === key}">
      <div class="t-head"><span class="t-ic">${ic(icon)}</span>${title}</div>
      <div class="t-num">${count}</div>
      <div class="t-list">${count ? esc(list) : `<span class="muted">${empty}</span>`}</div>
    </button>`;

  const vids = r.videos.slice(0, 12);
  const reelHTML = vids.length ? `
    <div class="sec-title ${rise}" style="--i:${i++}"><h3>${ic("zap", "fill")} Video đang viral</h3>
      <button class="link pressable" data-go="feed">Xem tất cả</button></div>
    <div class="reel ${rise}" style="--i:${i++}">
      ${vids.map((v, k) => `
        <button class="reel-card pressable" data-play="${k}" aria-label="Xem video hạng ${v.rank} của ${esc(v.author)}">
          <img src="${esc(v.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span class="rk">#${v.rank}</span>
          <span class="play">${ic("play", "fill")}</span>
          <span class="bottom"><b>${ic("eye")}${fmt(v.views)}</b><span>@${esc(v.author)}</span></span>
        </button>`).join("")}
    </div>` : "";

  let tags = r.hashtags;
  if (state.tagFilter === "new") tags = tags.filter((h) => h.change === "new");
  if (state.tagFilter === "rising") tags = tags.filter((h) => h.phase === "rising");
  if (state.tagFilter === "jump") tags = tags.filter((h) => typeof h.change === "number" && h.change >= 5);
  const filterNames = { all: "Tất cả", new: "Mới", rising: "Đang lên", jump: "Tăng hạng" };

  $("#view-today").innerHTML = `
    <div class="dateline ${rise}" style="--i:${i++}">
      <div><h1>${weekday}, ${fmtDate(d.date)}</h1>
        <div class="sub">Cập nhật ${genAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</div></div>
      <span class="pill">${ic("calendar")}${d.previousDate ? `so với ${fmtDate(d.previousDate)}` : "ngày đầu tiên"}</span>
    </div>
    ${(d.warnings || []).map((w) => `<div class="warn ${rise}" style="--i:${i++}">${ic("alert")}<div>${esc(w)}</div></div>`).join("")}
    ${heroHTML}
    <div class="sec-title ${rise}" style="--i:${i++}"><h3>${ic("sparkles")} Điểm nóng hôm nay</h3></div>
    <div class="bento">
      ${tile("new", "new", "sparkles", "Mới vào top", s.newHashtags.length, names(s.newHashtags), d.previousDate ? "Không có hashtag mới" : "Mai sẽ có so sánh", true)}
      ${tile("rising", "going", "trend", "Đang lên", s.risingHashtags.length, names(s.risingHashtags), "Chưa có")}
      ${tile("jump", "jump", "zap", "Tăng hạng", s.jumpHashtags.length, names(s.jumpHashtags), d.previousDate ? "Chưa có" : "Mai sẽ có")}
    </div>
    ${reelHTML}
    <div class="sec-title ${rise}" style="--i:${i++}"><h3>${ic("hash")} Bảng xếp hạng</h3>
      ${state.tagFilter !== "all" ? `<button class="link pressable" data-f="all">Bỏ lọc "${filterNames[state.tagFilter]}"</button>` : `<span class="muted" style="font-size:13px">${r.hashtags.length} hashtag</span>`}</div>
    <ol class="rank-list">
      ${tags.length ? tags.map((h, k) => `
        <li><button class="row ${h.rank <= 3 ? "top" : ""} pressable" data-tag="${esc(h.name)}">
          <div class="rk"><b>${h.rank}</b>${deltaHTML(h.change)}</div>
          <div style="min-width:0">
            <div class="nm">#${esc(h.name)}</div>
            <div class="meta">${phaseHTML(h.phase)}<span>${fmt(h.posts)} video · ${fmt(h.views)} xem</span></div>
            ${h.reasons?.[1] ? `<div class="why">${esc(h.reasons.find((x) => !x.startsWith("Đang") && !x.startsWith("Bắt đầu") && !x.startsWith("Đã qua")) || h.reasons[0])}</div>` : ""}
          </div>
          ${spark(h.curve)}
        </button></li>`).join("") : `<div class="empty">Không có hashtag nào trong mục này</div>`}
    </ol>`;
  state.animate = false;
}

function rankChart(name) {
  const hist = state.history[state.region]?.[name];
  const days = hist ? Object.keys(hist).sort() : [];
  if (days.length < 2) return `<div class="muted" style="font-size:13.5px">Mới theo dõi ${days.length || 1} ngày. Sau vài ngày sẽ có biểu đồ thứ hạng.</div>`;
  const w = 320, h = 130, maxR = Math.max(...days.map((d) => hist[d].rank), 10);
  const pts = days.map((d, i) => [(i / (days.length - 1)) * (w - 30) + 15, 18 + ((hist[d].rank - 1) / (maxR - 1 || 1)) * (h - 44)]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return `<div class="chart-box"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Thứ hạng theo ngày">
    <path d="${path}" fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--bg-2)" stroke="var(--cyan)" stroke-width="2"/>
      <text x="${p[0]}" y="${p[1] - 9}" fill="var(--text)" font-size="11" font-weight="700" text-anchor="middle">#${hist[days[i]].rank}</text>`).join("")}
    ${[0, days.length - 1].map((i) => `<text x="${pts[i][0]}" y="${h - 4}" fill="var(--muted)" font-size="11" text-anchor="middle">${fmtDate(days[i])}</text>`).join("")}
  </svg></div>`;
}

function curveChart(curve) {
  if (!curve?.length) return "";
  const w = 320, h = 130, top = 14, base = h - 24;
  const { d, pts } = areaPath(curve, w - 20, base, top, 0);
  const shifted = pts.map(([x, y]) => [x + 10, y]);
  const labels = curve.map((_, i) => i === curve.length - 1 ? "Mới nhất" : `${curve.length - 1 - i}n trước`);
  const id = "g" + gradId++;
  return `<div class="chart-box"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Độ hot 7 ngày">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2e63" stop-opacity=".45"/><stop offset="1" stop-color="#ff2e63" stop-opacity="0"/></linearGradient></defs>
    <g transform="translate(10 0)">
      <path d="${d} L${w - 20} ${base} L0 ${base} Z" fill="url(#${id})"/>
      <path d="${d}" fill="none" stroke="#ff5a4e" stroke-width="2.6" stroke-linecap="round"/>
    </g>
    ${shifted.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#ff5a4e"/>
      ${i % 2 === 0 || i === curve.length - 1 ? `<text x="${p[0]}" y="${h - 6}" fill="var(--muted)" font-size="10.5" text-anchor="middle">${labels[i]}</text>` : ""}`).join("")}
  </svg></div>`;
}

const reasonsHTML = (list) => `<ul class="reasons">${(list || []).map((x) => `<li>${ic("bulb")}<span>${esc(x)}</span></li>`).join("") || "<li>Chưa đủ dữ liệu</li>"}</ul>`;

function openTag(name) {
  const h = region().hashtags.find((x) => x.name === name);
  if (!h) return;
  const vids = region().videos.filter((v) => (v.tags || []).includes(name.toLowerCase()));
  openSheet(`
    <div class="kicker">Hạng #${h.rank} ${deltaHTML(h.change)} ${phaseHTML(h.phase)}</div>
    <h2><span class="hash">#</span>${esc(h.name)}</h2>
    <div class="stats">
      <div class="stat"><b>${fmt(h.posts)}</b><span>video đăng 7 ngày</span></div>
      <div class="stat"><b>${fmt(h.views)}</b><span>lượt xem</span></div>
      <div class="stat"><b>${fmt(h.posts ? h.views / h.posts : 0)}</b><span>xem mỗi video</span></div>
    </div>
    <div class="sec">${ic("bulb")} Vì sao đang trend</div>
    ${reasonsHTML(h.reasons)}
    <div class="sec">${ic("flame")} Độ hot 7 ngày (100 = đỉnh)</div>
    ${curveChart(h.curve)}
    <div class="sec">${ic("chart")} Thứ hạng theo ngày</div>
    ${rankChart(h.name)}
    ${h.creators?.length ? `<div class="sec">${ic("users")} Creator nổi bật</div>${h.creators.map((c) => `<div class="creator"><a href="https://www.tiktok.com/@${esc(c.handle)}" target="_blank" rel="noopener">@${esc(c.handle)}</a><span class="muted">${fmt(c.followers)} follower</span></div>`).join("")}` : ""}
    <div class="btns">
      ${vids.length ? `<button class="btn primary pressable" data-feedtag="${esc(h.name)}">${ic("play", "fill")} ${vids.length} video trend</button>` : ""}
      <a class="btn ${vids.length ? "" : "primary"} pressable" href="https://www.tiktok.com/tag/${encodeURIComponent(h.name)}" target="_blank" rel="noopener">${ic("external")} Xem trên TikTok</a>
    </div>`);
}

// ------------------------------------------------------------ Feed video

let observer = null;
let activeSlide = null;

function feedVideos() {
  const vids = region().videos;
  return state.feedTag ? vids.filter((v) => (v.tags || []).includes(state.feedTag.toLowerCase())) : vids;
}

function renderFeed(startAt = 0) {
  const vids = feedVideos();
  const feed = $("#feed");
  const ff = $("#feed-filter");
  stopFeed();
  ff.classList.toggle("hidden", !state.feedTag);
  ff.innerHTML = state.feedTag ? `#${esc(state.feedTag)}<button data-clearfeed aria-label="Bỏ lọc">${ic("x")}</button>` : "";
  if (!vids.length) {
    const msg = region().videos.length ? "Chưa có video trend" : `TikTok không cung cấp bảng video trend cho ${esc(region().name)}. Xem tab Hôm nay để biết hashtag đang hot.`;
    feed.innerHTML = `<div class="empty" style="padding-top:38vh">${msg}</div>`;
    return;
  }
  feed.innerHTML = vids.map((v, i) => `
    <div class="slide" data-i="${i}" data-id="${esc(v.id)}">
      <div class="bg" style="background-image:url('${esc(v.cover)}')"></div>
      <img class="cover" src="${esc(v.cover)}" alt="" loading="${Math.abs(i - startAt) < 2 ? "eager" : "lazy"}" referrerpolicy="no-referrer">
      <button class="tap" aria-label="Phát hoặc tạm dừng"></button>
      <div class="paused"><span>${ic("play", "fill")}</span></div>
      <div class="shade"></div>
      <div class="topbar"><span class="rank-badge">${ic("flame")} Hạng ${v.rank} ${deltaHTML(v.change)}</span><span class="counter">${i + 1}/${vids.length}</span></div>
      <div class="info">
        <div class="who">${v.avatar ? `<img class="avatar" src="${esc(v.avatar)}" alt="" referrerpolicy="no-referrer">` : ""}@${esc(v.author)}</div>
        <div class="title">${esc(v.title)}</div>
        <div class="kpis">
          <span>${ic("eye")}${fmt(v.views)} / 7 ngày</span>
          ${v.engagement ? `<span>${ic("heart")}${pct(v.engagement, 1)}</span>` : ""}
          ${v.vtr6s ? `<span>${ic("timer")}${pct(v.vtr6s)} xem &gt;6s</span>` : ""}
        </div>
        <button class="why-btn pressable" data-why="${i}">${ic("bulb")} Vì sao trend?</button>
      </div>
      <div class="rail">
        <button class="r-btn pressable" data-mute aria-pressed="${!state.muted}"><span class="r-ic">${ic(state.muted ? "vol-off" : "vol-on")}</span>${state.muted ? "Bật tiếng" : "Tắt tiếng"}</button>
        <button class="r-btn pressable" data-interact aria-pressed="false"><span class="r-ic">${ic("pointer")}</span>Điều khiển</button>
        <a class="r-btn pressable" href="https://www.tiktok.com/@${encodeURIComponent(v.author || "")}/video/${esc(v.id)}" target="_blank" rel="noopener"><span class="r-ic">${ic("external")}</span>TikTok</a>
      </div>
    </div>`).join("");
  feed.scrollTop = startAt * feed.clientHeight;
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting && e.intersectionRatio > 0.6) activate(e.target); });
  }, { root: feed, threshold: [0.6] });
  feed.querySelectorAll(".slide").forEach((s) => observer.observe(s));
}

function playerURL(id) {
  const p = new URLSearchParams({
    autoplay: 1, loop: 1, controls: 0, progress_bar: 1, play_button: 0, volume_control: 0,
    fullscreen_button: 0, timestamp: 0, music_info: 1, description: 0, rel: 0,
    native_context_menu: 0, closed_caption: 0,
  });
  return `https://www.tiktok.com/player/v1/${id}?${p}`;
}

function activate(slide) {
  if (activeSlide === slide) return;
  if (activeSlide) deactivate(activeSlide);
  activeSlide = slide;
  const ifr = document.createElement("iframe");
  ifr.src = playerURL(slide.dataset.id);
  ifr.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
  ifr.title = "Video TikTok";
  ifr.addEventListener("load", () => setTimeout(() => send(slide, state.muted ? "mute" : "unMute"), 600));
  slide.insertBefore(ifr, slide.querySelector(".tap"));
  slide.classList.remove("is-paused");
}

function deactivate(slide) {
  slide.querySelector("iframe")?.remove();
  slide.classList.remove("interactive", "is-paused");
  slide.querySelector("[data-interact]")?.setAttribute("aria-pressed", "false");
}

function send(slide, type, value) {
  slide?.querySelector("iframe")?.contentWindow?.postMessage({ type, value, "x-tiktok-player": true }, "*");
}

function stopFeed() {
  if (activeSlide) deactivate(activeSlide);
  activeSlide = null;
}

function openVideo(i) {
  const v = feedVideos()[i];
  if (!v) return;
  const tagsHTML = (v.tags || []).map((t) => {
    const hot = region().hashtags.find((h) => h.name.toLowerCase() === t);
    return hot
      ? `<button class="chip hot pressable" data-tag="${esc(hot.name)}">${ic("flame")}#${esc(t)} · hạng ${hot.rank}</button>`
      : `<span class="chip">#${esc(t)}</span>`;
  }).join("");
  openSheet(`
    <div class="kicker">${ic("flame")} Video trend hạng #${v.rank} ${deltaHTML(v.change)} ${v.category ? "· " + esc(v.category) : ""}</div>
    <h2>@${esc(v.author)}</h2>
    <div class="muted" style="font-size:13.5px">${esc(v.authorName || "")} · ${fmt(v.followers)} follower${v.ageDays != null ? ` · đăng ${Math.round(v.ageDays)} ngày trước` : ""}</div>
    <div class="stats">
      <div class="stat"><b>${fmt(v.views)}</b><span>xem 7 ngày</span></div>
      <div class="stat"><b>${fmt(v.viewsLifetime)}</b><span>tổng lượt xem</span></div>
      <div class="stat"><b>${v.followers ? (v.views / v.followers).toFixed(1) + "x" : "–"}</b><span>xem / follower</span></div>
      <div class="stat"><b>${pct(v.engagement, 1)}</b><span>tương tác</span></div>
      <div class="stat"><b>${pct(v.vtr6s)}</b><span>xem quá 6 giây</span></div>
      <div class="stat"><b>${v.viewsLifetime ? pct(v.views / v.viewsLifetime) : "–"}</b><span>view đến trong tuần</span></div>
    </div>
    <div class="sec">${ic("bulb")} Vì sao video này trend</div>
    ${reasonsHTML(v.reasons)}
    <div class="sec">${ic("hash")} Nội dung</div>
    <div class="caption">${esc(v.title) || "<span class='muted'>Không có mô tả</span>"}</div>
    ${tagsHTML ? `<div class="chips" style="margin-top:12px">${tagsHTML}</div>` : ""}
    <div class="btns"><a class="btn primary pressable" href="https://www.tiktok.com/@${encodeURIComponent(v.author || "")}/video/${esc(v.id)}" target="_blank" rel="noopener">${ic("external")} Mở trong TikTok</a></div>`);
}

// ------------------------------------------------------------ Sheet + điều hướng

let lastFocus = null;
function openSheet(html) {
  lastFocus = document.activeElement;
  $("#sheet-content").innerHTML = html;
  $("#sheet").classList.remove("hidden");
  document.body.classList.add("sheet-open");
  $(".sheet-body").scrollTop = 0;
  $(".sheet-close").focus({ preventScroll: true });
}
function closeSheet() {
  $("#sheet").classList.add("hidden");
  document.body.classList.remove("sheet-open");
  lastFocus?.focus?.({ preventScroll: true });
}

function setView(v, startAt = 0) {
  if (state.view === "today" && v !== "today") state.todayScroll = window.scrollY;
  state.view = v;
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + v));
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === v));
  document.body.classList.toggle("feed-mode", v === "feed");
  if (v === "feed") renderFeed(startAt); else { stopFeed(); window.scrollTo(0, state.todayScroll); }
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").classList.contains("hidden")) closeSheet(); });

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-tag], .sheet-backdrop");
  if (!t) return;
  if (t.matches(".sheet-backdrop") || t.hasAttribute("data-close")) return closeSheet();
  if (t.dataset.view) return setView(t.dataset.view);
  if (t.dataset.go) { state.feedTag = null; return setView(t.dataset.go); }
  if (t.dataset.play) { state.feedTag = null; return setView("feed", +t.dataset.play); }
  if (t.dataset.r) {
    state.region = t.dataset.r; localSet("region", t.dataset.r); state.feedTag = null; state.tagFilter = "all";
    renderRegions(); stopFeed(); window.scrollTo(0, 0); return render();
  }
  if (t.dataset.f) {
    state.tagFilter = state.tagFilter === t.dataset.f ? "all" : t.dataset.f;
    renderToday();
    if (state.tagFilter !== "all") $(".rank-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (t.dataset.feedtag) { state.feedTag = t.dataset.feedtag; closeSheet(); return setView("feed"); }
  if (t.hasAttribute("data-clearfeed")) { state.feedTag = null; return renderFeed(); }
  if (t.dataset.why) return openVideo(+t.dataset.why);
  if (t.hasAttribute("data-mute")) {
    state.muted = !state.muted;
    send(activeSlide, state.muted ? "mute" : "unMute");
    document.querySelectorAll("[data-mute]").forEach((b) => {
      b.setAttribute("aria-pressed", !state.muted);
      b.innerHTML = `<span class="r-ic">${ic(state.muted ? "vol-off" : "vol-on")}</span>${state.muted ? "Bật tiếng" : "Tắt tiếng"}`;
    });
    return;
  }
  if (t.hasAttribute("data-interact")) {
    // Cho chạm thẳng vào trình phát TikTok (khi nút âm thanh không ăn). Bấm lại để lướt tiếp.
    const on = activeSlide?.classList.toggle("interactive");
    t.setAttribute("aria-pressed", !!on);
    return;
  }
  if (t.classList.contains("tap")) {
    const s = t.closest(".slide");
    const paused = s.classList.toggle("is-paused");
    send(s, paused ? "pause" : "play");
    return;
  }
  if (t.dataset.tag) { closeSheet(); return openTag(t.dataset.tag); }
});

// Mở lại app sau một lúc → tải dữ liệu mới nếu đã có bản mới
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !state.data) return;
  try {
    const d = await fetch("data/latest.json?t=" + Date.now()).then((r) => r.json());
    if (d.generatedAt !== state.data.generatedAt) load();
  } catch {}
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
load();

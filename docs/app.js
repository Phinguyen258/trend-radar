"use strict";

const state = {
  data: null,
  history: {},
  region: localGet("region") || "VN",
  tagFilter: "all",
  view: "today",
  feedTag: null,
  muted: true,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function fmt(n) {
  n = Number(n) || 0;
  const units = [[1e9, " tỷ"], [1e6, "M"], [1e3, "K"]];
  for (const [d, s] of units) if (Math.abs(n) >= d) return (n / d).toFixed(1).replace(/\.0$/, "") + s;
  return String(Math.round(n));
}
const pct = (x, digits = 0) => (x * 100).toFixed(digits) + "%";
const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${d}/${m}`; };
const PHASE = { rising: "Đang lên", peak: "Đỉnh", cooling: "Hạ nhiệt", fading: "Đã qua đỉnh" };

function deltaHTML(change) {
  if (change === "new") return `<span class="delta new">MỚI</span>`;
  if (typeof change !== "number" || change === 0) return "";
  return change > 0 ? `<span class="delta up">▲${change}</span>` : `<span class="delta down">▼${-change}</span>`;
}

function spark(curve, w = 76, h = 34, cls = "spark") {
  if (!curve || curve.length < 2) return "";
  const max = Math.max(100, ...curve);
  const pts = curve.map((v, i) => [(i / (curve.length - 1)) * (w - 4) + 2, h - 3 - (v / max) * (h - 6)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = curve[curve.length - 1], prev = curve[curve.length - 2];
  const color = last >= prev ? "var(--green)" : "var(--pink)";
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${d} L${w - 2} ${h} L2 ${h} Z" fill="${color}" opacity=".12"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${lx}" cy="${ly}" r="2.6" fill="${color}"/></svg>`;
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
    $("#summary").innerHTML = `<div class="empty">Chưa có dữ liệu. Thử mở lại sau nhé.</div>`;
    return;
  }
  if (!state.data.regions[state.region]) state.region = Object.keys(state.data.regions)[0];
  renderRegions();
  render();
}

const region = () => state.data.regions[state.region];

function renderRegions() {
  $("#regions").innerHTML = Object.values(state.data.regions)
    .map((r) => `<button data-r="${r.code}" class="${r.code === state.region ? "active" : ""}">${esc(r.name)}</button>`).join("");
}

function render() {
  renderToday();
  if (state.view === "feed") renderFeed();
}

// ------------------------------------------------------------ Tab Hôm nay

function renderToday() {
  const d = state.data, r = region(), s = r.summary;
  const when = new Date(d.generatedAt * 1000);
  $("#updated").textContent = `Cập nhật ${when.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ngày ${fmtDate(d.date)}`
    + (d.previousDate ? ` · so với ${fmtDate(d.previousDate)}` : " · ngày đầu tiên, mai sẽ có so sánh");
  $("#warnings").innerHTML = (d.warnings || []).map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join("");

  const top3 = r.hashtags.slice(0, 3);
  const chipList = (arr, cls, label) => arr.length
    ? `<div class="chips">${arr.map((x) => `<button class="chip ${cls}" data-tag="${esc(x.name ?? x)}">#${esc(x.name ?? x)}${x.by ? ` +${x.by}` : ""}</button>`).join("")}</div>`
    : `<div class="muted small">${label}</div>`;

  $("#summary").innerHTML = `<div class="cards">
    <div class="card wide"><h3>🔥 Top trend ${esc(r.name)}</h3>
      ${chipList(top3.map((h) => h.name), "", "Chưa có dữ liệu")}</div>
    <div class="card wide"><h3>🆕 Mới vào top hôm nay</h3>
      ${chipList(s.newHashtags, "new", d.previousDate ? "Không có hashtag mới" : "Mai sẽ biết hashtag nào mới")}</div>
    <div class="card wide"><h3>📈 Đang lên mạnh</h3>
      ${chipList(s.risingHashtags, "rise", "Không có hashtag nào đang lên mạnh")}</div>
    ${s.jumpHashtags.length ? `<div class="card wide"><h3>🚀 Tăng hạng nhanh</h3>${chipList(s.jumpHashtags, "up", "")}</div>` : ""}
    <div class="card"><h3>Hashtag</h3><div class="big">${r.hashtags.length}</div><div class="muted small">trong top</div></div>
    <div class="card" data-go="feed" style="cursor:pointer"><h3>Video trend</h3><div class="big">${r.videos.length}</div>
      <div class="muted small">${s.newVideos ? `${s.newVideos} video mới · ` : ""}bấm để xem ▶</div></div>
  </div>`;

  const filters = [["all", "Tất cả"], ["new", "Mới"], ["rising", "Đang lên"]];
  $("#tag-filter").innerHTML = filters.map(([k, l]) => `<button data-f="${k}" class="${state.tagFilter === k ? "active" : ""}">${l}</button>`).join("");

  let tags = r.hashtags;
  if (state.tagFilter === "new") tags = tags.filter((h) => h.change === "new");
  if (state.tagFilter === "rising") tags = tags.filter((h) => h.phase === "rising");
  $("#tags").innerHTML = tags.length ? tags.map((h) => `
    <li class="tag" data-tag="${esc(h.name)}">
      <div class="rk"><b>${h.rank}</b>${deltaHTML(h.change)}</div>
      <div style="min-width:0">
        <div class="nm">#${esc(h.name)}</div>
        <div class="meta">${h.phase && PHASE[h.phase] ? `<span class="phase ${h.phase}">${PHASE[h.phase]}</span>` : ""}${fmt(h.posts)} video · ${fmt(h.views)} lượt xem</div>
        ${h.reasons?.length ? `<div class="why">${esc(h.reasons[0])}</div>` : ""}
      </div>
      ${spark(h.curve)}
    </li>`).join("") : `<div class="empty">Không có hashtag nào</div>`;
}

function rankChart(name) {
  const hist = state.history[state.region]?.[name];
  if (!hist) return "";
  const days = Object.keys(hist).sort();
  if (days.length < 2) return `<div class="muted small">Mới theo dõi ${days.length} ngày, cần thêm vài ngày để có biểu đồ thứ hạng.</div>`;
  const w = 320, h = 120, maxR = Math.max(...days.map((d) => hist[d].rank), 10);
  const pts = days.map((d, i) => [(i / (days.length - 1)) * (w - 30) + 15, 12 + ((hist[d].rank - 1) / (maxR - 1 || 1)) * (h - 34)]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}">
    <path d="${path}" fill="none" stroke="var(--cyan)" stroke-width="2.2"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--cyan)"/><text x="${p[0]}" y="${p[1] - 7}" fill="var(--text)" font-size="10" text-anchor="middle">#${hist[days[i]].rank}</text>`).join("")}
    ${[0, days.length - 1].map((i) => `<text x="${pts[i][0]}" y="${h - 4}" fill="var(--muted)" font-size="10" text-anchor="middle">${fmtDate(days[i])}</text>`).join("")}
  </svg>`;
}

function curveChart(curve) {
  if (!curve?.length) return "";
  const w = 320, h = 120;
  const pts = curve.map((v, i) => [(i / (curve.length - 1)) * (w - 20) + 10, h - 22 - (v / 100) * (h - 34)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
  const labels = curve.map((_, i) => i === curve.length - 1 ? "Gần nhất" : `-${curve.length - 1 - i}`);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}">
    <path d="${d} L${pts.at(-1)[0]} ${h - 22} L${pts[0][0]} ${h - 22} Z" fill="var(--pink)" opacity=".15"/>
    <path d="${d}" fill="none" stroke="var(--pink)" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--pink)"/><text x="${p[0]}" y="${h - 6}" fill="var(--muted)" font-size="10" text-anchor="middle">${labels[i]}</text>`).join("")}
  </svg>`;
}

function openTag(name) {
  const h = region().hashtags.find((x) => x.name === name);
  if (!h) return;
  const vids = region().videos.filter((v) => (v.tags || []).includes(name.toLowerCase()));
  openSheet(`
    <div class="muted small">Hạng #${h.rank} ${deltaHTML(h.change)} ${h.phase && PHASE[h.phase] ? `<span class="phase ${h.phase}">${PHASE[h.phase]}</span>` : ""}</div>
    <h2>#${esc(h.name)}</h2>
    <div class="stats">
      <div class="stat"><b>${fmt(h.posts)}</b><span>video đăng (7 ngày)</span></div>
      <div class="stat"><b>${fmt(h.views)}</b><span>lượt xem</span></div>
      <div class="stat"><b>${fmt(h.posts ? h.views / h.posts : 0)}</b><span>xem / video</span></div>
    </div>
    <div class="sec">Vì sao đang trend</div>
    <ul class="reasons">${(h.reasons || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>Chưa đủ dữ liệu</li>"}</ul>
    <div class="sec">Độ hot 7 ngày (100 = đỉnh)</div>
    ${curveChart(h.curve)}
    <div class="sec">Thứ hạng theo ngày</div>
    ${rankChart(h.name)}
    ${h.creators?.length ? `<div class="sec">Creator nổi bật</div>${h.creators.map((c) => `<div class="creator"><a href="https://www.tiktok.com/@${esc(c.handle)}" target="_blank" rel="noopener">${esc(c.name || c.handle)}</a><span class="muted">${fmt(c.followers)} follower</span></div>`).join("")}` : ""}
    <div class="btns">
      <a class="btn primary" href="https://www.tiktok.com/tag/${encodeURIComponent(h.name)}" target="_blank" rel="noopener">Xem trên TikTok</a>
      ${vids.length ? `<button class="btn" data-feedtag="${esc(h.name)}">▶ ${vids.length} video trend</button>` : ""}
    </div>`);
}

// ------------------------------------------------------------ Feed video

let observer = null;
let activeSlide = null;

function feedVideos() {
  const vids = region().videos;
  return state.feedTag ? vids.filter((v) => (v.tags || []).includes(state.feedTag.toLowerCase())) : vids;
}

function renderFeed() {
  const vids = feedVideos();
  const feed = $("#feed");
  const ff = $("#feed-filter");
  ff.classList.toggle("hidden", !state.feedTag);
  ff.innerHTML = state.feedTag ? `#${esc(state.feedTag)} · <button data-clearfeed>✕ Bỏ lọc</button>` : "";
  if (!vids.length) { feed.innerHTML = `<div class="empty" style="padding-top:40vh">Chưa có video trend</div>`; return; }
  feed.innerHTML = vids.map((v, i) => `
    <div class="slide" data-i="${i}" data-id="${esc(v.id)}">
      <img class="cover" src="${esc(v.cover)}" alt="" loading="${i < 2 ? "eager" : "lazy"}" referrerpolicy="no-referrer">
      <div class="tap"></div>
      <div class="paused">▶</div>
      <div class="shade"></div>
      <div class="rank">#${v.rank}${deltaHTML(v.change)}</div>
      <div class="info">
        <div class="who">@${esc(v.author)}</div>
        <div class="title">${esc(v.title)}</div>
        <div class="kpis">
          <span>👁 ${fmt(v.views)} / 7 ngày</span>
          ${v.engagement ? `<span>❤️ ${pct(v.engagement, 1)} tương tác</span>` : ""}
          ${v.vtr6s ? `<span>⏱ ${pct(v.vtr6s)} xem >6s</span>` : ""}
        </div>
      </div>
      <div class="rail">
        <button data-why="${i}"><span class="ic">💡</span>Vì sao</button>
        <button data-mute><span class="ic">${state.muted ? "🔇" : "🔊"}</span>Âm thanh</button>
        <button data-interact><span class="ic">✋</span>Điều khiển</button>
        <a href="https://www.tiktok.com/@${encodeURIComponent(v.author || "")}/video/${esc(v.id)}" target="_blank" rel="noopener"><span class="ic">↗</span>TikTok</a>
      </div>
    </div>`).join("");
  feed.scrollTop = 0;
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
  ifr.addEventListener("load", () => setTimeout(() => send(slide, state.muted ? "mute" : "unMute"), 600));
  slide.insertBefore(ifr, slide.querySelector(".tap"));
  slide.classList.remove("is-paused");
}

function deactivate(slide) {
  slide.querySelector("iframe")?.remove();
  slide.classList.remove("interactive", "is-paused");
}

function send(slide, type, value) {
  const f = slide?.querySelector("iframe");
  f?.contentWindow?.postMessage({ type, value, "x-tiktok-player": true }, "*");
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
    return `<button class="chip ${hot ? "rise" : ""}" ${hot ? `data-tag="${esc(hot.name)}"` : ""}>#${esc(t)}${hot ? ` 🔥#${hot.rank}` : ""}</button>`;
  }).join("");
  openSheet(`
    <div class="muted small">Video trend hạng #${v.rank} ${deltaHTML(v.change)} ${v.category ? "· " + esc(v.category) : ""}</div>
    <h2>@${esc(v.author)}</h2>
    <div class="muted small">${esc(v.authorName || "")} · ${fmt(v.followers)} follower${v.ageDays != null ? ` · đăng ${Math.round(v.ageDays)} ngày trước` : ""}</div>
    <div class="stats">
      <div class="stat"><b>${fmt(v.views)}</b><span>xem 7 ngày</span></div>
      <div class="stat"><b>${fmt(v.viewsLifetime)}</b><span>tổng lượt xem</span></div>
      <div class="stat"><b>${v.followers ? (v.views / v.followers).toFixed(1) + "x" : "–"}</b><span>xem / follower</span></div>
      <div class="stat"><b>${pct(v.engagement, 1)}</b><span>tương tác</span></div>
      <div class="stat"><b>${pct(v.vtr6s)}</b><span>xem quá 6s</span></div>
      <div class="stat"><b>${v.viewsLifetime ? pct(v.views / v.viewsLifetime) : "–"}</b><span>view đến tuần này</span></div>
    </div>
    <div class="sec">Vì sao video này trend</div>
    <ul class="reasons">${(v.reasons || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>Chưa đủ dữ liệu</li>"}</ul>
    <div class="sec">Nội dung</div>
    <div style="font-size:14.5px">${esc(v.title) || "<span class='muted'>Không có mô tả</span>"}</div>
    ${tagsHTML ? `<div class="chips" style="margin-top:10px">${tagsHTML}</div>` : ""}
    <div class="btns"><a class="btn primary" href="https://www.tiktok.com/@${encodeURIComponent(v.author || "")}/video/${esc(v.id)}" target="_blank" rel="noopener">Mở trong TikTok</a></div>`);
}

// ------------------------------------------------------------ Sheet + điều hướng

function openSheet(html) {
  $("#sheet-content").innerHTML = html;
  $("#sheet").classList.remove("hidden");
  $(".sheet-body").scrollTop = 0;
}
function closeSheet() { $("#sheet").classList.add("hidden"); }

function setView(v) {
  state.view = v;
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + v));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  document.body.classList.toggle("feed-mode", v === "feed");
  if (v === "feed") renderFeed(); else stopFeed();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-tag], [data-go], .tap, .sheet-backdrop");
  if (!t) return;
  if (t.matches(".sheet-backdrop")) return closeSheet();
  if (t.dataset.view) return setView(t.dataset.view);
  if (t.dataset.go) return setView(t.dataset.go);
  if (t.dataset.r) { state.region = t.dataset.r; localSet("region", t.dataset.r); state.feedTag = null; renderRegions(); stopFeed(); return render(); }
  if (t.dataset.f) { state.tagFilter = t.dataset.f; return renderToday(); }
  if (t.dataset.feedtag) { state.feedTag = t.dataset.feedtag; closeSheet(); return setView("feed"); }
  if (t.hasAttribute("data-clearfeed")) { state.feedTag = null; stopFeed(); return renderFeed(); }
  if (t.dataset.why) return openVideo(+t.dataset.why);
  if (t.hasAttribute("data-mute")) {
    state.muted = !state.muted;
    send(activeSlide, state.muted ? "mute" : "unMute");
    document.querySelectorAll("[data-mute] .ic").forEach((ic) => (ic.textContent = state.muted ? "🔇" : "🔊"));
    return;
  }
  if (t.hasAttribute("data-interact")) {
    // Cho phép chạm thẳng vào trình phát TikTok (khi nút âm thanh không ăn). Bấm lại để lướt tiếp.
    activeSlide?.classList.toggle("interactive");
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

// Mở lại app sau một lúc → tải dữ liệu mới
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !state.data) return;
  try {
    const d = await fetch("data/latest.json?t=" + Date.now()).then((r) => r.json());
    if (d.generatedAt !== state.data.generatedAt) load();
  } catch {}
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
load();

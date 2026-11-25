/*
  Lyric Code engine. Each song folder has an index.html that sets window.SONG (the config)
  and then loads this file. Lyrics are read at runtime from:
    1. lyrics.lrc next to the song's index.html (if it exists), else
    2. lrclib.net synced lyrics for SONG.lrclib.artist + SONG.lrclib.track.
  Nothing has to be pasted anywhere.
*/
(() => {
  const S = window.SONG || {};
  const $ = id => document.getElementById(id);
  const root = document.documentElement.style;

  // ================= config + defaults =================
  const SHAKE = S.shake ?? 1;
  const TYPOS = S.typos ?? true;
  const COLORS = { accent: "#ff6450", cursor: "#ff4a35", keys: "110,90,255", glow: "255,80,60", ...(S.colors || {}) };
  const TABS = S.tabs || ["main.js"];
  const FILE = S.file || TABS[0];
  const INTRO = S.intro || [];
  const KINDS = S.kinds || {};
  const DECOYS = S.decoys && S.decoys.length ? S.decoys : ["undefined", "null", "return", "await", "promise"];
  const PROBLEMS = S.problems || "⚠ 0 problems";
  const END = { mood: "sad", script: [], heartStops: 11, fadeAt: 13, powerOffAt: 16, ...(S.ending || {}) };
  const OFFSET = S.offset || 0;            // shift all lyric times (seconds) if they feel early/late
  const KIND_OF = {};
  for (const [k, v] of Object.entries(KINDS)) v.words.forEach(w => { KIND_OF[w] = k; });

  const SHOTS = {
    standard: { z: 1.00, rx: 7, ry: -6,  rz: -1.0, x: 0,  y: 0 },
    close:    { z: 1.30, rx: 5, ry: -3,  rz: -0.5, x: -2, y: -1 },
    wide:     { z: 0.86, rx: 9, ry: -9,  rz: -1.5, x: 3,  y: 2 },
    dutch:    { z: 1.14, rx: 6, ry: -5,  rz: -4.5, x: 0,  y: 0 },
    side:     { z: 1.06, rx: 4, ry: -16, rz: -1.0, x: 4,  y: 0 },
    far:      { z: 0.80, rx: 11, ry: -8, rz: -1.6, x: 4,  y: 3 },
    warm:     { z: 1.10, rx: 5, ry: -4,  rz: -0.6, x: -1, y: 0 },
  };

  root.setProperty("--accent", COLORS.accent);
  root.setProperty("--cursor", COLORS.cursor);
  root.setProperty("--kc", COLORS.keys);
  root.setProperty("--glow", COLORS.glow);
  document.title = `${S.title || "Lyric Code"} · lyric code`;

  // ================= page markup =================
  const escAttr = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  document.body.insertAdjacentHTML("afterbegin", `
    <div id="crt"><div id="world">
      <div id="screenGlow"></div>
      <div id="tilt">
        <div id="tabs">${TABS.map((t, i) => `<span class="${i === 0 ? "on" : ""}">${escAttr(t)}</span>`).join("")}</div>
        <div id="mini"><div id="miniRows"></div><div id="miniView"></div></div>
        <div id="status">
          <span><span class="hb" id="hb">♥</span> <b id="bpm">72</b> bpm</span>
          <span id="probs">${PROBLEMS}</span>
          <span id="pos">Ln 1, Col 1</span>
          <span>${escAttr(FILE)} · UTF-8 · JavaScript</span>
        </div>
        <div id="editor"><div id="lines"></div></div>
        <div id="term"></div>
      </div>
      <div id="glare"></div>
      <div id="kbWrap"><div id="kb"></div></div>
    </div></div>
    <canvas id="dust"></canvas>
    <div id="flash"></div><div id="dim"></div><div id="moire"></div><div id="grain"></div><div id="vignette"></div>
    <div id="hint">// couldn't load the lyrics<br>// check your internet, or put a <b>lyrics.lrc</b> next to this page</div>`);

  // ================= state =================
  let lines = [], first = 0, last = 0, lyricFirst = 0;
  let audio = null, audioEndedAt = null, analyser = null, freq = null;
  let clockStart = null, paused = false, pausedAt = 0, started = false;
  let rendered = [], fired = new Set(), lastKey = "", lastT = -1;

  // ================= helpers =================
  const hash = (a, b) => { let h = (Math.floor(a * 1000) * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise = (t, s) => Math.sin(t * 1.7 + s * 13.1) * .5 + Math.sin(t * 3.13 + s * 7.7) * .3 + Math.sin(t * 7.9 + s * 3.3) * .2;
  const words = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’'-]/g, "").replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  const snake = ws => ws.join("_");
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const kindOf = s => { for (const w of words(s.replace(/_/g, " "))) if (KIND_OF[w]) return KIND_OF[w]; return null; };

  // ================= lyrics -> code =================
  function toCode(text, i, gap) {
    const T = [], p = (c, s) => T.push({ c, s });
    const w = words(text), n = w.length;
    if (!n) { p("cm", "// " + ".".repeat(Math.max(6, Math.min(14, Math.round(gap * 2))))); return T; }
    if (n === 1) { p("fn", w[0]); p("pu", "();"); return T; }
    if (n === 2) { p("pu", "{ "); p("key", w[0]); p("pu", ": "); p("str", `"${w[1]}"`); p("pu", " };"); return T; }
    if (n === 3) { p("obj", w[0]); p("pu", "."); p("fn", w[1]); p("pu", "( "); p("str", `"${w[2]}"`); p("pu", " );"); return T; }
    const k = Math.min(n - 1, 2 + Math.ceil((n - 2) / 2));
    switch (i % 5) {
      case 0:
        p("obj", w[0]); p("pu", "."); p("fn", w[1]); p("pu", "( "); p("str", `"${snake(w.slice(2, k))}"`); p("pu", " ){ ");
        p("key", w[k]); if (k + 1 < n) { p("pu", ": "); p("str", `"${snake(w.slice(k + 1))}"`); }
        break;
      case 1:
        p("fn", w[0]); p("pu", "( "); p("str", `"${snake(w.slice(1, k))}"`); p("pu", " ){ "); p("key", snake(w.slice(k))); p("pu", " }");
        break;
      case 2:
        p("pu", "{ "); p("key", snake(w.slice(0, 2))); p("pu", ": "); p("str", `"${snake(w.slice(2))}"`); p("pu", " };");
        break;
      case 3:
        p("kw", "if"); p("pu", " ( "); p("obj", w[0]); p("pu", "."); p("fn", w[1]); p("pu", " === ");
        p("str", `"${snake(w.slice(2, n - 1))}"`); p("pu", " ) "); p("kw", "return"); p("pu", " "); p("key", w[n - 1]); p("pu", ";");
        break;
      default:
        p("kw", "const"); p("pu", " "); p("key", snake(w.slice(0, 2))); p("pu", " = "); p("kw", "await"); p("pu", " ");
        p("fn", w[2]); p("pu", "( "); p("str", `"${snake(w.slice(3))}"`); p("pu", " );");
    }
    return T;
  }

  const tokenAt = (L, n) => L.code.find(t => n >= t.start && n < t.start + t.s.length) || L.code[L.code.length - 1];

  function codeHTML(L, n, wrong) {
    let out = "", left = n;
    const phase = `animation-delay:-${(performance.now() / 1000 % 2.6).toFixed(2)}s`;   // keeps effects running across redraws
    for (const t of L.code) {
      if (left <= 0) break;
      const s = t.s.slice(0, left); left -= s.length;
      const inner = `<span class="${t.c}">${esc(s)}</span>`;
      if (!t.kind) { out += inner; continue; }
      const K = KINDS[t.kind];
      out += K.style === "glow"
        ? `<span class="gl" style="--gw:${K.col};${phase}">${inner}</span>`
        : `<span class="g" style="${phase}">${inner}</span>`;
    }
    if (wrong) out += `<span class="${tokenAt(L, n).c} typo">${esc(wrong)}</span>`;
    return out;
  }

  // keystroke script: uneven human timing, pauses, and (sometimes) a typo that gets backspaced
  const ROWS_Q = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  const neighbor = (ch, r) => { for (const row of ROWS_Q) { const i = row.indexOf(ch); if (i >= 0) return row[Math.max(0, Math.min(row.length - 1, i + (r < .5 ? -1 : 1)))]; } return "x"; };
  function keySteps(i, L, gap, allowTypo) {
    const flat = L.flat, len = flat.length, steps = [];
    let typoAt = -1;
    if (allowTypo && TYPOS && hash(i, 777) < 0.5) {
      const cand = [];
      for (let j = 4; j < len - 2; j++) if (/[a-z]/.test(flat[j]) && ["str", "key", "fn"].includes(tokenAt(L, j).c)) cand.push(j);
      if (cand.length) typoAt = cand[Math.floor(hash(i, 778) * cand.length)];
    }
    for (let j = 0; j < len; j++) {
      let w = 0.55 + hash(i, j) * 0.95;
      const prev = flat[j - 1];
      if (prev === " ") w *= 1.7;
      if ("({:=".includes(prev)) w *= 1.4;
      if (hash(i + 99, j) < 0.04) w *= 4;
      if (j === 0) w = 0.2;
      if (j === typoAt) {
        const wc = neighbor(flat[j], hash(i, 779));
        steps.push({ n: j, wrong: wc, w, key: wc });
        steps.push({ n: j, wrong: null, w: 3.2, key: "⌫" });
        steps.push({ n: j + 1, wrong: null, w: 1.8, key: flat[j] });
      } else steps.push({ n: j + 1, wrong: null, w, key: flat[j] });
    }
    const total = Math.min(gap * 0.66, len * 0.08 + (typoAt >= 0 ? 0.35 : 0), Math.max(len * 0.022, gap * 0.35));
    const sum = steps.reduce((a, s) => a + s.w, 0) || 1;
    let acc = 0;
    steps.forEach(s => { acc += s.w / sum * total; s.t = acc; });
    return steps;
  }

  // ================= loading =================
  function parseLRC(src) {
    const out = [];
    for (const raw of src.split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (!stamps.length) continue;
      const text = raw.replace(/\[[^\]]*\]/g, "").trim();
      for (const s of stamps) out.push({ t: +s[1] * 60 + +s[2] + OFFSET, text });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  function finishLine(L, i, gap, allowTypo) {
    let pos = 0;
    L.code.forEach(tok => { tok.start = pos; pos += tok.s.length; });
    L.flat = L.code.map(x => x.s).join("");
    L.len = L.flat.length;
    L.steps = keySteps(i, L, gap, allowTypo);
    L.theme = L.code.some(t => t.kind && KINDS[t.kind].style !== "glow");
    return L;
  }
  function setLyrics(src) {
    const parsed = parseLRC(src);
    if (!parsed.length) { $("hint").style.display = "block"; return; }
    lyricFirst = parsed[0].t;
    const intro = INTRO.map((x, k) => finishLine({ t: lyricFirst + x.at, text: "", intro: true, code: x.code.map(c => ({ ...c })) },
      k, (k + 1 < INTRO.length ? INTRO[k + 1].at : 0) - x.at, false));
    const lyr = parsed.map((l, i) => {
      const gap = (i + 1 < parsed.length ? parsed[i + 1].t : l.t + 3) - l.t;
      const code = toCode(l.text, i, gap).map(tok => ({ ...tok, kind: tok.c !== "pu" ? kindOf(tok.s) : null }));
      return finishLine({ ...l, code, blank: !words(l.text).length }, i + 10, gap, true);
    });
    lines = [...intro, ...lyr];
    first = lines[0].t; last = lines[lines.length - 1].t;
    $("lines").innerHTML = lines.map((_, i) => `<div class="line" id="L${i}"><span class="ln">${i + 1}</span><span class="code"></span></div>`).join("");
    rendered = lines.map(() => "");
    begin();
  }

  async function fetchLyrics() {
    // 1) lyrics.lrc next to the page
    try {
      const r = await fetch("lyrics.lrc", { cache: "no-store" });
      if (r.ok) { const t = await r.text(); if (parseLRC(t).some(l => words(l.text).length)) return t; }
    } catch (_) {}
    // 2) synced lyrics from lrclib.net
    if (S.lrclib) {
      const base = "https://lrclib.net/api/";
      try {
        const r = await fetch(base + "get?" + new URLSearchParams({ artist_name: S.lrclib.artist, track_name: S.lrclib.track }));
        if (r.ok) { const j = await r.json(); if (j.syncedLyrics) return j.syncedLyrics; }
      } catch (_) {}
      try {
        const r = await fetch(base + "search?" + new URLSearchParams({ q: `${S.lrclib.artist} ${S.lrclib.track}` }));
        if (r.ok) {
          const want = words(S.lrclib.track).join(" ");
          const hit = (await r.json()).find(x => x.syncedLyrics && words(x.trackName || "").join(" ") === want);
          if (hit) return hit.syncedLyrics;
        }
      } catch (_) {}
    }
    return null;
  }
  async function loadLyrics(tries = 0) {
    const src = await fetchLyrics();
    if (src) return setLyrics(src);
    if (tries < 5) return setTimeout(() => loadLyrics(tries + 1), 800);
    $("hint").style.display = "block";
  }

  // drop the song's mp3 anywhere: syncs to the real audio + beat detection
  addEventListener("dragover", e => e.preventDefault());
  addEventListener("drop", e => {
    e.preventDefault();
    const f = [...e.dataTransfer.files].find(f => f.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(f.name));
    if (!f) return;
    const t = started ? songTime() : null;
    if (audio) audio.pause();
    audio = new Audio(URL.createObjectURL(f));
    audio.addEventListener("ended", () => { audioEndedAt = now(); });
    audio.currentTime = Math.max(0, t ?? startTime());
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaElementSource(audio);
      analyser = ac.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser); analyser.connect(ac.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
    } catch (_) { analyser = null; }
    audio.play();
  });

  // ================= clock =================
  const now = () => performance.now() / 1000;
  // where playback starts: a fixed song time (e.g. 0 = start with the song), or just before the intro
  const startTime = () => typeof S.start === "number" ? S.start : first - 0.3;
  function songTime() {
    if (audio && audioEndedAt !== null) return audio.duration + (now() - audioEndedAt);
    if (audio) return audio.currentTime;
    if (clockStart === null) return startTime();
    return paused ? pausedAt : now() - clockStart;
  }
  function seek(t) {
    t = Math.max(0, t); audioEndedAt = null;
    if (audio) audio.currentTime = t; else if (paused) pausedAt = t; else clockStart = now() - t;
  }
  // optional ?t=SECONDS in the URL jumps straight to that point of the song (no power-on animation)
  const JUMP = parseFloat(new URLSearchParams(location.search).get("t"));
  function begin() {
    if (started) return;
    started = true;
    if (Number.isFinite(JUMP)) { clockStart = now() - JUMP; if (audio) audio.currentTime = JUMP; return; }
    clockStart = now() - startTime();
    $("crt").classList.add("boot");
  }
  window.seekTo = seek;
  addEventListener("keydown", e => {
    if (!started) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (audio) { audio.paused ? audio.play() : audio.pause(); }
      else if (paused) { clockStart = now() - pausedAt; paused = false; } else { pausedAt = songTime(); paused = true; }
    }
    if (e.code === "ArrowRight") seek(songTime() + 5);
    if (e.code === "ArrowLeft") seek(songTime() - 5);
    if (e.code === "KeyR") seek(startTime());
    if (e.code === "KeyF") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  });

  // ================= camera fx =================
  let trauma = 0, punch = 0, flash = 0, focus = 0, panX = 0, panTarget = 0, kbGlow = 0, beatAvg = 0, beatCool = 0;
  let bpmBoost = 0, bpmBase = 72, beatPhase = 0, flatlined = false, kcIsBase = true;
  const cam = { ...SHOTS.wide }; let shot = SHOTS.wide;
  function hit(amount, { zoom = 0, red = 0, blur = 0, slice = false, col = "255,40,30" } = {}) {
    trauma = Math.min(1, trauma + amount * SHAKE);
    punch = Math.max(punch, zoom * SHAKE);
    if (red > 0 && red >= flash) {
      root.setProperty("--fc", col);
      root.setProperty("--kc", col); kcIsBase = false;
      kbGlow = Math.max(kbGlow, red);
    }
    flash = Math.max(flash, red);
    focus = Math.max(focus, blur);
    if (slice) {                                   // slice-glitch only the line being typed
      const s = document.querySelector(".line.cur");
      if (s) { s.classList.remove("hit"); void s.offsetWidth; s.classList.add("hit"); }
    }
  }
  function lubDub(strength = 1) {
    punch = Math.max(punch, 0.012 * strength * SHAKE);
    setTimeout(() => { punch = Math.max(punch, 0.008 * strength * SHAKE); }, 170);
    const hb = $("hb"); hb.classList.remove("beat"); void hb.offsetWidth; hb.classList.add("beat");
  }
  function themeHit(kind) {
    const K = KINDS[kind];
    const soft = K.style === "glow";
    hit(K.amt ?? 0.4, { zoom: soft ? 0.015 : 0.03, red: K.flash ?? (soft ? 0.3 : 0.5), blur: soft ? 0.4 : 1.2, slice: K.slice ?? !soft, col: K.col });
    bpmBoost += K.bpm || 0;
    if (K.thump) { lubDub(2.5); setTimeout(() => lubDub(2), 420); }
    if (K.hearts) burstHearts(K.hearts);
  }
  function pickShot(i, L) {
    if (L.intro || L.blank) return { s: SHOTS.wide, cut: false };
    if (L.theme) return { s: hash(i, 5) < 0.5 ? SHOTS.close : SHOTS.dutch, cut: true };
    const pool = [SHOTS.standard, SHOTS.side, SHOTS.standard, SHOTS.wide, SHOTS.close];
    return { s: pool[Math.floor(hash(i, 6) * pool.length)], cut: false };
  }

  // ================= keyboard =================
  const ROWS = [
    ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", ["⌫", "w2"]],
    [["Tab", "w15"], "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", ["\\", "w15"]],
    [["Caps", "w2"], "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", ["Enter", "w2"]],
    [["Shift", "w25"], "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", ["Shift", "w25"]],
    [["Ctrl", "w15"], "Fn", "⊞", "Alt", ["", "sp"], "Alt", "Ctrl", "◀", "▼", "▶"],
  ];
  const keyEls = {};
  $("kb").innerHTML = ROWS.map(r => `<div class="row">${r.map(k => {
    const [label, cls] = Array.isArray(k) ? k : [k, ""];
    return `<div class="k ${cls}" data-k="${label === "" ? " " : escAttr(label)}">${esc(label)}</div>`;
  }).join("")}</div>`).join("");
  document.querySelectorAll(".k").forEach(el => { keyEls[el.dataset.k] = keyEls[el.dataset.k] || el; });
  const SHIFTED = { '"': "'", "(": "9", ")": "0", "{": "[", "}": "]", ":": ";", "_": "-", "!": "1", "$": "4", ">": ".", "*": "8", "+": "=" };
  function press(ch) {
    if (!ch) return;
    const named = ["⌫", "Enter"].includes(ch);
    const keys = [named ? ch : ch === " " ? " " : (SHIFTED[ch] || ch.toUpperCase())];
    if (!named && (SHIFTED[ch] || /[A-Z]/.test(ch))) keys.push("Shift");
    for (const k of keys) {
      const el = keyEls[k]; if (!el) continue;
      el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit");
      setTimeout(() => el.classList.remove("hit"), 110);
    }
  }

  // ================= autocomplete =================
  const ac = document.createElement("div"); ac.className = "ac";
  function showAC(lineEl, cursorEl, L, shown) {
    const tok = L.code.find(t => shown > t.start && shown <= t.start + t.s.length);
    if (!tok || !["str", "key", "fn"].includes(tok.c) || shown >= tok.start + tok.s.length) return hideAC();
    const local = shown - tok.start;
    const typed = tok.s.slice(0, local).split(/[_"\s]/).pop();
    const rest = tok.s.slice(local).split(/[_"\s]/)[0];
    if (typed.length < 2 || !rest) return hideAC();
    const word = typed + rest;
    const seed = Math.floor(hash(L.t, tok.start) * DECOYS.length);
    const pool = DECOYS.filter(d => d[0] === word[0] && d !== word);
    const d1 = pool[seed % Math.max(1, pool.length)] || DECOYS[seed];
    const d2 = DECOYS[(seed + 7) % DECOYS.length];
    ac.innerHTML =
      `<div class="it sel"><i>abc</i><span><b>${esc(typed)}</b>${esc(rest)}</span><span class="ty">${tok.c === "fn" ? "method" : "string"}</span></div>` +
      `<div class="it"><i>ƒ</i><span>${esc(d1)}</span><span class="ty">fn</span></div>` +
      `<div class="it"><i>◇</i><span>${esc(d2)}</span><span class="ty">var</span></div>`;
    ac.style.left = (cursorEl.offsetLeft - typed.length * cursorEl.offsetWidth * 0.98) + "px";
    if (ac.parentNode !== lineEl) lineEl.appendChild(ac);
  }
  function hideAC() { if (ac.parentNode) ac.remove(); }

  // ================= minimap =================
  const MINI = { obj: COLORS.accent, fn: "#d8d8dc", pu: "#4a4e56", str: "#cfc4a8", key: "#6f9cff", cm: "#56804a", kw: "#a77fd0" };
  function drawMini(idx) {
    let html = "";
    for (let i = 0; i <= idx && i < lines.length; i++) {
      html += `<div class="mrow">${lines[i].code.map(t => `<i style="width:${Math.min(100, t.s.length * 1.6)}%;background:${MINI[t.c]}"></i>`).join("")}</div>`;
    }
    $("miniRows").innerHTML = html;
    $("miniView").style.top = Math.max(0, idx - 5) * 7 + "px";
  }

  // ================= ending =================
  // END.mood "sad": color drains, heart slows to a stop, fade out.
  // END.mood "happy": warm glow, steady heart, hearts float up, fade out.
  let endE = null;
  const endShown = {};
  function renderEnding(t) {
    const e = t - (last + 1.6);
    const term = $("term");
    if (e < 0) {
      endE = null;
      if (term.style.display !== "none") {
        term.style.display = "none"; term.innerHTML = ""; flatlined = false;
        $("editor").classList.remove("over"); $("crt").classList.remove("off"); $("hb").classList.remove("dead");
        $("probs").innerHTML = PROBLEMS;
        fired.forEach(f => f.startsWith("end") && fired.delete(f));
        for (const k in endShown) delete endShown[k];
      }
      return;
    }
    endE = e;
    term.style.display = "block";
    $("editor").classList.add("over");
    let html = "", active = -1;
    END.script.forEach((row, r) => { if (e >= row.at) active = r; });
    END.script.forEach((row, r) => {
      if (e < row.at) return;
      const text = row.print ?? row.type ?? "";
      let n = text.length, moving = false;
      if (row.type !== undefined) {
        const el = e - row.at;
        n = Math.min(text.length, Math.floor(el * (row.cps || 10)));
        moving = n < text.length;
        if (row.erase) {
          const eraseStart = text.length / row.cps + row.erase.after;
          if (el > eraseStart) { n = Math.max(0, text.length - Math.floor((el - eraseStart) * row.erase.cps)); moving = n > 0; }
        }
        const prev = endShown[r] ?? 0;
        if (n !== prev) { press(n > prev ? text[n - 1] : "⌫"); endShown[r] = n; }
        if (!row.erase && text.length && n === text.length && !fired.has("endEnter" + r)) { fired.add("endEnter" + r); press("Enter"); }
      }
      const dead = END.mood === "sad" && e > END.heartStops;
      const body = `<span class="${row.cls || ""}">${esc(text.slice(0, n))}</span>`;
      const cursor = r === active ? `<span class="cursor${moving ? "" : " blink"}${dead ? " dead" : ""}"></span>` : "";
      html += (row.prompt ? '<span class="p">$</span> ' : "") + body + cursor + "\n";
      if (row.hit && !fired.has("end" + r)) {
        fired.add("end" + r);
        hit(row.hit.amt ?? 0.25, { red: row.hit.red ?? 0.3, blur: 1, col: row.hit.col || "200,40,50" });
        if (row.status) $("probs").innerHTML = row.status;
        if (row.hearts) burstHearts(row.hearts);
      }
    });
    term.innerHTML = html;
    if (e > END.powerOffAt && !fired.has("off")) { fired.add("off"); $("crt").classList.add("off"); }
  }

  // ================= dust + hearts (canvas in front of the lens) =================
  const dc = $("dust"), dx = dc.getContext("2d");
  let DW = 0, DH = 0;
  const specks = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), r: 2 + Math.random() * 9, a: .025 + Math.random() * .08, vx: (Math.random() - .5) * .008, vy: -.004 - Math.random() * .01 }));
  const hearts = [];
  function sizeDust() { const d = Math.min(2, devicePixelRatio || 1); DW = innerWidth; DH = innerHeight; dc.width = DW * d; dc.height = DH * d; dx.setTransform(d, 0, 0, d, 0, 0); }
  addEventListener("resize", sizeDust); sizeDust();
  function spawnHeart(burst) {
    hearts.push({ x: burst ? .3 + Math.random() * .4 : Math.random(), y: burst ? .5 + Math.random() * .1 : 1.05,
      s: 10 + Math.random() * 22, vy: -(.04 + Math.random() * .06), sway: Math.random() * 6, age: 0, life: 6 + Math.random() * 4, blur: Math.random() < .5 });
  }
  function burstHearts(n) { for (let i = 0; i < n; i++) spawnHeart(true); }
  function heartPath(X, Y, s) {
    dx.beginPath(); dx.moveTo(X, Y + s * .35);
    dx.bezierCurveTo(X - s, Y - s * .3, X - s * .45, Y - s, X, Y - s * .45);
    dx.bezierCurveTo(X + s * .45, Y - s, X + s, Y - s * .3, X, Y + s * .35); dx.fill();
  }
  function drawDust(dt, T) {
    dx.clearRect(0, 0, DW, DH);
    for (const p of specks) {
      p.x = (p.x + p.vx * dt + 1) % 1; p.y = (p.y + p.vy * dt + 1) % 1;
      const X = p.x * DW, Y = p.y * DH, R = p.r * (1 + focus * .3);
      const g = dx.createRadialGradient(X, Y, 0, X, Y, R);
      g.addColorStop(0, `rgba(255,240,230,${p.a})`); g.addColorStop(1, "rgba(255,240,230,0)");
      dx.fillStyle = g; dx.beginPath(); dx.arc(X, Y, R, 0, Math.PI * 2); dx.fill();
    }
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.age += dt; h.y += h.vy * dt;
      if (h.age > h.life || h.y < -.1) { hearts.splice(i, 1); continue; }
      const a = Math.min(1, h.age / 1.2) * Math.min(1, (h.life - h.age) / 1.5);
      dx.save();
      dx.filter = h.blur ? "blur(3px)" : "none";
      dx.fillStyle = `rgba(255,${130 + Math.round(h.sway * 10)},170,${(a * .85).toFixed(3)})`;
      heartPath(h.x * DW + Math.sin(T * .8 + h.sway) * 18, h.y * DH, h.s);
      dx.restore();
    }
  }

  // ================= main loop =================
  let curIdx = -2, lineH = 0, lastFrame = now(), heartTimer = 0;
  function indexAt(t) { let idx = -1; for (let i = 0; i < lines.length; i++) { if (lines[i].t <= t) idx = i; else break; } return idx; }
  function stepAt(L, el) { let s = -1; while (s + 1 < L.steps.length && L.steps[s + 1].t <= el) s++; return s; }

  function frame() {
    const T = now(), dt = Math.min(0.25, T - lastFrame); lastFrame = T;

    if (started && lines.length) {
      const t = songTime();
      if (t < lastT - 0.05) {                         // seeked backwards: reset
        fired.clear(); rendered = rendered.map(() => "");
        lines.forEach((_, i) => { $("L" + i).querySelector(".code").innerHTML = ""; });
        $("crt").classList.remove("off");
      }
      lastT = t;
      const idx = indexAt(t);
      if (!lineH) lineH = $("L0").offsetHeight;

      if (idx !== curIdx) {
        const forward = idx > curIdx;
        curIdx = idx;
        $("lines").style.transform = `translateY(${-Math.max(0, idx) * lineH}px)`;
        lines.forEach((_, i) => {
          const el = $("L" + i), d = idx - i;
          el.classList.toggle("cur", d === 0);
          if (d < 0) { el.style.opacity = 0; return; }
          el.style.opacity = d === 0 ? 1 : Math.max(0, .6 - d * .13);
          el.style.filter = d === 0 ? "none" : `blur(${Math.min(7, d * 1.7)}px)`;
        });
        hideAC(); drawMini(idx);
        if (idx >= 0) {
          const pick = pickShot(idx, lines[idx]);
          shot = pick.s;
          if (pick.cut && forward) Object.assign(cam, shot);
          if (forward) { press("Enter"); hit(lines[idx].blank ? 0.08 : 0.22, { zoom: 0.012, blur: pick.cut ? 5 : 3 }); }
        }
      }

      for (let i = 0; i <= idx; i++) {
        const L = lines[i];
        const typing = i === idx;
        const si = i < idx ? L.steps.length - 1 : stepAt(L, t - L.t);
        const st = si >= 0 ? L.steps[si] : { n: 0, wrong: null };
        const done = st.n >= L.len && !st.wrong;
        const state = si + (typing ? (done ? "b" : "c") : "");
        if (rendered[i] === state) continue;
        rendered[i] = state;
        const lineEl = $("L" + i), codeEl = lineEl.querySelector(".code");
        codeEl.innerHTML = codeHTML(L, st.n, typing ? st.wrong : null) + (typing ? `<span class="cursor${done ? " blink" : ""}"></span>` : "");
        if (!typing) continue;

        const stamp = i + ":" + si;
        if (si >= 0 && stamp !== lastKey) {
          lastKey = stamp;
          press(st.key);
          hit(st.key === "⌫" ? 0.08 : 0.025);
          L.code.forEach((tok, ti) => {
            const id = i + "g" + ti;
            if (tok.kind && st.n > tok.start && !fired.has(id)) { fired.add(id); themeHit(tok.kind); }
          });
        }
        $("pos").textContent = `Ln ${i + 1}, Col ${st.n + 1}`;
        const cur = codeEl.querySelector(".cursor");
        if (cur) {
          const x = codeEl.offsetLeft + cur.offsetLeft;
          const W = innerWidth, originX = W * 0.30, edLeft = W * 0.07;
          const limitLocal = (W * 0.70 - originX) / cam.z + originX - edLeft;
          panTarget = Math.min(0, limitLocal - x);
          done || st.wrong ? hideAC() : showAC(lineEl, cur, L, st.n);
        }
      }
      if (idx < 0) panTarget = 0;
      renderEnding(t);

      if (analyser && audio && !audio.paused) {
        analyser.getByteFrequencyData(freq);
        let bass = 0; for (let b = 1; b < 12; b++) bass += freq[b]; bass /= 11 * 255;
        beatAvg += (bass - beatAvg) * Math.min(1, dt * 2.5);
        beatCool -= dt;
        if (bass > beatAvg * 1.18 && bass > 0.45 && beatCool <= 0) { beatCool = 0.28; hit(0.18, { zoom: 0.01 }); kbGlow = Math.max(kbGlow, .8); }
      }
    }

    const sadEnd = endE !== null && END.mood === "sad";
    const happyEnd = endE !== null && END.mood === "happy";

    // ---- heartbeat (sad ending: slows to a stop) ----
    bpmBoost *= Math.exp(-dt * (endE !== null ? 1.5 : 0.35));
    const life = !sadEnd ? 1 : Math.max(0, 1 - Math.max(0, endE - 2.4) / (END.heartStops - 2.4));
    flatlined = life <= 0;
    const bpm = flatlined ? 0 : (bpmBase + bpmBoost + (happyEnd ? 6 : 0)) * (0.35 + 0.65 * life);
    $("bpm").textContent = Math.round(bpm);
    $("hb").classList.toggle("dead", flatlined);
    if (started && !flatlined && !paused) { beatPhase += dt * bpm / 60; if (beatPhase >= 1) { beatPhase -= 1; lubDub(0.25 + 0.75 * life); } }

    // happy ending: hearts drift up
    if (happyEnd && endE > 2.5 && endE < END.fadeAt + 1) { heartTimer -= dt; if (heartTimer <= 0) { heartTimer = .18; spawnHeart(false); } }

    // ---- camera ----
    trauma = Math.max(0, trauma - dt * 1.5);
    punch *= Math.exp(-dt * 7);
    flash = Math.max(0, flash - dt * 3.2);
    focus = Math.max(0, focus - dt * 9);
    kbGlow = Math.max(0, kbGlow - dt * 2.5);
    if (kbGlow < 0.05 && !kcIsBase) { root.setProperty("--kc", COLORS.keys); kcIsBase = true; }
    panX += (panTarget - panX) * Math.min(1, dt * 7);
    if (endE !== null) shot = sadEnd ? SHOTS.far : SHOTS.warm;
    const k = 1 - Math.exp(-dt * (endE !== null ? 0.3 : 2.2));
    for (const p in cam) cam[p] += (shot[p] - cam[p]) * k;
    const mood = endE === null ? 0 : Math.min(1, endE / 9);
    const fade = endE === null ? 0 : Math.min(1, Math.max(0, (endE - END.fadeAt) / 3));

    const s = trauma * trauma, ST = T * 28;
    const x = noise(T * 0.35, 4) * 7 + noise(ST, 1) * 30 * s;
    const y = noise(T * 0.3, 5) * 6 + noise(ST, 2) * 22 * s;
    const r = noise(T * 0.25, 6) * 0.5 + noise(ST, 3) * 2.2 * s;
    const world = $("world");
    world.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg) scale(${1 + punch})`;
    const ca = (s * 9).toFixed(1);
    const moodF = !mood ? "" : sadEnd
      ? ` grayscale(${(mood * .92).toFixed(2)}) brightness(${(1 - mood * .3).toFixed(2)})`
      : ` sepia(${(mood * .22).toFixed(2)}) saturate(${(1 + mood * .3).toFixed(2)}) brightness(${(1 + mood * .08).toFixed(2)})`;
    world.style.filter = (s > 0.01 ? `drop-shadow(${ca}px 0 0 rgba(255,0,50,.45)) drop-shadow(-${ca}px 0 0 rgba(0,220,255,.4)) blur(${(s * 1.6).toFixed(2)}px)` : "") + moodF || "none";
    $("kbWrap").style.opacity = sadEnd ? 1 - Math.min(1, Math.max(0, (endE - 4) / 6)) * 0.9 : 1;
    $("tilt").style.transform = `translate(${cam.x}vw, ${cam.y}vh) scale(${cam.z}) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) rotateZ(${cam.rz}deg)`;
    $("glare").style.transform = `translateX(${noise(T * .2, 9) * 4 + cam.ry * .6}%)`;
    $("editor").style.transform = `translateX(${panX}px)`;
    $("editor").style.filter = focus > 0.05 ? `blur(${focus}px)` : "none";
    $("flash").style.opacity = flash;
    $("dim").style.opacity = Math.min(0.92, 0.03 + Math.abs(noise(T * 9, 8)) * 0.05 + fade * 0.8);
    root.setProperty("--kbGlow", (0.16 + kbGlow * 0.3).toFixed(3));
    drawDust(dt, T);

    requestAnimationFrame(frame);
  }

  loadLyrics();
  requestAnimationFrame(frame);
})();

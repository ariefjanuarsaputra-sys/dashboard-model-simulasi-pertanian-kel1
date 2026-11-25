/* ============================================================================
 * growth.js — TIMELAPSE PERTUMBUHAN BUNCIS (data-driven dari hasil simulasi)
 * Canvas 2D satu loop rAF. Atas: cuaca & tajuk (hujan/panas mengikuti skenario
 * aktif). Bawah: penampang tanah — lapisan olah, ZONA PERAKARAN (Zr 30 cm),
 * garis KL & TLP, kelembapan (KAT), akar, dan perkolasi. Fase sinkron dgn model.
 * ========================================================================== */
"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const cv = $("growthCanvas"), ctx = cv.getContext("2d");
  const KL = 0.38, TLP = 0.15, ZR_CM = 30, SOIL_CM = 60;
  const HST_PER_SEC = 0.55;
  const FASE_NAMA = ["Perkecambahan", "Vegetatif aktif", "Pembungaan", "Pengisian polong", "Pemasakan"];
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, groundY = 0, running = false;
  let rows = [], maxHst = 53, phaseStart = [1, 1, 1, 1, 1];
  let maxDaun = 1, maxBatang = 1, maxAkar = 1, maxPolong = 1;
  let hst = 1, playing = true, speed = 2, lastInt = -1;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function mix(c1, c2, k) {
    const p = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const a = p(c1), b = p(c2);
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(",")})`;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    groundY = Math.round(H * 0.5);
    cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function load() {
    let res = null;
    try { res = (state.aktifIdx >= 8 ? state.custom && state.custom.res : state.hasil[state.aktifIdx]); } catch (e) { }
    if (!res || !res.harian || !res.harian.length) { rows = []; return false; }
    rows = res.harian;
    maxHst = rows.length;
    maxDaun = Math.max(0.001, ...rows.map(r => r.Daun || 0));
    maxBatang = Math.max(0.001, ...rows.map(r => r.Batang || 0));
    maxAkar = Math.max(0.001, ...rows.map(r => r.Akar || 0));
    maxPolong = Math.max(0.001, ...rows.map(r => r.Polong || 0));
    phaseStart = [1, 1, 1, 1, 1];
    for (const r of rows) { const f = +r.Fase.slice(-1); if (f >= 1 && f <= 5 && phaseStart[f - 1] === 1) phaseStart[f - 1] = r.HST; }
    try { $("tumbuhSken").textContent = state.aktifIdx >= 8 ? `Kustom ΔT=${state.custom.dT}°C · CH×${state.custom.fCH}` : state.ringkas[state.aktifIdx].Skenario; } catch (e) { }
    buildControls();
    hst = 1; lastInt = -1;
    return true;
  }

  function buildControls() {
    $("gFase").innerHTML = FASE_NAMA.map((n, i) => {
      const a = phaseStart[i], b = i < 4 ? Math.max(a, phaseStart[i + 1] - 1) : maxHst;
      return `<button class="gfase" data-f="${i + 1}">${i + 1}. ${n} <span class="num">HST ${a}–${b}</span></button>`;
    }).join("");
    $("gFase").querySelectorAll(".gfase").forEach(b => b.onclick = () => seek(phaseStart[+b.dataset.f - 1]));
    $("gLegend").innerHTML = [
      ["#4A2E1E", "Lapisan olah tanah (0–20 cm)"],
      ["rgba(149,213,178,.30)", "Zona perakaran · Zr = 30 cm (konstan)"],
      ["#38BDF8", "Kapasitas lapang (KL = 0,38 m³/m³)"],
      ["#F87171", "Titik layu permanen (TLP = 0,15 m³/m³)"],
      ["#0EA5E9", "Hujan (curah harian CH)"],
      ["#F59E0B", "Panas / terik (suhu udara)"],
      ["#22C55E", "Perkolasi (air lolos ke lapisan bawah)"]
    ].map(([c, t]) => `<span class="lg"><i style="background:${c}"></i>${t}</span>`).join("");
    $("gScrub").max = maxHst;
    $("gScrub").value = 1;
  }

  function cur() {
    const i0 = clamp(Math.floor(hst) - 1, 0, rows.length - 1);
    const i1 = clamp(i0 + 1, 0, rows.length - 1);
    const k = clamp(hst - Math.floor(hst), 0, 1);
    const a = rows[i0], b = rows[i1];
    const L = key => lerp(a[key] || 0, b[key] || 0, k);
    return {
      suhu: L("Suhu"), ch: L("CH"), kat: L("KAT"), wdf: L("WDF"), lai: L("LAI"),
      daun: L("Daun"), batang: L("Batang"), akar: L("Akar"), polong: L("Polong"),
      fase: +rows[i1].Fase.slice(-1), tgl: rows[i1].Tanggal, hstInt: Math.round(hst)
    };
  }

  function seek(h) { hst = clamp(h, 1, maxHst); lastInt = -1; }

  function sky(c) {
    const heat = clamp((c.suhu - 21) / 9, 0, 1);
    const rain = clamp(c.ch / 12, 0, 1);
    const g = ctx.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, rain > .05 ? mix("#94A3B8", "#0EA5E9", 1 - rain) : mix("#7DD3FC", "#F59E0B", heat * .75));
    g.addColorStop(1, rain > .05 ? "#CBD5E1" : mix("#BAE6FD", "#FDE68A", heat * .8));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, groundY);
  }
  function sun(c, t) {
    const heat = clamp((c.suhu - 21) / 9, 0, 1);
    const rain = clamp(c.ch / 12, 0, 1);
    const sx = W * .8, sy = groundY * .3, r = 20 + heat * 9;
    const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, H * .34);
    glow.addColorStop(0, `rgba(253,230,138,${Math.max(0, .85 - rain * .6)})`);
    glow.addColorStop(1, "rgba(245,158,11,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, groundY);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * .04);
    ctx.fillStyle = `rgba(253,230,138,${Math.max(0, .12 - rain * .07)})`;
    for (let i = 0; i < 10; i++) { ctx.rotate(Math.PI / 5); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(H * .3, -10); ctx.lineTo(H * .3, 10); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = mix("#FDE68A", "#FDBA74", heat); ctx.beginPath(); ctx.arc(sx, sy, r + Math.sin(t * 1.3) * 2, 0, 7); ctx.fill();
  }
  function clouds(c, t) {
    const rain = clamp(c.ch / 12, 0, 1);
    const n = rain > .05 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const cw = 90 + i * 40, x = ((i * .41 + t * .006) % 1.25) * (W + cw * 2) - cw;
      const y = groundY * (.12 + (i % 3) * .12);
      ctx.globalAlpha = .5 + .5 * rain;
      ctx.fillStyle = "#F8FAFC";
      ctx.beginPath();
      ctx.ellipse(x, y, cw * .5, 18, 0, 0, 7);
      ctx.ellipse(x - cw * .25, y + 5, cw * .3, 14, 0, 0, 7);
      ctx.ellipse(x + cw * .26, y + 4, cw * .32, 15, 0, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function shimmer(c, t) {
    ctx.globalAlpha = .14;
    ctx.strokeStyle = "#FDE68A"; ctx.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const y = groundY - 6 - i * 7;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const yy = y + Math.sin(x * .03 + t * 2 + i) * 2.4;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function rain(c) {
    const a = clamp(c.ch / 10, 0, 1);
    if (a <= 0.02) return;
    ctx.strokeStyle = `rgba(125,211,252,${.15 + .5 * a})`;
    ctx.lineWidth = 1.3;
    const n = Math.round(30 + 90 * a);
    for (let i = 0; i < n; i++) {
      const x = (i * 61) % W, y = ((i * 53 + lastInt * 7) % 100) * groundY / 100;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2.2, y + 11); ctx.stroke();
    }
  }
  function soil(c, t) {
    const y0 = groundY, pxCm = (H - y0) / SOIL_CM, topH = 20 * pxCm;
    let g = ctx.createLinearGradient(0, y0, 0, y0 + topH);
    g.addColorStop(0, "#5B3A29"); g.addColorStop(1, "#4A2E1E");
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, topH);
    g = ctx.createLinearGradient(0, y0 + topH, 0, H);
    g.addColorStop(0, "#3E2A1A"); g.addColorStop(1, "#20130B");
    ctx.fillStyle = g; ctx.fillRect(0, y0 + topH, W, H - (y0 + topH));
    ctx.fillStyle = "rgba(240,229,213,.55)"; ctx.font = "10px 'Plus Jakarta Sans',sans-serif";
    ctx.fillText("lapisan olah tanah · 0–20 cm", 12, y0 + 14);
    const zrH = ZR_CM * pxCm;
    ctx.fillStyle = "rgba(149,213,178,.13)"; ctx.fillRect(0, y0, W, zrH);
    ctx.strokeStyle = "rgba(149,213,178,.7)"; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.2;
    ctx.strokeRect(.5, y0 + .5, W - 1, zrH - 1);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(209,250,229,.92)";
    ctx.fillText("ZONA PERAKARAN · Zr = 30 cm (konstan)", 12, y0 + zrH - 6);
    const wet = clamp(c.kat / KL, 0, 1);
    ctx.fillStyle = wet >= TLP / KL ? `rgba(56,189,248,${.08 + .26 * wet})` : `rgba(248,113,113,${.16 + .10 * (1 - wet / (TLP / KL))})`;
    ctx.fillRect(0, y0, W, zrH);
    if (c.ch > 4) {
      const a = clamp((c.ch - 4) / 16, 0, 1);
      ctx.strokeStyle = `rgba(34,197,94,${.3 + .5 * a})`; ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) {
        const x = W * (.3 + i * .15), yy = y0 + zrH + 8 + ((t * .6 + i) % 1) * 16;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy + 9);
        ctx.moveTo(x - 3, yy + 6); ctx.lineTo(x, yy + 9); ctx.lineTo(x + 3, yy + 6); ctx.stroke();
      }
    }
  }
  function roots(c, t) {
    const y0 = groundY, pxCm = (H - y0) / SOIL_CM;
    const reach = clamp(c.akar / maxAkar, 0, 1);
    const maxDepth = ZR_CM * pxCm * reach;
    const x0 = W * .5;
    ctx.strokeStyle = "rgba(214,199,164,.75)"; ctx.lineWidth = 1.5;
    for (let r = 0; r < 6; r++) {
      const ang = (r - 2.5) * .28, len = maxDepth * (1 - Math.abs(ang) * .5);
      ctx.beginPath(); ctx.moveTo(x0, y0 + 2);
      ctx.quadraticCurveTo(x0 + ang * 40, y0 + len * .55, x0 + ang * 78 + Math.sin(t + r) * 2, y0 + len);
      ctx.stroke();
    }
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(214,199,164,.5)";
    for (let r = 0; r < 4; r++) {
      const ang = (r - 1.5) * .3;
      ctx.beginPath(); ctx.moveTo(x0 + ang * 30, y0 + maxDepth * .4);
      ctx.quadraticCurveTo(x0 + ang * 52, y0 + maxDepth * .7, x0 + ang * 66, y0 + maxDepth * .85);
      ctx.stroke();
    }
  }
  function leaf(x, y, ang, len, col) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const grd = ctx.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, col); grd.addColorStop(1, "#95D5B2");
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * .35, -len * .34, len * .8, -len * .26, len, 0);
    ctx.bezierCurveTo(len * .8, len * .26, len * .35, len * .34, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  function plant(c, t) {
    const y0 = groundY, x = W * .5;
    const batang = clamp(c.batang / maxBatang, 0, 1);
    const daun = clamp(c.daun / maxDaun, 0, 1);
    const polong = clamp(c.polong / maxPolong, 0, 1);
    const hgt = lerp(4, H * .34, batang);
    const topX = x + Math.sin(t * 1.1) * 5 * Math.min(1, batang + .15), topY = y0 - hgt;
    if (hgt < 16) {
      ctx.fillStyle = "#D6C7A4"; ctx.beginPath(); ctx.ellipse(x, y0 - 3, 5.5, 3.8, .4, 0, 7); ctx.fill();
      if (hgt > 3) {
        ctx.strokeStyle = "#2D6A4F"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y0 - 3); ctx.lineTo(topX, topY); ctx.stroke();
        leaf(topX, topY, -1.2, 8, "#74C69D"); leaf(topX, topY, 2.0, 8, "#74C69D");
      }
      return;
    }
    ctx.strokeStyle = "#2D6A4F"; ctx.lineCap = "round";
    for (let s = 0; s < 14; s++) {
      const k0 = s / 14, k1 = (s + 1) / 14;
      ctx.lineWidth = lerp(5, 1.4, k0);
      ctx.beginPath();
      ctx.moveTo(lerp(x, topX, k0 * k0), lerp(y0, topY, k0));
      ctx.lineTo(lerp(x, topX, k1 * k1), lerp(y0, topY, k1));
      ctx.stroke();
    }
    for (let i = 1; i <= 6; i++) {
      const f = i / 7, nx = lerp(x, topX, f * f), ny = lerp(y0, topY, f);
      const sw = Math.sin(t * 1.4 + i) * .1;
      const len = (22 + 12 * Math.sin(i * 2.1)) * Math.min(1, daun * 1.6 + .15);
      leaf(nx, ny, -.5 + sw, len, i % 2 ? "#40916C" : "#2D6A4F");
      leaf(nx, ny, Math.PI + .5 + sw, len * .9, i % 2 ? "#2D6A4F" : "#40916C");
      if (c.fase === 3 && f > .4) {
        for (let p = 0; p < 5; p++) {
          const a = p / 5 * Math.PI * 2 + t * .2;
          ctx.fillStyle = "#FEF3C7"; ctx.beginPath();
          ctx.ellipse(nx + Math.cos(a) * 5, ny - 5 + Math.sin(a) * 5, 3.8, 2.2, a, 0, 7); ctx.fill();
        }
        ctx.fillStyle = "#F59E0B"; ctx.beginPath(); ctx.arc(nx, ny - 5, 2.2, 0, 7); ctx.fill();
      }
      if (c.fase >= 4 && f > .45 && polong > .02) {
        const ripe = c.fase >= 5 ? clamp((hst - phaseStart[4]) / 8, 0, 1) : 0;
        ctx.save(); ctx.translate(nx + 3, ny - 2); ctx.rotate(1.25 + Math.sin(t * 1.7 + i * 1.3) * .1); ctx.scale(polong, polong);
        const pg = ctx.createLinearGradient(0, 0, 0, 26);
        pg.addColorStop(0, mix("#40916C", "#EAB308", ripe)); pg.addColorStop(1, mix("#74C69D", "#FDE68A", ripe));
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.bezierCurveTo(6, 7, 6, 21, 2, 27);
        ctx.bezierCurveTo(-3, 21, -3, 7, 0, 0); ctx.fill();
        ctx.restore();
      }
    }
    leaf(topX, topY, -1.2 + Math.sin(t * 1.3) * .1, 16 * Math.min(1, daun * 1.4 + .2), "#74C69D");
    leaf(topX, topY, -1.9 + Math.sin(t * 1.3 + 1) * .1, 12 * Math.min(1, daun * 1.4 + .2), "#95D5B2");
  }
  function gauge(c) {
    const y0 = groundY + 8, gy1 = H - 30, gx = Math.max(W - 84, 200), gw = 10;
    ctx.fillStyle = "rgba(11,31,23,.5)"; ctx.fillRect(gx - 2, y0 - 2, gw + 4, (gy1 - y0) + 4);
    ctx.fillStyle = "rgba(148,163,184,.45)"; ctx.fillRect(gx, y0, gw, gy1 - y0);
    const kCat = clamp(c.kat / KL, 0, 1), yKat = gy1 - kCat * (gy1 - y0);
    ctx.fillStyle = "#38BDF8"; ctx.fillRect(gx, yKat, gw, gy1 - yKat);
    const yTLP = gy1 - (TLP / KL) * (gy1 - y0);
    ctx.strokeStyle = "#F87171"; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(gx - 6, yTLP); ctx.lineTo(gx + gw + 6, yTLP); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#7DD3FC"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(gx - 6, y0); ctx.lineTo(gx + gw + 6, y0); ctx.stroke();
    ctx.font = "bold 10px 'Plus Jakarta Sans',sans-serif";
    ctx.fillStyle = "#E2E8F0"; ctx.fillText("KL 0.38", gx + gw + 8, y0 + 4);
    ctx.fillStyle = "#FCA5A5"; ctx.fillText("TLP 0.15", gx + gw + 8, yTLP + 4);
    ctx.fillStyle = "#BAE6FD"; ctx.fillText("KAT " + c.kat.toFixed(2), gx + gw + 8, Math.min(yKat + 4, gy1 - 2));
  }
  function draw(c, t) {
    ctx.clearRect(0, 0, W, H);
    sky(c); sun(c, t); clouds(c, t);
    if (c.ch < .5 && c.suhu > 26) shimmer(c, t);
    soil(c, t); roots(c, t); plant(c, t); rain(c); gauge(c);
    ctx.strokeStyle = "rgba(11,31,23,.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();
  }
  function drawEmpty() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0B1F17"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#94A3B8"; ctx.font = "13px 'Plus Jakarta Sans',sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Belum ada hasil simulasi — jalankan simulasi dulu di panel kiri.", W / 2, H / 2);
    ctx.textAlign = "start";
  }
  function updateReadout(c) {
    if (c.hstInt === lastInt) return;
    lastInt = c.hstInt;
    $("gHst").textContent = `HST ${c.hstInt} / ${maxHst} · ${c.tgl}`;
    $("gBaca").innerHTML = [
      ["Suhu", c.suhu.toFixed(1) + " °C"],
      ["Curah hujan", c.ch.toFixed(1) + " mm"],
      ["KAT", c.kat.toFixed(2) + " m³/m³"],
      ["WDF", c.wdf.toFixed(2)],
      ["Fase", c.fase + " · " + FASE_NAMA[c.fase - 1]]
    ].map(([k, v]) => `<span class="gbaca">${k} <b>${v}</b></span>`).join("");
    $("gScrub").value = hst;
    $("gFase").querySelectorAll(".gfase").forEach(b => b.classList.toggle("aktif", +b.dataset.f === c.fase));
  }
  function frame(now) {
    if (!running) return;
    if (!last) last = now;
    const dt = Math.min(120, now - last); last = now;
    const vis = !$("tabTumbuh").classList.contains("hidden");
    if (vis && cv.clientWidth && cv.clientHeight) {
      if (cv.clientWidth !== W || cv.clientHeight !== H) resize();
      if (rows.length) {
        if (playing && !reduce) { hst += dt / 1000 * speed * HST_PER_SEC; if (hst > maxHst) hst = 1; }
        const c = cur();
        draw(c, now / 1000);
        updateReadout(c);
      } else drawEmpty();
    }
    raf = requestAnimationFrame(frame);
  }

  $("gPlay").onclick = () => { playing = !playing; $("gPlay").textContent = playing ? "⏸ Jeda" : "▶ Putar"; };
  $("gRestart").onclick = () => { seek(1); playing = true; $("gPlay").textContent = "⏸ Jeda"; };
  document.querySelectorAll(".gspd").forEach(b => b.onclick = () => {
    speed = +b.dataset.s;
    document.querySelectorAll(".gspd").forEach(x => x.classList.toggle("on", x === b));
  });
  $("gScrub").oninput = () => seek(+$("gScrub").value);

  if (reduce) playing = false;
  const ok = load();
  if (cv.clientWidth && cv.clientHeight) {
    resize();
    if (ok) { const c = cur(); draw(c, performance.now() / 1000); updateReadout(c); }
    else drawEmpty();
  }
  last = 0; running = true; raf = requestAnimationFrame(frame);

  window.Growth = {
    refresh() {
      if (load()) {
        if (cv.clientWidth && cv.clientHeight) { resize(); const c = cur(); draw(c, performance.now() / 1000); updateReadout(c); }
      }
    },
    play() { playing = true; $("gPlay").textContent = "⏸ Jeda"; },
    pause() { playing = false; $("gPlay").textContent = "▶ Putar"; }
  };
})();

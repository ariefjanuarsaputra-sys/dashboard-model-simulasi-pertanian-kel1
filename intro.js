/* ============================================================================
 * INTRO SINEMATIK — animasi prosedural siklus buncis (canvas 2D, satu loop rAF)
 * Fase visual mengikuti fenologi model: perkecambahan → vegetatif → bunga →
 * pengisian polong → pemasakan. Paralaks pointer, hujan terjadwal, dew glow.
 * ========================================================================== */
"use strict";
(function () {
  const cv = document.getElementById("introCanvas");
  const ctx = cv.getContext("2d");
  const overlay = document.getElementById("intro");
  const chip = document.getElementById("phaseChip");
  let W = 0, H = 0, dpr = 1, raf = 0, t0 = 0, running = false;
  let px = 0, py = 0, tx = 0, ty = 0;           // paralaks halus
  const drops = [], splash = [], pollen = [], stars = [];
  const PHASES = [[0.06, "Fase 1 · Perkecambahan"], [0.34, "Fase 2 · Vegetatif aktif"],
                  [0.55, "Fase 3 · Pembungaan"], [0.80, "Fase 4 · Pengisian polong"],
                  [0.97, "Fase 5 · Pemasakan · siap panen"]];
  let phaseIdx = -1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = overlay.clientWidth; H = overlay.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seed() {
    drops.length = 0; splash.length = 0; pollen.length = 0; stars.length = 0;
    for (let i = 0; i < 130; i++) drops.push({ x: Math.random() * 1.2 - .1, y: Math.random(), v: .9 + Math.random() * .7, l: 10 + Math.random() * 14 });
    for (let i = 0; i < 42; i++) pollen.push({ x: Math.random(), y: .25 + Math.random() * .6, r: 1 + Math.random() * 2.2, p: Math.random() * 7, s: .3 + Math.random() * .8, hue: Math.random() < .5 });
    for (let i = 0; i < 70; i++) stars.push({ x: Math.random(), y: Math.random() * .55, r: Math.random() * 1.3 + .3, p: Math.random() * 7 });
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  function mix(c1, c2, k) {
    const p = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const a = p(c1), b = p(c2);
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(",")})`;
  }

  function sky(k, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix("#151238", "#38BDF8", k));
    g.addColorStop(.55, mix("#4C1D95", "#7DD3FC", k));
    g.addColorStop(.82, mix("#F59E0B", "#E0F2FE", k));
    g.addColorStop(1, mix("#7C2D12", "#BAE6FD", k));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // bintang memudar
    const sa = (1 - k) * .9;
    if (sa > .02) for (const s of stars) {
      ctx.globalAlpha = sa * (.4 + .6 * Math.abs(Math.sin(t * .8 + s.p)));
      ctx.fillStyle = "#F8FAFC"; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function sun(k, t) {
    const sx = W * .76 + px * 12, sy = lerp(H * .80, H * .20, ease(k)) + py * 8;
    const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, H * .42);
    glow.addColorStop(0, "rgba(253,230,138,.95)");
    glow.addColorStop(.25, "rgba(245,158,11,.35)");
    glow.addColorStop(1, "rgba(245,158,11,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * .05);
    ctx.fillStyle = "rgba(253,230,138,.10)";
    for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(H * .5, -14); ctx.lineTo(H * .5, 14); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = "#FDE68A"; ctx.beginPath(); ctx.arc(sx, sy, 26 + 3 * Math.sin(t * 1.4), 0, 7); ctx.fill();
    ctx.fillStyle = "#FFFBEB"; ctx.beginPath(); ctx.arc(sx - 6, sy - 6, 12, 0, 7); ctx.fill();
  }
  function clouds(t, k) {
    const layers = [[.10, .16, 1.0, .55], [.22, .10, .7, .4], [.34, .06, .5, .3]];
    for (const [yy, sp, sc, al] of layers) {
      for (let i = 0; i < 3; i++) {
        const cw = 190 * sc, x = ((i * .37 + t * sp * .02 + px * .02 * sc) % 1.3) * (W + cw * 2) - cw;
        const y = H * yy + py * 10 * sc + Math.sin(t * .3 + i) * 6;
        ctx.globalAlpha = al * (.5 + .5 * k);
        ctx.fillStyle = mix("#312E81", "#FFFFFF", k);
        ctx.beginPath();
        ctx.ellipse(x, y, cw * .5, 22 * sc, 0, 0, 7);
        ctx.ellipse(x - cw * .25, y + 6 * sc, cw * .3, 16 * sc, 0, 0, 7);
        ctx.ellipse(x + cw * .28, y + 5 * sc, cw * .32, 17 * sc, 0, 0, 7);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  function hills(k) {
    const layers = [["#14532D", .62, 26, .35], ["#1B4332", .70, 18, .6], ["#2D6A4F", .78, 12, 1]];
    for (const [col, yy, amp, par] of layers) {
      ctx.fillStyle = mix("#0B1F17", col, .35 + .65 * k);
      ctx.beginPath(); ctx.moveTo(-40, H);
      for (let x = -40; x <= W + 40; x += 24) {
        const y = H * yy + Math.sin(x * .006 + yy * 9) * amp + Math.sin(x * .017) * amp * .4 + px * 14 * par;
        ctx.lineTo(x, y + py * 6 * par);
      }
      ctx.lineTo(W + 40, H); ctx.fill();
    }
  }
  function soil(g, t) {
    const y0 = H * .82;
    const gso = ctx.createLinearGradient(0, y0, 0, H);
    gso.addColorStop(0, "#4A3421"); gso.addColorStop(.4, "#332417"); gso.addColorStop(1, "#170F0A");
    ctx.fillStyle = gso; ctx.fillRect(0, y0, W, H - y0);
    ctx.fillStyle = "rgba(149,213,178,.14)";
    for (let i = 0; i < 60; i++) { const x = (i * 97 % W), y = y0 + 8 + (i * 53 % (H - y0 - 12)); ctx.fillRect(x, y, 2, 2); }
    // akar tumbuh ke bawah
    ctx.strokeStyle = "rgba(214,199,164,.5)"; ctx.lineWidth = 1.4;
    for (const bx of [W * .24, W * .78]) {
      for (let r = 0; r < 5; r++) {
        const len = g * (H - y0) * .8 * (1 - r * .13);
        ctx.beginPath(); ctx.moveTo(bx, y0 + 2);
        ctx.quadraticCurveTo(bx + (r - 2) * 22, y0 + len * .6, bx + (r - 2) * 40 + Math.sin(t + r) * 2, y0 + len);
        ctx.stroke();
      }
    }
  }
  function leaf(x, y, ang, len, k, col) {
    if (k <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(k, k);
    const grd = ctx.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, col); grd.addColorStop(1, "#95D5B2");
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * .35, -len * .34, len * .8, -len * .26, len, 0);
    ctx.bezierCurveTo(len * .8, len * .26, len * .35, len * .34, 0, 0);
    ctx.fill();
    ctx.strokeStyle = "rgba(11,31,23,.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(len * .92, 0); ctx.stroke();
    ctx.restore();
  }
  function plant(bx, g, t, sway, scale) {
    const y0 = H * .82, hgt = g * H * .46 * scale;
    if (hgt < 3) { // benih
      ctx.fillStyle = "#D6C7A4"; ctx.beginPath(); ctx.ellipse(bx, y0 - 3, 5, 3.4, .4, 0, 7); ctx.fill(); return;
    }
    const topX = bx + Math.sin(t * 1.1 + sway) * 10 * g, topY = y0 - hgt;
    ctx.strokeStyle = "#2D6A4F"; ctx.lineCap = "round";
    for (let s = 0; s < 14; s++) {
      const k0 = s / 14, k1 = (s + 1) / 14;
      ctx.lineWidth = lerp(6, 1.6, k0) * scale;
      const x0 = lerp(bx, topX, k0 * k0), y0s = lerp(y0, topY, k0);
      const x1 = lerp(bx, topX, k1 * k1), y1s = lerp(y0, topY, k1);
      ctx.beginPath(); ctx.moveTo(x0, y0s); ctx.lineTo(x1, y1s); ctx.stroke();
    }
    const nodes = 6;
    for (let i = 1; i <= nodes; i++) {
      const f = i / (nodes + 1);
      const unf = clamp((g - f * .8) * 5, 0, 1);
      if (unf <= 0) continue;
      const nx = lerp(bx, topX, f * f), ny = lerp(y0, topY, f);
      const sw = Math.sin(t * 1.4 + i + sway) * .12;
      const len = (34 + 16 * Math.sin(i * 2.1)) * scale * unf;
      leaf(nx, ny, -0.5 + sw + (i % 2 ? 0 : Math.PI * .02), len, unf, i % 2 ? "#40916C" : "#2D6A4F");
      leaf(nx, ny, Math.PI + 0.5 + sw, len * .92, unf, i % 2 ? "#2D6A4F" : "#40916C");
      // bunga lalu polong pada node atas
      if (f > .45 && g > .55) {
        const bloom = clamp((g - .55) * 6, 0, 1) * clamp(1 - (g - .72) * 5, 0, 1);
        if (bloom > 0) {
          ctx.globalAlpha = bloom;
          for (let p = 0; p < 5; p++) {
            const a = p / 5 * Math.PI * 2 + t * .2;
            ctx.fillStyle = "#FEF3C7"; ctx.beginPath();
            ctx.ellipse(nx + Math.cos(a) * 6, ny - 6 + Math.sin(a) * 6, 4.4, 2.6, a, 0, 7); ctx.fill();
          }
          ctx.fillStyle = "#F59E0B"; ctx.beginPath(); ctx.arc(nx, ny - 6, 2.6, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
        }
        const pod = clamp((g - .68) * 4, 0, 1);
        if (pod > 0) {
          const ripe = clamp((g - .9) * 8, 0, 1);
          const hang = Math.sin(t * 1.7 + i * 1.3) * .1;
          ctx.save(); ctx.translate(nx + 4, ny - 2); ctx.rotate(1.25 + hang); ctx.scale(pod, pod);
          const pg = ctx.createLinearGradient(0, 0, 0, 30 * scale);
          pg.addColorStop(0, mix("#40916C", "#EAB308", ripe)); pg.addColorStop(1, mix("#74C69D", "#FDE68A", ripe));
          ctx.fillStyle = pg;
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.bezierCurveTo(7 * scale, 8 * scale, 7 * scale, 24 * scale, 2 * scale, 32 * scale);
          ctx.bezierCurveTo(-3 * scale, 24 * scale, -3 * scale, 8 * scale, 0, 0); ctx.fill();
          ctx.fillStyle = "rgba(11,31,23,.25)";
          for (let b = 1; b < 4; b++) { ctx.beginPath(); ctx.arc(2 * scale, b * 8 * scale, 1.6 * scale, 0, 7); ctx.fill(); }
          ctx.restore();
        }
      }
    }
    // pucuk
    leaf(topX, topY, -1.2 + Math.sin(t * 1.3) * .1, 22 * scale * g, g, "#74C69D");
    leaf(topX, topY, -1.9 + Math.sin(t * 1.3 + 1) * .1, 18 * scale * g, g, "#95D5B2");
  }
  function rain(t) {
    const env = clamp((t - 4.6) / 1.2, 0, 1) * clamp((8.4 - t) / 1.4, 0, 1);
    if (env <= 0) return;
    ctx.strokeStyle = `rgba(125,211,252,${.55 * env})`; ctx.lineWidth = 1.4;
    const y0 = H * .82;
    for (const d of drops) {
      d.y += d.v * .022;
      if (d.y > 1) { d.y = -.05; d.x = Math.random() * 1.2 - .1; splash.push({ x: d.x * W, y: y0, r: 1, a: env }); }
      const x = d.x * W + px * 6, y = d.y * y0;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + d.l); ctx.stroke();
    }
    for (let i = splash.length - 1; i >= 0; i--) {
      const s = splash[i]; s.r += 1.1; s.a -= .04;
      if (s.a <= 0) { splash.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(186,230,253,${s.a})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * .3, 0, 0, 7); ctx.stroke();
    }
  }
  function motes(t, k) {
    for (const p of pollen) {
      const x = (p.x + Math.sin(t * .12 * p.s + p.p) * .04 + t * .004 * p.s) % 1;
      const y = p.y + Math.sin(t * .5 * p.s + p.p) * .03;
      const a = (.25 + .55 * Math.abs(Math.sin(t * p.s + p.p))) * (.4 + .6 * k);
      ctx.fillStyle = p.hue ? `rgba(253,230,138,${a})` : `rgba(149,213,178,${a})`;
      ctx.shadowColor = p.hue ? "#F59E0B" : "#74C69D"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x * W, y * H, p.r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  function frame(now) {
    if (!running) return;
    const t = (now - t0) / 1000;
    px = lerp(px, tx, .05); py = lerp(py, ty, .05);
    const k = ease(clamp(t / 6.5, 0, 1));                 // fajar → siang
    const g = ease(clamp((t - 1.1) / 10.5, 0, 1));       // pertumbuhan
    sky(k, t); sun(k, t); clouds(t, k); hills(k); soil(g, t);
    plant(W * .24 + px * 10, g, t, 0, 1);
    plant(W * .78 + px * 10, clamp(g * 1.06 - .04, 0, 1), t, 2.1, .82);
    rain(t); motes(t, k);
    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .95);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(5,15,10,.55)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    let pi = 0; for (let i = 0; i < PHASES.length; i++) if (g >= PHASES[i][0]) pi = i;
    if (pi !== phaseIdx) { phaseIdx = pi; chip.textContent = PHASES[pi][1]; }
    raf = requestAnimationFrame(frame);
  }
  function show() {
    overlay.style.display = "block"; overlay.classList.remove("leave");
    resize(); seed(); phaseIdx = -1; t0 = performance.now(); running = true;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function hide() {
    overlay.classList.add("leave"); running = false; cancelAnimationFrame(raf);
    setTimeout(() => { overlay.style.display = "none"; }, 850);
    window.dispatchEvent(new CustomEvent("intro-entered"));
  }
  window.addEventListener("resize", () => { if (running) resize(); });
  overlay.addEventListener("pointermove", e => {
    tx = (e.clientX / W - .5) * 2; ty = (e.clientY / H - .5) * 2;
  });
  document.getElementById("btnEnter").addEventListener("click", hide);
  document.getElementById("btnSkip").addEventListener("click", hide);
  window.Intro = { show, hide };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // frame statis matang, tanpa loop
    resize(); seed(); t0 = performance.now() - 12000; running = true;
    frame(performance.now()); running = false; cancelAnimationFrame(raf);
  } else show();
})();

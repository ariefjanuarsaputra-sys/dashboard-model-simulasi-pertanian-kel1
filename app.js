/* ============================================================================
 * APP.JS — UI dashboard, 8 skenario, grafik, tabel/ekspor, modul Open-Meteo
 * Mesin hitung tetap di sim_engine.js (port presisi Skenario_Iklim.R).
 * ========================================================================== */
"use strict";
const P_DEFAUL = defaultParams();
const state = {
  prep: null, params: JSON.parse(JSON.stringify(P_DEFAUL)),
  tglTanam: new Date(Date.UTC(2024, 2, 1)),
  hasil: [], ringkas: [], aktifIdx: 0, custom: null, uploadRows: null,
  fc: null, fcLoading: false
};
const CHARTS = {};
const WARN = 1e-12;
const $ = id => document.getElementById(id);

/* ---------------- util & feedback ---------------- */
function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast " + type; el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 450); }, 3600);
}
function pesan(msg, err) {
  const el = $("statusPesan"); el.textContent = msg;
  el.style.color = err ? "#DC2626" : "#2D6A4F";
}
function countUp(el) {
  const to = parseFloat(el.dataset.to), dec = +(el.dataset.dec || 0), suf = el.dataset.suf || "";
  const from = parseFloat(el.dataset.from || 0), t0 = performance.now(), dur = 750;
  function step(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = (from + (to - from) * e).toFixed(dec) + suf;
    if (k < 1) requestAnimationFrame(step); else el.dataset.from = to;
  }
  requestAnimationFrame(step);
}
function rowsBuiltin() {
  return WEATHER_DATA.map(r => ({ tgl: r[0], suhu: r[1], rh: r[2], ch: r[3], angin: r[4], ssrd_mj: r[5], lama: r[6] }));
}
function currentRows() {
  return document.querySelector("input[name=src]:checked").value === "builtin" ? rowsBuiltin() : (state.uploadRows || []);
}

/* ---------------- form parameter ---------------- */
const PARAM_GROUPS = [
  { judul: "Lokasi & Waktu", isi: [["Lat", "Lintang (°)", -90, 90], ["Alt", "Elevasi (mdpl)", 0, 5000], ["tinggi_angin", "Tinggi angin (m)", 0.2, 25]] },
  { judul: "Fisiologi Tanaman", isi: [["k", "Koef. pemadaman", 0, 2], ["sla", "SLA (cm²/g)", 50, 500], ["rue", "RUE (g/MJ)", 0.5, 5], ["tb", "Suhu dasar (°C)", 0, 15], ["kg", "Kg growth", 0, 1], ["km", "Km maint. (h⁻¹)", 0, 0.2], ["kadar_air_polong", "KA polong", 0.5, 0.999], ["target_bps_segar", "Acuan BPS (t/ha)", 0, 50]] },
  { judul: "Thermal Unit per Fase (°C·hari)", isi: [["tu.0", "TU-1", 10, 600], ["tu.1", "TU-2", 10, 900], ["tu.2", "TU-3", 10, 600], ["tu.3", "TU-4", 10, 900], ["tu.4", "TU-5", 10, 600]] },
  { judul: "Kondisi Awal 1 HST", isi: [["LAI_awal", "LAI awal", 0.01, 1], ["wbatang_awal", "Batang (g/m²)", 0, 50], ["wakar_awal", "Akar (g/m²)", 0, 50]] },
  { judul: "Tanah & Air", isi: [["KATawal", "KAT awal", 0, 0.6], ["TLP", "TLP", 0, 0.4], ["KL", "KL", 0.1, 0.6], ["Zr", "Zr (mm)", 100, 800], ["runoff_frac", "Limpasan", 0, 1], ["coef_Ic", "Koef. intersepsi", 0, 3], ["Ic_maks", "Ic maks (mm)", 0, 5], ["U", "Ritchie U (mm)", 1, 30], ["alpha", "Ritchie α", 0.5, 15], ["reset_hujan", "Reset hujan (mm)", 0.5, 20]] },
  { judul: "Kc per Fase", isi: [["kc_fase.0", "Kc-1", 0.2, 1.3], ["kc_fase.1", "Kc-2", 0.2, 1.3], ["kc_fase.2", "Kc-3", 0.2, 1.3], ["kc_fase.3", "Kc-4", 0.2, 1.3], ["kc_fase.4", "Kc-5", 0.2, 1.3]] }
];
const getDeep = (o, p) => p.split(".").reduce((a, k) => a[k], o);
function setDeep(o, p, v) { const a = p.split("."); let t = o; for (let i = 0; i < a.length - 1; i++) t = t[a[i]]; t[a[a.length - 1]] = v; }
function buildParamForm() {
  const el = $("panelParam"); el.innerHTML = "";
  for (const g of PARAM_GROUPS) {
    const d = document.createElement("details"); d.className = "border rounded-lg bg-slate-50";
    if (g.judul === "Lokasi & Waktu") d.open = true;
    d.innerHTML = `<summary class="text-xs font-bold px-2 py-1.5">▸ ${g.judul}</summary><div class="p-2 grid grid-cols-2 gap-2"></div>`;
    const box = d.querySelector("div");
    for (const [path, label, mn, mx] of g.isi) {
      const id = "p_" + path.replace(/\./g, "_");
      box.insertAdjacentHTML("beforeend",
        `<div><label class="text-[10px] text-slate-500" for="${id}">${label}</label>
         <input id="${id}" data-path="${path}" type="number" step="any" min="${mn}" max="${mx}" value="${getDeep(state.params, path)}"
         class="pinput w-full border rounded px-1.5 py-1 text-xs num focus:ring-2 focus:ring-emerald-600 outline-none"></div>`);
    }
    el.appendChild(d);
  }
  const d = document.createElement("details"); d.className = "border rounded-lg bg-slate-50";
  d.innerHTML = `<summary class="text-xs font-bold px-2 py-1.5">▸ Partisi Biomassa (D/B/A/P)</summary><div class="p-2 grid grid-cols-4 gap-1"></div>`;
  const box = d.querySelector("div");
  state.params.partisi.forEach((row, f) => row.forEach((v, c) => box.insertAdjacentHTML("beforeend",
    `<input data-path="partisi.${f}.${c}" title="Fase ${f + 1} · ${["daun", "batang", "akar", "polong"][c]}" type="number" step="0.01" min="0" max="1" value="${v}" class="pinput border rounded px-1 py-0.5 w-full text-xs num">`)));
  el.appendChild(d);
  el.querySelectorAll(".pinput").forEach(inp => inp.addEventListener("change", () => setDeep(state.params, inp.dataset.path, parseFloat(inp.value))));
}

/* ---------------- eksekusi simulasi ---------------- */
function jalankanSemua(silent) {
  try { state.prep = preprocessWeather(currentRows()); }
  catch (e) { pesan("Data cuaca: " + e.message, true); toast(e.message, "err"); return; }
  state.tglTanam = new Date($("tglTanam").value + "T00:00:00Z");
  const { hasil, ringkas } = jalankan8Skenario(state.prep, state.params, state.tglTanam);
  state.hasil = hasil; state.ringkas = ringkas;
  const gagal = ringkas.filter(r => r.gagal);
  if (gagal.length === 8) { pesan("Data tidak cukup sampai kemasakan (972 °C·hari).", true); toast("Semua skenario gagal: data cuaca kurang panjang.", "err"); return; }
  if (state.aktifIdx >= 8) hitungCustom();
  else if (!state.hasil[state.aktifIdx]) state.aktifIdx = ringkas.findIndex(r => !r.gagal);
  $("infoData").textContent = `${state.prep.hari.length} hari bersih · ${state.prep.ada_ssrd ? "radiasi ssrd_mj aktif" : "Angstrom dari lama penyinaran"}`;
  pesan(`Selesai · ${8 - gagal.length}/8 skenario`);
  if (!silent) toast(`Simulasi selesai: ${8 - gagal.length}/8 skenario · ${state.prep.hari.length} hari cuaca`);
  renderAll();
}
function hitungCustom() {
  const dT = parseFloat($("rngDT").value), fCH = parseFloat($("rngFCH").value);
  const res = simulasiBuncis(state.prep, state.params, state.tglTanam, dT, fCH);
  const base = state.hasil[0] ? state.hasil[0].harian.at(-1).ProdPolong_tonBK_ha : null;
  state.custom = res ? { res, rk: ringkasanSkenario(res, base ?? res.harian.at(-1).ProdPolong_tonBK_ha), dT, fCH } : null;
  if (!res) toast("Skenario kustom: belum matang dalam rentang data.", "err");
}
const aktif = () => state.aktifIdx >= 8 ? state.custom?.res : state.hasil[state.aktifIdx];
const aktifRk = () => state.aktifIdx >= 8 ? state.custom?.rk : state.ringkas[state.aktifIdx];
const namaAktif = () => state.aktifIdx >= 8 ? `Kustom ΔT=${state.custom?.dT ?? 0}°C · CH×${state.custom?.fCH ?? 1}` : (state.ringkas[state.aktifIdx]?.Skenario || "–");

/* ---------------- KPI ---------------- */
function renderKPI() {
  const rk = aktifRk(), el = $("kpiCards");
  if (!rk || rk.gagal) { el.innerHTML = `<div class="col-span-full text-red-700 p-4 bg-red-50 rounded-xl border border-red-200">Skenario aktif gagal dijalankan.</div>`; return; }
  const P = state.params;
  const galat = (rk.ProdPolong_tonSegar_ha / P.target_bps_segar - 1) * 100;
  const okMass = rk.maksResiduAir < WARN && rk.maksResiduBiomassa < WARN;
  const card = (cls, t, valHtml, s) => `<div class="kpi ${cls} panel p-3"><p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold">${t}</p><p class="text-xl font-extrabold num mt-0.5">${valHtml}</p><p class="text-[11px] text-slate-500 mt-0.5">${s}</p></div>`;
  const num = (v, dec, suf = "") => `<span class="countup" data-to="${v}" data-dec="${dec}" data-suf="${suf}">0</span>`;
  el.innerHTML =
    card("", "Umur Panen", num(rk.Umur_Panen_HST, 0, " HST"), "saat ΣTU = 972 °C·hari") +
    card("k-red", "Polong Segar", num(rk.ProdPolong_tonSegar_ha, 2, " t/ha"), `galat vs BPS ${P.target_bps_segar}: ${galat >= 0 ? "+" : ""}${galat.toFixed(1)}%`) +
    card("k-amber", "Polong Kering", num(rk.ProdPolong_tonBK_ha, 3, " t/ha"), `Δ vs baseline: ${rk.Perubahan_Hasil_pct >= 0 ? "+" : ""}${rk.Perubahan_Hasil_pct}%`) +
    card("k-sky", "ETc / ETa", `${num(rk.Total_ETc_mm, 0)} / ${num(rk.Total_ETa_mm, 0)} mm`, "kebutuhan vs penggunaan air") +
    card("k-sky", "Rerata WDF", num(rk.Rerata_WDF, 3), "1 = tanpa cekaman air") +
    card(okMass ? "" : "k-red", "Kekekalan Massa", okMass ? `<span style="color:#2D6A4F">✓ VALID</span>` : `<span style="color:#DC2626">✗ CEK</span>`, `|residu| maks ${rk.maksResiduAir.toExponential(1)} mm`);
  el.querySelectorAll(".countup").forEach(countUp);
}

/* ---------------- grafik ---------------- */
function chart(id, cfg) { if (CHARTS[id]) CHARTS[id].destroy(); CHARTS[id] = new Chart($(id), cfg); }
const H = r => r.harian.map(x => x.HST), V = (r, k) => r.harian.map(x => x[k]);
const ANIM = { duration: 700, easing: "easeOutQuart" };
const OPT = (yl, xl = "Hari Setelah Tanam (HST)") => ({
  responsive: true, maintainAspectRatio: false, animation: ANIM,
  interaction: { mode: "index", intersect: false },
  plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { backgroundColor: "#0B1F17", titleFont: { size: 11 }, bodyFont: { size: 11 } } },
  scales: { x: { title: { display: true, text: xl, font: { size: 10 } }, grid: { color: "rgba(45,106,79,.08)" } }, y: { title: { display: true, text: yl, font: { size: 10 } }, grid: { color: "rgba(45,106,79,.08)" } } }
});
function renderGrafik1() {
  const r = aktif(); if (!r) return;
  $("g1Judul").textContent = "· " + namaAktif();
  chart("c1a", { type: "line", data: { labels: H(r), datasets: ["Daun", "Batang", "Akar", "Polong"].map((k, i) => ({ label: k, data: V(r, k), borderColor: ["#2D6A4F", "#0369A1", "#D97706", "#DC2626"][i], backgroundColor: ["#2D6A4F", "#0369A1", "#D97706", "#DC2626"][i], pointRadius: 0, borderWidth: 2, tension: .25 })) }, options: OPT("g BK/m²") });
  chart("c1b", { type: "line", data: { labels: H(r), datasets: [{ label: "LAI", data: V(r, "LAI"), borderColor: "#2D6A4F", pointRadius: 0, borderWidth: 2, fill: true, backgroundColor: "rgba(64,145,108,.12)", tension: .25 }] }, options: OPT("m²/m²") });
  const P = state.params, o = OPT("m³/m³");
  o.scales.y.min = 0; o.scales.y.max = P.KL + 0.05;
  chart("c1c", { type: "line", data: { labels: H(r), datasets: [
    { label: "KAT", data: V(r, "KAT"), borderColor: "#0284C7", pointRadius: 0, borderWidth: 2, tension: .2 },
    { label: "KL", data: H(r).map(() => P.KL), borderColor: "#0369A1", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.2 },
    { label: "TLP", data: H(r).map(() => P.TLP), borderColor: "#DC2626", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.2 }] }, options: o });
  chart("c1d", { type: "line", data: { labels: H(r), datasets: [
    { label: "ETo", data: V(r, "ETo"), borderColor: "#64748B", pointRadius: 0, borderWidth: 1.5 },
    { label: "ETc", data: V(r, "ETc"), borderColor: "#D97706", pointRadius: 0, borderWidth: 2 },
    { label: "ETa", data: V(r, "ETa"), borderColor: "#0284C7", pointRadius: 0, borderWidth: 2, fill: true, backgroundColor: "rgba(2,132,199,.08)" }] }, options: OPT("mm/hari") });
}
function renderGrafik2() {
  const r = aktif(); if (!r) return;
  const o = OPT("Polong Segar (ton/ha)");
  o.scales.y1 = { position: "right", title: { display: true, text: "Polong Kering (ton BK/ha)", font: { size: 10 } }, grid: { drawOnChartArea: false } };
  chart("c2a", { type: "line", data: { labels: H(r), datasets: [
    { label: "Polong Segar (KA 94,2%)", data: V(r, "ProdPolong_tonSegar_ha"), borderColor: "#DC2626", pointRadius: 0, borderWidth: 2.5, yAxisID: "y", tension: .2 },
    { label: "Polong Kering", data: V(r, "ProdPolong_tonBK_ha"), borderColor: "#7F1D1D", borderDash: [5, 4], pointRadius: 0, borderWidth: 2, yAxisID: "y1", tension: .2 }] }, options: o });
  chart("c2b", { type: "line", data: { labels: H(r), datasets: [
    ["Polong", "ProdPolong_tonBK_ha", "#DC2626"], ["Daun", "ProdDaun_tonBK_ha", "#2D6A4F"], ["Batang", "ProdBatang_tonBK_ha", "#0369A1"],
    ["Akar", "ProdAkar_tonBK_ha", "#D97706"], ["Total Biomassa", "ProdTotal_tonBK_ha", "#111827"]].map(([l, k, c]) =>
    ({ label: l, data: V(r, k), borderColor: c, backgroundColor: c, pointRadius: 0, borderWidth: 2, tension: .2 })) }, options: OPT("ton BK/ha") });
}
function renderGrafik3() {
  const h = state.hasil; if (!h[0]) return;
  const warnaT = ["#111827", "#D97706", "#DC2626", "#7E22CE"], warnaH = ["#111827", "#A16207", "#0EA5E9", "#B91C1C", "#1E40AF"];
  const mk = (idxs, warna) => ({
    type: "line",
    data: { datasets: idxs.filter(i => h[i]).map((i, j) => ({
      label: state.ringkas[i].Skenario + " (" + state.ringkas[i].Umur_Panen_HST + " HST)",
      data: h[i].harian.map(r => ({ x: r.HST, y: r.ProdPolong_tonSegar_ha })),
      borderColor: warna[j], backgroundColor: warna[j], pointRadius: 0, borderWidth: i === 0 ? 3 : 2, tension: .2 })) },
    options: { ...OPT("Polong Segar (ton/ha)"), scales: { x: { type: "linear", min: 1, max: 56, title: { display: true, text: "HST", font: { size: 10 } } }, y: { title: { display: true, text: "ton/ha", font: { size: 10 } } } } }
  });
  chart("c3a", mk([0, 1, 2, 3], warnaT));
  chart("c3b", mk([0, 4, 6, 5, 7], warnaH));
}
function renderGrafik4() {
  const rk = state.ringkas.filter(r => !r.gagal); if (!rk.length) return;
  const warna = ["#111827", "#EAB308", "#D97706", "#DC2626", "#A16207", "#0EA5E9", "#8B2E2E", "#1E40AF"];
  const labelPlugin = { id: "barLabels", afterDatasetsDraw(c) {
    const { ctx } = c; c.getDatasetMeta(0).data.forEach((bar, i) => {
      ctx.fillStyle = "#0F172A"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(rk[i].ProdPolong_tonSegar_ha.toFixed(2) + " t/ha", bar.x, bar.y - 22);
      ctx.fillStyle = rk[i].Perubahan_Hasil_pct >= 0 ? "#15803D" : "#B91C1C";
      ctx.fillText((rk[i].Perubahan_Hasil_pct >= 0 ? "+" : "") + rk[i].Perubahan_Hasil_pct + "%", bar.x, bar.y - 10);
    }); } };
  const o = OPT("ton/ha", "S1=Baseline · S2–S4=Suhu +1..+3°C · S5–S8=CH ±10/±20%");
  o.scales.y.beginAtZero = true; o.scales.y.max = Math.max(...rk.map(r => r.ProdPolong_tonSegar_ha)) * 1.35;
  chart("c4", { type: "bar", data: { labels: rk.map(r => r.Kode), datasets: [
    { label: "Polong Segar (ton/ha)", data: rk.map(r => r.ProdPolong_tonSegar_ha), backgroundColor: rk.map((_, i) => warna[i % 8] + "E6"), borderRadius: 6, borderSkipped: false },
    { type: "line", label: "Acuan BPS 7,00 t/ha", data: rk.map(() => state.params.target_bps_segar), borderColor: "#94A3B8", borderDash: [8, 6], pointRadius: 0, borderWidth: 1.5 }] }, options: o, plugins: [labelPlugin] });
}

/* ---------------- tabel & ekspor ---------------- */
function renderTabel() {
  const cols = ["Kode", "Skenario", "deltaT", "faktorCH", "Umur_Panen_HST", "Total_CH_mm", "Total_ETc_mm", "Total_ETa_mm", "Rerata_WDF", "ProdPolong_tonBK_ha", "ProdPolong_tonSegar_ha", "Perubahan_Hasil_pct"];
  const rows = state.ringkas.filter(r => !r.gagal);
  $("tblRingkasan").innerHTML = "<table class='min-w-full border'><thead><tr>" + cols.map(c => `<th class='border px-2 py-1 text-left text-white' style='background:#1B4332'>${c}</th>`).join("") + "</tr></thead><tbody>" +
    rows.map(r => `<tr class="${state.aktifIdx < 8 && r.Kode === state.ringkas[state.aktifIdx]?.Kode ? "bg-amber-100 font-semibold" : "hover:bg-emerald-50"}">` + cols.map(c => `<td class='border px-2 py-1 num'>${r[c]}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
  const r = aktif();
  $("judulTabelHarian").textContent = namaAktif();
  if (!r) { $("tblHarian").innerHTML = ""; return; }
  const kc = Object.keys(r.harian[0]);
  $("tblHarian").innerHTML = "<table class='border-collapse'><thead><tr>" + kc.map(c => `<th class='border px-2 py-1 sticky top-0 text-white' style='background:#334155'>${c}</th>`).join("") + "</tr></thead><tbody>" +
    r.harian.map(row => "<tr class='hover:bg-emerald-50'>" + kc.map(c => `<td class='border px-2 py-0.5 whitespace-nowrap num'>${typeof row[c] === "number" ? +row[c].toPrecision(6) : row[c]}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
}
function unduh(nama, isi) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([isi.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = nama; a.click(); URL.revokeObjectURL(a.href);
  toast("CSV diunduh: " + nama, "info");
}
function exportCSV(jenis) {
  if (jenis === "ringkasan") {
    const cols = ["Kode", "Kelompok", "Skenario", "deltaT", "faktorCH", "Umur_Panen_HST", "Total_CH_mm", "Total_ETc_mm", "Total_ETa_mm", "Rerata_WDF", "ProdPolong_tonBK_ha", "ProdPolong_tonSegar_ha", "Perubahan_Hasil_pct"];
    unduh("ringkasan_sensitivitas_iklim.csv", [cols.join(",")].concat(state.ringkas.filter(r => !r.gagal).map(r => cols.map(c => r[c]).join(","))));
  } else {
    const r = aktif(); if (!r) return;
    const kode = state.aktifIdx >= 8 ? "kustom" : state.ringkas[state.aktifIdx].Kode;
    const cols = Object.keys(r.harian[0]);
    unduh(kode === "S1" ? "hasil_harian_baseline.csv" : `hasil_harian_${kode.toLowerCase()}.csv`,
      [cols.join(",")].concat(r.harian.map(row => cols.map(c => row[c]).join(","))));
  }
}

/* ---------------- dokumentasi parameter ---------------- */
const PARAM_DOC = [
  ["tgl_tanam", "2024-03-01", "—", "[ASUMSI]", "Acuan musim tanam utama validasi BPS 2024."],
  ["Lat / Lon", "-7.731 / 110.354", "°", "[PUSTAKA][KONVERSI]", "Stamet DIY WMO 96851; -773100 dinormalisasi; masuk rumus dalam radian."],
  ["Alt", "450", "mdpl", "[PUSTAKA]", "Jurnal Untidar (Kab. Magelang); koreksi tekanan P pada ETo."],
  ["slope", "26", "%", "[PUSTAKA]", "Jurnal Untidar; dasar runoff_frac."],
  ["tinggi_angin", "2", "m", "[ASUMSI]", "ERA5-Land 10 m dianggap setara 2 m (dampak ke ETo ≈ 0,3%)."],
  ["k", "0.63", "—", "[PUSTAKA]", "Manshuri et al. (2015) — pemadaman cahaya tajuk buncis."],
  ["sla", "209.8", "cm²/g", "[PUSTAKA][KONVERSI]", "20.98 m²/kg × 10."],
  ["rue", "1.65", "g/MJ", "[KONVERSI][KALIBRASI]", "1.22 g/MJ ditala ke 1.65 (rentang buncis 1.5–2.2) agar cocok BPS."],
  ["tb", "6.8", "°C", "[PUSTAKA]", "Ferreira et al. (1997)."],
  ["tu1..tu5", "76/306/79/392/119", "°C·hari", "[PUSTAKA]", "Dapaah et al. (1999) & Skripsi IPB (2024) Tabel 2; Σ=972."],
  ["kg / km", "0.32 / 0.031", "fraksi / hari⁻¹", "[PUSTAKA]", "Amthor (2000); respirasi pemeliharaan."],
  ["Kondisi awal", "0.15 / 6 / 3", "m²/m², g/m²", "[ASUMSI]", "Bibit berdaun 1 HST."],
  ["kadar_air_polong", "0.942", "fraksi", "[PUSTAKA]", "Skripsi IPB (2024) hal. 21."],
  ["target_bps_segar", "7.00", "ton/ha", "[PUSTAKA][KONVERSI]", "BPS Kab. Magelang 2024: 64.004 kw ÷ 914 ha."],
  ["KATawal / TLP / KL", "0.25 / 0.15 / 0.38", "m³/m³", "[PUSTAKA][KONVERSI]", "25% & 15% vol ÷100; KL: 242 mL/700 g × ρb 1.10."],
  ["Zr", "300", "mm", "[PUSTAKA][ASUMSI]", "Skripsi hal. 25; konstan."],
  ["runoff_frac", "0.35", "fraksi", "[ASUMSI]", "Lahan miring 26%."],
  ["coef_Ic / Ic_maks", "1.00 / 1.27", "mm", "[PUSTAKA]", "Zinke (1967) via Skripsi Pers. 8–9."],
  ["kc_fase", "0.50/0.80/1.05/1.05/0.90", "—", "[PUSTAKA][ASUMSI]", "FAO-56 (Allen et al. 1998) dipetakan 5 fase."],
  ["U / alpha / reset", "12.0 / 5.08 / 5.0", "mm, mm·hari⁻⁰·⁵", "[PUSTAKA][ASUMSI]", "Ritchie (1998) via Skripsi Pers. 12–13."],
  ["partisi", "matriks 5×4", "fraksi", "[ASUMSI]", "Alokasi asimilat per fase; tiap baris = 1."]
];
function renderDocParam() {
  $("tblParamDoc").innerHTML = "<table class='min-w-full border text-[11px]'><thead><tr>" + ["Parameter", "Nilai Default", "Satuan", "Tag", "Sumber & Metode"].map(c => `<th class='border px-2 py-1 text-left text-white' style='background:#1B4332'>${c}</th>`).join("") + "</tr></thead><tbody>" +
    PARAM_DOC.map(r => `<tr class='hover:bg-emerald-50'><td class='border px-2 py-1 font-mono'>${r[0]}</td><td class='border px-2 py-1 num'>${r[1]}</td><td class='border px-2 py-1'>${r[2]}</td><td class='border px-2 py-1 font-semibold' style='color:#2D6A4F'>${r[3]}</td><td class='border px-2 py-1'>${r[4]}</td></tr>`).join("") + "</tbody></table>";
}

/* ================= MODUL OPEN-METEO ================= */
const OM_URL = "https://api.open-meteo.com/v1/forecast";
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const DAILY_VARS = "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,relative_humidity_2m_mean,windspeed_10m_max,shortwave_radiation_sum,sunshine_duration,et0_fao_evapotranspiration,weather_code";

function weatherIcon(code, size = 44) {
  // kode WMO -> ikon CSS beranimasi
  const rays = n => Array.from({ length: n }, (_, i) => `<i style="transform:rotate(${i * 360 / n}deg)"></i>`).join("");
  const drops = n => Array.from({ length: n }, (_, i) => `<span class="drop" style="left:${12 + i * 8}px;top:28px;animation-delay:${i * .25}s"></span>`).join("");
  let inner;
  if (code === 0 || code === 1) inner = `<div class="rays">${rays(8)}</div><div class="sun"></div>`;
  else if (code === 2 || code === 3) inner = `<div class="sun" style="inset:4px 14px 18px 4px;opacity:.85"></div><div class="cloud"></div>`;
  else if (code >= 45 && code <= 48) inner = `<div class="cloud"></div><div class="cloud" style="top:24px;left:10px;opacity:.6"></div>`;
  else if (code >= 95) inner = `<div class="cloud"></div><div class="bolt"></div>${drops(2)}`;
  else if (code >= 71 && code <= 77) inner = `<div class="cloud"></div><span class="drop" style="left:14px;top:28px;background:#BAE6FD;height:5px"></span><span class="drop" style="left:24px;top:30px;background:#BAE6FD;height:5px;animation-delay:.4s"></span>`;
  else inner = `<div class="cloud"></div>${drops(3)}`;
  return `<div class="wi" style="width:${size}px;height:${size}px">${inner}</div>`;
}
const WMO_LABEL = c => c === 0 ? "Cerah" : c === 1 ? "Cerah berawan" : c === 2 ? "Berawan" : c === 3 ? "Mendung" :
  c <= 48 ? "Kabut" : c <= 57 ? "Gerimis" : c <= 67 ? "Hujan" : c <= 77 ? "Salju" : c <= 82 ? "Hujan shower" : c <= 86 ? "Salju shower" : "Badai petir";

function skorHari(d) {
  const tm = (d.tmax + d.tmin) / 2;
  let sT = (tm >= 18 && tm <= 26) ? 100 : tm < 18 ? Math.max(0, 100 - (18 - tm) * 9) : Math.max(0, 100 - (tm - 26) * 11);
  if (d.tmax > 32) sT = Math.min(sT, 45);
  const sR = d.rain <= 5 ? 100 : d.rain <= 20 ? 100 - (d.rain - 5) * 1.2 : d.rain <= 40 ? 82 - (d.rain - 20) * 2.2 : Math.max(10, 38 - (d.rain - 40) * 1.2);
  const sH = (d.rh >= 60 && d.rh <= 85) ? 100 : Math.max(25, 100 - Math.abs(d.rh - 72) * 2.5);
  const sW = d.wind <= 20 ? 100 : Math.max(25, 100 - (d.wind - 20) * 2.2);   // angin Open-Meteo: km/jam
  return { skor: Math.round(.45 * sT + .25 * sR + .2 * sH + .1 * sW), tm, sT, sR, sH, sW };
}
function badgeSkor(s) {
  const [lab, col, bg] = s >= 80 ? ["Sangat Cocok", "#14532D", "#95D5B2"] : s >= 60 ? ["Cocok", "#1B4332", "#D8F3DC"] :
    s >= 40 ? ["Kurang Cocok", "#92400E", "#FEF3C7"] : ["Tidak Cocok", "#991B1B", "#FECACA"];
  return `<span class="badge" style="color:${col};background:${bg}">${lab}</span>`;
}
function simpanInput() {
  localStorage.setItem("buncis_inputs", JSON.stringify({
    luas: $("inpLuas").value, prod24: $("inpProd24").value,
    lat: $("inpLat").value, lon: $("inpLon").value, nama: state.fc?.loc?.nama || $("inpCari").value
  }));
}
function muatInput() {
  try {
    const s = JSON.parse(localStorage.getItem("buncis_inputs") || "null");
    if (s) { $("inpLuas").value = s.luas ?? 1; $("inpProd24").value = s.prod24 ?? 7; $("inpLat").value = s.lat ?? -7.731; $("inpLon").value = s.lon ?? 110.354; }
    const fc = JSON.parse(localStorage.getItem("buncis_fc") || "null");
    if (fc) state.fc = fc;
  } catch (e) { /* abaikan cache rusak */ }
}
async function fetchForecast() {
  if (state.fcLoading) return;
  state.fcLoading = true;
  const btn = $("btnFetch"); const asli = btn.innerHTML;
  btn.innerHTML = `<span class="spin"></span> Mengunduh…`; btn.disabled = true;
  $("fcStatus").textContent = "Menghubungi api.open-meteo.com…";
  const lat = parseFloat($("inpLat").value), lon = parseFloat($("inpLon").value);
  if (state.fc && (Math.abs(state.fc.loc.lat - lat) > 1e-6 || Math.abs(state.fc.loc.lon - lon) > 1e-6))
    state.fc = { ...state.fc, loc: { nama: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon } };
  try {
    const u = `${OM_URL}?latitude=${lat}&longitude=${lon}&daily=${DAILY_VARS}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,precipitation&timezone=auto&forecast_days=7`;
    const r = await fetch(u);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const d = j.daily;
    const daily = d.time.map((t, i) => ({
      date: t, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
      rain: d.precipitation_sum[i] ?? 0, prob: d.precipitation_probability_max?.[i] ?? null,
      rh: d.relative_humidity_2m_mean?.[i] ?? 70, wind: d.windspeed_10m_max?.[i] ?? 2,
      ssrd: d.shortwave_radiation_sum?.[i] ?? null, sun: d.sunshine_duration?.[i] ?? null,
      et0: d.et0_fao_evapotranspiration?.[i] ?? null, code: d.weather_code?.[i] ?? 2
    }));
    state.fc = {
      loc: { nama: state.fc?.loc?.nama || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon },
      fetchedAt: new Date().toISOString(), current: j.current, daily
    };
    localStorage.setItem("buncis_fc", JSON.stringify(state.fc));
    $("fcStatus").innerHTML = `✓ Diunduh ${new Date(state.fc.fetchedAt).toLocaleString("id-ID")} · zona waktu ${j.timezone} · sumber Open-Meteo (ICON/GFS).`;
    toast("Forecast 7 hari berhasil diunduh dari Open-Meteo", "info");
    renderForecast();
  } catch (e) {
    $("fcStatus").textContent = "✗ Gagal mengunduh (" + e.message + "). " + (state.fc ? "Menampilkan cache terakhir." : "Periksa koneksi internet, lalu coba lagi.");
    toast("Gagalunduh Open-Meteo: " + e.message, "err");
    if (state.fc) renderForecast();
  } finally { state.fcLoading = false; btn.innerHTML = asli; btn.disabled = false; }
}
async function cariLokasi() {
  const q = $("inpCari").value.trim(); if (!q) return;
  $("hasilCari").innerHTML = `<span class="text-[11px] text-slate-500"><span class="spin" style="border-color:#cbd5e1;border-top-color:#0369A1"></span> mencari…</span>`;
  try {
    const r = await fetch(`${GEO_URL}?name=${encodeURIComponent(q)}&count=6&language=id&format=json`);
    const j = await r.json();
    const res = j.results || [];
    if (!res.length) { $("hasilCari").innerHTML = `<span class="text-[11px] text-red-600">Tidak ditemukan.</span>`; return; }
    $("hasilCari").innerHTML = res.map((x, i) =>
      `<button data-i="${i}" class="geo chip text-[11px] px-2 py-1 rounded-lg bg-white">${x.name}${x.admin1 ? ", " + x.admin1 : ""} <span class="text-slate-400">(${x.latitude.toFixed(2)}, ${x.longitude.toFixed(2)})</span></button>`).join("");
    $("hasilCari").querySelectorAll(".geo").forEach(b => b.onclick = () => {
      const x = res[+b.dataset.i];
      $("inpLat").value = x.latitude; $("inpLon").value = x.longitude;
      state.fc = state.fc ? { ...state.fc, loc: { nama: x.name + (x.admin1 ? ", " + x.admin1 : ""), lat: x.latitude, lon: x.longitude } } : null;
      $("hasilCari").innerHTML = `<span class="text-[11px] font-semibold" style="color:#2D6A4F">✓ ${x.name}</span>`;
      simpanInput(); fetchForecast();
    });
  } catch (e) { $("hasilCari").innerHTML = `<span class="text-[11px] text-red-600">Geocoding gagal: ${e.message}</span>`; }
}
function rowsHybrid(fc) {
  const rows = fc.daily.map(d => ({
    tgl: d.date, suhu: (d.tmax + d.tmin) / 2, rh: d.rh, ch: d.rain, angin: d.wind,
    ssrd_mj: d.ssrd ?? undefined, lama: d.sun != null ? d.sun / 3600 : undefined
  }));
  const akhir = new Date(fc.daily.at(-1).date + "T00:00:00Z");
  for (let i = 1; i <= 110; i++) {
    const b = WEATHER_DATA[(i - 1) % WEATHER_DATA.length];
    rows.push({ tgl: new Date(akhir.getTime() + i * 86400000).toISOString().slice(0, 10), suhu: b[1], rh: b[2], ch: b[3], angin: b[4], ssrd_mj: b[5], lama: b[6] });
  }
  return rows;
}
function renderForecast() {
  const fc = state.fc; if (!fc) return;
  $("fcWrap").classList.remove("hidden");
  $("fcLoc").textContent = `${fc.loc.nama} (${fc.loc.lat.toFixed(3)}, ${fc.loc.lon.toFixed(3)})`;
  // cuaca saat ini
  const c = fc.current || {};
  $("curIcon").outerHTML = weatherIcon(c.weather_code ?? 2, 52).replace('class="wi"', 'class="wi" id="curIcon"');
  $("curTeks").textContent = (c.temperature_2m ?? "–") + " °C";
  $("curDetail").textContent = `${WMO_LABEL(c.weather_code ?? 2)} · RH ${c.relative_humidity_2m ?? "–"}% · angin ${c.wind_speed_10m ?? "–"} km/j`;
  // skor & verdict
  const skor = fc.daily.map(skorHari);
  const totalRain = fc.daily.reduce((a, d) => a + d.rain, 0);
  let overall = Math.round(skor.reduce((a, s) => a + s.skor, 0) / skor.length);
  const notes = [];
  if (totalRain < 10) { overall -= 15; notes.push(`Hujan 7 hari hanya ${totalRain.toFixed(1)} mm (<10 mm) — defisit air awal pertumbuhan; pertimbangkan irigasi.`); }
  else if (totalRain > 150) { overall -= 20; notes.push(`Hujan 7 hari ${totalRain.toFixed(0)} mm (>150 mm) — risiko genangan & gugur bunga; tunda tanam atau perbaiki drainase.`); }
  else if (totalRain > 120) { overall -= 12; notes.push(`Hujan 7 hari ${totalRain.toFixed(0)} mm (>120 mm) — tanah jenuh air; wajib bedengan & drainase lancar sebelum tanam.`); }
  else if (totalRain > 60) { overall -= 5; notes.push(`Hujan 7 hari ${totalRain.toFixed(0)} mm (60–120 mm) — cukup basah; pastikan drainase bedengan agar perkecambahan tidak busuk.`); }
  else notes.push(`Total hujan 7 hari ${totalRain.toFixed(1)} mm — pasokan air awal musim memadai (kebutuhan ±20–40 mm/minggu).`);
  const panas = fc.daily.filter(d => d.tmax > 32).length;
  if (panas) notes.push(`${panas} hari bersuhu maks >32 °C — risiko gugur bunga & polong muda [ASUMSI ambang].`);
  const dingin = fc.daily.filter(d => (d.tmax + d.tmin) / 2 < 15).length;
  if (dingin) notes.push(`${dingin} hari bersuhu rerata <15 °C — pertumbuhan melambat (Tb = 6,8 °C).`);
  const rhAvg = fc.daily.reduce((a, d) => a + d.rh, 0) / 7;
  notes.push(`RH rerata ${rhAvg.toFixed(0)}% (optimum buncis 60–85%); RH tinggi + hujan berturut-turut menaikkan risiko antraknosa.`);
  overall = Math.max(0, Math.min(100, overall));
  const [vl, vc] = overall >= 80 ? ["Sangat Cocok", "#2D6A4F"] : overall >= 60 ? ["Cocok", "#40916C"] : overall >= 40 ? ["Kurang Cocok", "#D97706"] : ["Tidak Cocok", "#DC2626"];
  $("verdict").textContent = vl; $("verdict").style.color = vc;
  const arc = $("gaugeArc");
  arc.style.stroke = vc; arc.style.strokeDashoffset = 314.16 * (1 - overall / 100);
  $("gaugeVal").textContent = overall;
  // jendela tanam terbaik (3 hari berturut)
  let best = 0, bi = 0;
  for (let i = 0; i + 2 < skor.length; i++) { const s = skor[i].skor + skor[i + 1].skor + skor[i + 2].skor; if (s > best) { best = s; bi = i; } }
  const fmt = d => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  $("windowSaran").textContent = `Jendela tanam terbaik: ${fmt(fc.daily[bi].date)} – ${fmt(fc.daily[bi + 2].date)} (skor ${Math.round(best / 3)}/100).`;
  $("fcNotes").innerHTML = notes.map(n => `<li>${n}</li>`).join("");
  // kartu harian
  $("dayCards").innerHTML = fc.daily.map((d, i) => {
    const s = skor[i];
    return `<div class="daycard panel p-2.5 text-center" style="animation-delay:${i * 70}ms">
      <p class="text-[10px] font-bold text-slate-500">${new Date(d.date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" })}</p>
      <div class="flex justify-center my-1">${weatherIcon(d.code, 40)}</div>
      <p class="text-[10px] text-slate-500">${WMO_LABEL(d.code)}</p>
      <p class="num font-extrabold text-sm mt-1"><span style="color:#DC2626">${d.tmax.toFixed(0)}°</span> <span style="color:#0369A1">${d.tmin.toFixed(0)}°</span></p>
      <p class="num text-[11px]" style="color:#0284C7">💧 ${d.rain.toFixed(1)} mm${d.prob != null ? ` · ${d.prob}%` : ""}</p>
      <p class="text-[10px] text-slate-500 num">RH ${d.rh.toFixed(0)}% · ${d.wind.toFixed(0)} km/j</p>
      <div class="mt-1.5">${badgeSkor(s.skor)}</div>
      <p class="num text-[11px] font-bold mt-0.5" style="color:${vc}">${s.skor}/100</p>
    </div>`;
  }).join("");
  // grafik forecast
  const o = OPT("Suhu (°C)", "Tanggal");
  o.scales.y1 = { position: "right", title: { display: true, text: "Curah hujan (mm)", font: { size: 10 } }, grid: { drawOnChartArea: false }, beginAtZero: true };
  chart("c5", { type: "bar", data: { labels: fc.daily.map(d => fmt(d.date)), datasets: [
    { type: "bar", label: "Curah hujan (mm)", data: fc.daily.map(d => d.rain), backgroundColor: "rgba(2,132,199,.45)", borderColor: "#0284C7", borderWidth: 1, borderRadius: 5, yAxisID: "y1" },
    { type: "line", label: "T maks (°C)", data: fc.daily.map(d => d.tmax), borderColor: "#DC2626", backgroundColor: "#DC2626", pointRadius: 3, borderWidth: 2, tension: .3, yAxisID: "y" },
    { type: "line", label: "T min (°C)", data: fc.daily.map(d => d.tmin), borderColor: "#0369A1", backgroundColor: "#0369A1", pointRadius: 3, borderWidth: 2, tension: .3, yAxisID: "y" },
    { type: "line", label: "T rerata (°C)", data: fc.daily.map(d => (d.tmax + d.tmin) / 2), borderColor: "#D97706", borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, yAxisID: "y" }] }, options: o });
  // proyeksi model hybrid
  const luas = Math.max(0.01, parseFloat($("inpLuas").value) || 1);
  const prod24 = Math.max(0.1, parseFloat($("inpProd24").value) || 7);
  let projHtml;
  try {
    const prep = preprocessWeather(rowsHybrid(fc));
    const res = simulasiBuncis(prep, state.params, new Date(fc.daily[0].date + "T00:00:00Z"), 0, 1);
    if (!res) throw new Error("belum matang");
    const ak = res.harian.at(-1);
    const segar = ak.ProdPolong_tonSegar_ha;
    const est = segar * luas, base24 = prod24 * luas, delta = (segar / prod24 - 1) * 100;
    const pc = (cls, t, v, s) => `<div class="kpi ${cls} panel p-3"><p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold">${t}</p><p class="text-xl font-extrabold num">${v}</p><p class="text-[11px] text-slate-500">${s}</p></div>`;
    projHtml =
      pc("", "Umur panen proyeksi", ak.HST + " HST", "tanam " + fmt(fc.daily[0].date)) +
      pc("k-red", "Polong segar proyeksi", segar.toFixed(2) + " t/ha", "model + forecast Open-Meteo") +
      pc("k-amber", "Estimasi produksi Anda", est.toFixed(2) + " ton", `= ${segar.toFixed(2)} t/ha × ${luas} ha`) +
      pc(delta >= 0 ? "" : "k-red", "vs capaian 2024 Anda", (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%", `2024: ${base24.toFixed(2)} ton (${prod24} t/ha × ${luas} ha)`);
  } catch (e) {
    projHtml = `<div class="col-span-full text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs">Proyeksi model tidak dapat dihitung (${e.message}). Skor kelayakan di atas tetap berlaku.</div>`;
  }
  $("projCards").innerHTML = projHtml;
  // tabel forecast
  const cols = ["Tanggal", "Cuaca", "Tmaks", "Tmin", "CH_mm", "Prob_%", "RH_%", "Angin_km/j", "SSRD_MJ", "ET0_mm", "Skor", "Kategori"];
  $("tblForecast").innerHTML = "<table class='min-w-full border'><thead><tr>" + cols.map(c => `<th class='border px-2 py-1 text-left text-white' style='background:#0369A1'>${c}</th>`).join("") + "</tr></thead><tbody>" +
    fc.daily.map((d, i) => `<tr class='hover:bg-sky-50'><td class='border px-2 py-1'>${d.date}</td><td class='border px-2 py-1'>${WMO_LABEL(d.code)}</td><td class='border px-2 py-1 num'>${d.tmax}</td><td class='border px-2 py-1 num'>${d.tmin}</td><td class='border px-2 py-1 num'>${d.rain}</td><td class='border px-2 py-1 num'>${d.prob ?? "–"}</td><td class='border px-2 py-1 num'>${d.rh}</td><td class='border px-2 py-1 num'>${d.wind}</td><td class='border px-2 py-1 num'>${d.ssrd ?? "–"}</td><td class='border px-2 py-1 num'>${d.et0 ?? "–"}</td><td class='border px-2 py-1 num font-bold'>${skor[i].skor}</td><td class='border px-2 py-1'>${badgeSkor(skor[i].skor)}</td></tr>`).join("") + "</tbody></table>";
}
function exportForecast() {
  const fc = state.fc; if (!fc) return;
  const cols = ["tanggal", "cuaca", "tmax_c", "tmin_c", "ch_mm", "prob_hujan_pct", "rh_pct", "angin_kmj", "ssrd_mj", "et0_mm", "skor", "kategori"];
  const rows = fc.daily.map((d, i) => { const s = skorHari(d); return [d.date, WMO_LABEL(d.code), d.tmax, d.tmin, d.rain, d.prob ?? "", d.rh, d.wind, d.ssrd ?? "", d.et0 ?? "", s.skor, s.skor >= 80 ? "Sangat Cocok" : s.skor >= 60 ? "Cocok" : s.skor >= 40 ? "Kurang Cocok" : "Tidak Cocok"].join(","); });
  unduh("forecast_7hari.csv", [cols.join(",")].concat(rows));
}

/* ---------------- render gabungan & reveal ---------------- */
function renderAll() { renderKPI(); renderGrafik1(); renderGrafik2(); renderGrafik3(); renderGrafik4(); renderTabel(); }
const io = ("IntersectionObserver" in window) ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("on"); io.unobserve(e.target); } }), { threshold: .08 }) : null;
function observeReveals() {
  document.querySelectorAll(".reveal:not(.on)").forEach(el => {
    if (el.dataset.rv) return;
    el.dataset.rv = "1";
    if (io) io.observe(el);
    // jaring pengaman: bila IO tidak fires (webview/headless), elemen dalam viewport tetap tampil
    setTimeout(() => { if (!el.classList.contains("on") && el.getBoundingClientRect().top < innerHeight * 1.05) el.classList.add("on"); }, 900);
  });
}

/* ---------------- binding UI ---------------- */
function bindUI() {
  // chips skenario
  $("chipsSken").innerHTML = SCENARIOS.map((s, i) => `<button class="chip rounded-lg py-1.5 text-[11px] font-extrabold ${i === 0 ? "on" : ""}" data-i="${i}" title="${s.nama}">${s.kode}</button>`).join("") +
    `<button class="chip rounded-lg py-1.5 text-[11px] font-extrabold" data-i="8" title="Skenario kustom">⚙</button>`;
  $("chipsSken").querySelectorAll(".chip").forEach(b => b.onclick = () => {
    state.aktifIdx = +b.dataset.i;
    $("chipsSken").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b));
    if (state.aktifIdx >= 8) hitungCustom();
    renderKPI(); renderGrafik1(); renderGrafik2(); renderTabel();
  });
  $("btnRun").onclick = () => {
    const b = $("btnRun"), asli = b.innerHTML;
    b.innerHTML = `<span class="spin"></span> Menghitung 8 skenario…`; b.disabled = true;
    setTimeout(() => { jalankanSemua(); b.innerHTML = asli; b.disabled = false; }, 220);
  };
  $("tglTanam").onchange = () => jalankanSemua();
  $("btnReset").onclick = () => { state.params = JSON.parse(JSON.stringify(P_DEFAUL)); buildParamForm(); jalankanSemua(); toast("Parameter dikembalikan ke kalibrasi Magelang"); };
  let deb = 0;
  ["rngDT", "rngFCH"].forEach(id => $(id).oninput = () => {
    $("lblDT").textContent = parseFloat($("rngDT").value).toFixed(1);
    $("lblFCH").textContent = parseFloat($("rngFCH").value).toFixed(2);
    clearTimeout(deb);
    deb = setTimeout(() => { if (state.aktifIdx >= 8 && state.prep) { hitungCustom(); renderKPI(); renderGrafik1(); renderGrafik2(); renderTabel(); } }, 90);
  });
  document.querySelectorAll("input[name=src]").forEach(rb => rb.onchange = () => {
    $("fileCuaca").disabled = !(rb.value === "upload" && rb.checked);
    if (rb.value === "builtin") jalankanSemua();
  });
  $("fileCuaca").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      const fr = new FileReader();
      fr.onload = ev => {
        const wb = XLSX.read(ev.target.result, { type: "array", cellDates: true });
        state.uploadRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
        toast(`XLSX terbaca: ${state.uploadRows.length} baris`, "info"); jalankanSemua();
      };
      fr.readAsArrayBuffer(f);
    } else {
      const rd = new FileReader();
      rd.onload = () => {
        const baris = rd.result.split(/\r?\n/).filter(l => l.trim());
        const sep = (baris[0].match(/;/g) || []).length > (baris[0].match(/,/g) || []).length ? ";" : ",";
        const head = baris[0].split(sep).map(s => s.trim().replace(/^"|"$/g, ""));
        state.uploadRows = baris.slice(1).map(l => { const v = l.split(sep); const o = {}; head.forEach((h, i) => o[h] = v[i]); return o; });
        toast(`CSV terbaca (${sep === ";" ? "titik koma" : "koma"}): ${state.uploadRows.length} baris`, "info"); jalankanSemua();
      };
      rd.readAsText(f);
    }
  };
  document.querySelectorAll(".ekspor").forEach(b => b.onclick = () => exportCSV(b.dataset.file));
  // sidebar drawer
  const tutup = () => { $("sidebar").classList.remove("open"); $("backdrop").classList.remove("on"); };
  $("btnSidebar").onclick = () => { $("sidebar").classList.toggle("open"); $("backdrop").classList.toggle("on", $("sidebar").classList.contains("open")); };
  $("backdrop").onclick = tutup;
  // tabs
  document.querySelectorAll(".tabbtn").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tabbtn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    ["tabDash", "tabSens", "tabTanam", "tabTabel", "tabRumus"].forEach(t => $(t).classList.add("hidden"));
    const sec = $(b.dataset.tab); sec.classList.remove("hidden"); sec.classList.remove("tab-anim");
    void sec.offsetWidth; sec.classList.add("tab-anim");
    observeReveals();
    if (b.dataset.tab === "tabTanam" && !state.fc && !state.fcLoading) fetchForecast();
    if (b.dataset.tab === "tabTanam" && state.fc) renderForecast();
    Object.values(CHARTS).forEach(c => c.resize());
  });
  // modul open-meteo
  $("btnFetch").onclick = fetchForecast;
  $("btnCari").onclick = cariLokasi;
  $("inpCari").onkeydown = e => { if (e.key === "Enter") cariLokasi(); };
  $("btnGeo").onclick = () => {
    if (!navigator.geolocation) { toast("Geolocation tidak tersedia di browser ini.", "err"); return; }
    navigator.geolocation.getCurrentPosition(p => {
      $("inpLat").value = p.coords.latitude.toFixed(3); $("inpLon").value = p.coords.longitude.toFixed(3);
      state.fc = state.fc ? { ...state.fc, loc: { nama: "Lokasi GPS saya", lat: p.coords.latitude, lon: p.coords.longitude } } : null;
      simpanInput(); fetchForecast();
    }, () => toast("Izin lokasi ditolak / tidak tersedia.", "err"));
  };
  ["inpLuas", "inpProd24", "inpLat", "inpLon"].forEach(id => $(id).addEventListener("input", () => { simpanInput(); if (state.fc) renderForecast(); }));
  $("btnFcCsv").onclick = exportForecast;
  $("btnReplay").onclick = () => window.Intro.show();
  window.addEventListener("intro-entered", () => {
    document.querySelectorAll("#tabDash .reveal").forEach((el, i) => setTimeout(() => el.classList.add("on"), 150 + i * 160));
    observeReveals();
  });
}

/* ---------------- init ---------------- */
muatInput();
buildParamForm();
renderDocParam();
bindUI();
jalankanSemua(true);
observeReveals();
const HASH_TABS = { "#dashboard": "tabDash", "#sens": "tabSens", "#tanam": "tabTanam", "#tabel": "tabTabel", "#rumus": "tabRumus" };
function bukaHash() {
  const t = HASH_TABS[location.hash];
  if (!t) return;
  const btn = document.querySelector(`.tabbtn[data-tab="${t}"]`);
  if (btn) btn.click();
}
if (location.hash && HASH_TABS[location.hash]) { window.Intro.hide(); bukaHash(); }
window.addEventListener("hashchange", bukaHash);

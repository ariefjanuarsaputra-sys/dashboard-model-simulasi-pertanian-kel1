/* ============================================================================
 * MESIN SIMULASI BUNCIS (Phaseolus vulgaris L.) - Port presisi Skenario_Iklim.R
 * Struktur: [0] Konstanta & Parameter | [1] Pra-pemrosesan Cuaca (Tahap 0)
 * [2] Fenologi TU 5 Fase (Tahap 1) | [3] Loop Harian (Tahap 2-3)
 * [4] Ringkasan Skenario (Tahap 5)
 * ========================================================================== */
"use strict";

/* ---------- [0] PARAMETER TERKALIBRASI MAGELANG (Spesifikasi 3.1) ---------- */
function defaultParams() {
  return {
    Lat: -7.731,            // [PUSTAKA][KONVERSI] Stamet DIY WMO 96851, derajat desimal
    Alt: 450,               // [PUSTAKA] Jurnal Untidar, mdpl
    tinggi_angin: 2,        // [ASUMSI] anemometer standar FAO-56 (m)
    k: 0.63,                // [PUSTAKA] Manshuri et al. 2015
    sla: 209.8,             // [PUSTAKA][KONVERSI] 20.98 m2/kg * 10 = 209.8 cm2/g
    rue: 1.65,              // [KALIBRASI] rentang pustaka 1.5-2.2 g/MJ
    tb: 6.8,                // [PUSTAKA] Ferreira et al. 1997
    tu: [76, 306, 79, 392, 119], // [PUSTAKA] Dapaah et al. 1999 + Skripsi IPB 2024
    kg: 0.32,               // [PUSTAKA] Amthor 2000
    km: 0.031,              // [PUSTAKA] hari^-1
    LAI_awal: 0.15, wbatang_awal: 6.0, wakar_awal: 3.0, // [ASUMSI] kondisi 1 HST
    kadar_air_polong: 0.942, // [PUSTAKA] Skripsi IPB hal. 21
    target_bps_segar: 7.00,  // [PUSTAKA][KONVERSI] BPS 64.004 kw / 914 ha
    partisi: [               // [ASUMSI] matriks 5x4 (daun,batang,akar,polong)
      [0.42, 0.35, 0.23, 0.00],
      [0.42, 0.40, 0.18, 0.00],
      [0.28, 0.27, 0.10, 0.35],
      [0.12, 0.13, 0.00, 0.75],
      [0.05, 0.05, 0.00, 0.90]
    ],
    KATawal: 0.25, TLP: 0.15, KL: 0.38, // [PUSTAKA][KONVERSI] fraksi volume
    Zr: 300,              // [PUSTAKA][ASUMSI] mm, zona akar efektif konstan
    runoff_frac: 0.35,    // [ASUMSI] kemiringan lahan 26%
    coef_Ic: 1.00,        // [PUSTAKA] Zinke 1967 (LAI<=3)
    Ic_maks: 1.27,        // [PUSTAKA] mm/hari (LAI>3)
    kc_fase: [0.50, 0.80, 1.05, 1.05, 0.90], // [PUSTAKA] FAO-56 5 fase
    U: 12.0,              // [PUSTAKA] Ritchie tahap-1 (mm)
    alpha: 5.08,          // [PUSTAKA] Ritchie tahap-2 (mm/hari^0.5)
    reset_hujan: 5.0      // [ASUMSI] mm infiltrasi reset Ritchie
  };
}

/* 8 skenario uji sensitivitas (Spesifikasi bagian 5) */
const SCENARIOS = [
  { kode: "S1", kelompok: "Baseline", nama: "1. Baseline (Saat Ini)",   dT: 0.0, fCH: 1.00 },
  { kode: "S2", kelompok: "Suhu",     nama: "2. Suhu +1 C",             dT: 1.0, fCH: 1.00 },
  { kode: "S3", kelompok: "Suhu",     nama: "3. Suhu +2 C",             dT: 2.0, fCH: 1.00 },
  { kode: "S4", kelompok: "Suhu",     nama: "4. Suhu +3 C",             dT: 3.0, fCH: 1.00 },
  { kode: "S5", kelompok: "Hujan",    nama: "5. Curah Hujan -10%",      dT: 0.0, fCH: 0.90 },
  { kode: "S6", kelompok: "Hujan",    nama: "6. Curah Hujan +10%",      dT: 0.0, fCH: 1.10 },
  { kode: "S7", kelompok: "Hujan",    nama: "7. Curah Hujan -20%",      dT: 0.0, fCH: 0.80 },
  { kode: "S8", kelompok: "Hujan",    nama: "8. Curah Hujan +20%",      dT: 0.0, fCH: 1.20 }
];

/* ---------- [1] PRA-PEMROSESAN CUACA (Tahap 0, setara baca_data_cuaca) ---------- */
const MISSING_TOKENS = ["", "-", "NA", "NaN", "8888", "9999", "8888.0", "9999.0"];

function parseTanggal(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  // Serial Excel (1900 date system, origin 1899-12-30)
  if (typeof v === "number" && isFinite(v) && v > 20000 && v < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  }
  const s = String(v == null ? "" : v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

function toNum(v) {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  const s = String(v == null ? "" : v).trim();
  if (MISSING_TOKENS.includes(s)) return NaN;
  const n = parseFloat(s.replace(/,/g, "."));
  return isFinite(n) ? n : NaN;
}

function getCol(row, names) {
  for (const key of Object.keys(row)) {
    const k = key.toLowerCase().trim();
    if (names.includes(k)) return row[k];
  }
  return undefined;
}

/* rows: array of plain objects dengan header bebas -> array harian bersih siap simulasi */
function preprocessWeather(rows) {
  const parsed = [];
  for (const r of rows) {
    const tgl = parseTanggal(getCol(r, ["tgl", "tanggal", "date"]));
    if (!tgl || isNaN(tgl)) continue;
    parsed.push({
      tgl,
      suhu: toNum(getCol(r, ["suhu", "temp", "t"])),
      rh: toNum(getCol(r, ["rh", "kelembapan"])),
      ch: toNum(getCol(r, ["ch", "rain", "hujan"])),
      angin: toNum(getCol(r, ["angin", "wind", "ws"])),
      lama: toNum(getCol(r, ["lama", "sun", "ssd"])),
      ssrd_mj: toNum(getCol(r, ["ssrd_mj", "rs", "radiasi"]))
    });
    parsed[parsed.length - 1].punya_ssrd =
      getCol(r, ["ssrd_mj", "rs", "radiasi"]) !== undefined;
  }
  if (!parsed.length) throw new Error("Tidak ada baris bertanggal valid (kolom `tgl`).");
  parsed.sort((a, b) => a.tgl - b.tgl);
  const dedup = [];
  for (const p of parsed) {
    if (!dedup.length || p.tgl.getTime() !== dedup[dedup.length - 1].tgl.getTime()) dedup.push(p);
  }
  // [ASUMSI] Imputasi rerata kolom non-hujan, CH NA -> 0 mm, dengan jejak _diimputasi
  const varsImput = ["suhu", "rh", "angin", "lama", "ssrd_mj"];
  for (const nm of varsImput) {
    let sum = 0, cnt = 0;
    for (const p of dedup) if (isFinite(p[nm])) { sum += p[nm]; cnt++; }
    const mean = cnt ? sum / cnt : NaN;
    for (const p of dedup) {
      p[nm + "_diimputasi"] = !isFinite(p[nm]);
      if (!isFinite(p[nm])) p[nm] = isFinite(mean) ? mean : 0;
    }
  }
  let cntSSR = 0;
  for (const p of rows) if (getCol(p, ["ssrd_mj", "rs", "radiasi"]) !== undefined) { cntSSR = 1; break; }
  for (const p of dedup) {
    p.CH_diimputasi = !isFinite(p.ch);
    if (!isFinite(p.ch)) p.ch = 0;
  }
  return { hari: dedup, ada_ssrd: cntSSR === 1 };
}

/* ---------- [2]+[3] SIMULASI SATU SKENARIO (Tahap 1-3, setara simulasi_buncis) ---------- */
function dayOfYear(d) {
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

function simulasiBuncis(prep, params, tglMulai, deltaT, faktorCH) {
  const P = params;
  // Tahap 0.5: perturbasi skenario lalu potong dari tanggal tanam
  const src = prep.hari.filter(h => h.tgl.getTime() >= tglMulai.getTime())
    .map(h => Object.assign({}, h, {
      suhu: h.suhu + deltaT,
      ch: Math.max(0, h.ch * faktorCH)
    }));
  if (src.length < 2) return null;

  // Tahap 1: Fenologi Thermal Unit 5 Fase
  const totalTU = P.tu.reduce((a, b) => a + b, 0); // 972 C hari
  const batas = [0];
  for (const t of P.tu) batas.push(batas[batas.length - 1] + t); // [0,76,382,461,853,972]
  const tuHari = src.map(h => Math.max(h.suhu - P.tb, 0));
  const tuKumul = [0];
  for (let i = 1; i < src.length; i++) tuKumul.push(tuKumul[i - 1] + tuHari[i]);
  let idxMatang = -1;
  for (let i = 0; i < tuKumul.length; i++) if (tuKumul[i] >= totalTU) { idxMatang = i; break; }
  if (idxMatang < 0) return null; // belum matang dalam rentang data
  const data = src.slice(0, idxMatang + 1);
  const TUk = tuKumul.slice(0, idxMatang + 1);
  for (let i = 1; i < data.length; i++) {
    const diff = Math.round((data[i].tgl - data[i - 1].tgl) / 86400000);
    if (diff !== 1) return null; // ada tanggal hilang
  }
  const n = data.length;
  const faseIdx = TUk.map(x => { // 0-based fase 0..4, setara pmin(5, findInterval)
    let f = 0;
    while (f < 4 && x >= batas[f + 1]) f++;
    return f;
  });
  const bobotFase = P.tu.map(t => t / totalTU);
  const awalS = [0];
  for (const b of bobotFase) awalS.push(awalS[awalS.length - 1] + b);
  const s = new Array(n), ds = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const f = faseIdx[i];
    const prop = Math.min(1, Math.max(0, (TUk[i] - batas[f]) / P.tu[f]));
    s[i] = awalS[f] + bobotFase[f] * prop;
    if (i > 0) ds[i] = s[i] - s[i - 1];
  }
  if (n > 0) s[n - 1] = 1;
  for (let i = 1; i < n; i++) ds[i] = s[i] - s[i - 1];

  // Tahap 2: inisialisasi kondisi awal 1 HST
  const lai = new Array(n).fill(0), daun = new Array(n).fill(0),
        batang = new Array(n).fill(0), akar = new Array(n).fill(0),
        polong = new Array(n).fill(0), tot = new Array(n).fill(0);
  const Rs = new Array(n).fill(0), ETo = new Array(n).fill(0), kc = new Array(n).fill(0),
        etc = new Array(n).fill(0), em = new Array(n).fill(0), tm = new Array(n).fill(0),
        ea = new Array(n).fill(0), ta = new Array(n).fill(0),
        ic = new Array(n).fill(0), chEf = new Array(n).fill(0), ro = new Array(n).fill(0),
        infil = new Array(n).fill(0), pc = new Array(n).fill(0),
        S = new Array(n).fill(0), wdf = new Array(n).fill(0),
        Qint = new Array(n).fill(0), dW = new Array(n).fill(0), Ba = new Array(n).fill(0),
        Rg = new Array(n).fill(0), Rm = new Array(n).fill(0),
        residuAir = new Array(n).fill(0), residuBio = new Array(n).fill(0);
  lai[0] = P.LAI_awal;
  daun[0] = lai[0] * 10000 / P.sla;
  batang[0] = P.wbatang_awal; akar[0] = P.wakar_awal;
  tot[0] = daun[0] + batang[0] + akar[0];
  S[0] = P.KATawal * P.Zr;
  wdf[0] = Math.min(1, Math.max(0, (P.KATawal - P.TLP) / (P.KL - P.TLP)));
  let E1kumul = 0, hariTahap2 = 0;

  // Tahap 3: loop harian i = 2..n
  const Sfc = P.KL * P.Zr, Swp = P.TLP * P.Zr;
  for (let i = 1; i < n; i++) {
    const T = data[i].suhu, RH = data[i].rh, CH = data[i].ch;
    const J = dayOfYear(data[i].tgl);
    // 3a. Radiasi & ETo Penman-Monteith FAO-56
    const dr = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365);
    const decl = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39);
    const phi = P.Lat * Math.PI / 180;
    const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl))));
    const Ra = (24 * 60 / Math.PI) * 0.082 * dr *
      (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
    const Nday = 24 / Math.PI * ws;
    if (prep.ada_ssrd && isFinite(data[i].ssrd_mj)) Rs[i] = data[i].ssrd_mj;
    else Rs[i] = (0.25 + 0.50 * Math.min(Nday, Math.max(0, data[i].lama)) / Nday) * Ra;
    const Rso = (0.75 + 2e-5 * P.Alt) * Ra;
    const es = 0.6108 * Math.exp(17.27 * T / (T + 237.3));
    const eakt = RH / 100 * es;
    const Delta = 4098 * es / Math.pow(T + 237.3, 2);
    const Pk = 101.3 * Math.pow((293 - 0.0065 * P.Alt) / 293, 5.26);
    const gamma = 0.000665 * Pk;
    const Rns = 0.77 * Rs[i];
    const Rnl = 4.903e-9 * Math.pow(T + 273.16, 4) * (0.34 - 0.14 * Math.sqrt(eakt)) *
      Math.max(0, 1.35 * Math.min(1, Rs[i] / Rso) - 0.35);
    const Rn = Rns - Rnl;
    const u2 = data[i].angin * 4.87 / Math.log(67.8 * P.tinggi_angin - 5.42);
    ETo[i] = Math.max(0, (0.408 * Delta * Rn + gamma * (900 / (T + 273)) * u2 * (es - eakt)) /
      (Delta + gamma * (1 + 0.34 * u2)));
    kc[i] = P.kc_fase[faseIdx[i]];
    etc[i] = kc[i] * ETo[i];

    // 3b. Intersepsi, limpasan, infiltrasi
    const lailama = lai[i - 1];
    ic[i] = Math.min(CH, lailama <= 3 ? P.coef_Ic * lailama : P.Ic_maks);
    chEf[i] = CH - ic[i];
    ro[i] = P.runoff_frac * chEf[i];
    infil[i] = chEf[i] - ro[i];

    // 3c. Neraca air tanah & Ritchie dua tahap
    const setelah = S[i - 1] + infil[i];
    pc[i] = Math.max(0, setelah - Sfc);
    const tersedia = setelah - pc[i];
    em[i] = etc[i] * Math.exp(-P.k * lailama);
    tm[i] = Math.max(0, etc[i] - em[i]);
    if (infil[i] >= P.reset_hujan) { E1kumul = 0; hariTahap2 = 0; }
    let EaPot;
    if (E1kumul < P.U) EaPot = em[i];
    else {
      hariTahap2++;
      EaPot = Math.min(em[i], P.alpha * (Math.sqrt(hariTahap2) - Math.sqrt(hariTahap2 - 1)));
    }
    const airAmbil = Math.max(0, tersedia - Swp);
    ea[i] = Math.min(EaPot, airAmbil);
    if (E1kumul < P.U) E1kumul += ea[i];
    const faktorAir = Math.min(1, Math.max(0, airAmbil / (Sfc - Swp)));
    ta[i] = Math.min(tm[i] * faktorAir, Math.max(0, airAmbil - ea[i]));
    wdf[i] = tm[i] > 1e-12 ? ta[i] / tm[i] : 1;
    S[i] = tersedia - ea[i] - ta[i];
    residuAir[i] = S[i] - (S[i - 1] + CH - ic[i] - ro[i] - pc[i] - ea[i] - ta[i]);

    // 3d. Biomassa, respirasi, partisi organ
    Qint[i] = Rs[i] * (1 - Math.exp(-P.k * lailama));
    dW[i] = P.rue * Qint[i];
    Ba[i] = dW[i] * wdf[i];
    Rg[i] = P.kg * Ba[i];
    const Bnet = Ba[i] - Rg[i];
    const Q10 = Math.pow(2, (T - 20) / 10);
    const Wlama = [daun[i - 1], batang[i - 1], akar[i - 1], polong[i - 1]];
    const eta = P.partisi[faseIdx[i]];
    const baru = [0, 0, 0, 0];
    let rmSum = 0;
    for (let o = 0; o < 4; o++) {
      const alokasi = Bnet * eta[o];
      const resp = Math.min(P.km * Q10 * Wlama[o], Wlama[o] + alokasi);
      baru[o] = Wlama[o] + alokasi - resp;
      rmSum += resp;
    }
    daun[i] = baru[0]; batang[i] = baru[1]; akar[i] = baru[2]; polong[i] = baru[3];
    Rm[i] = rmSum;
    tot[i] = baru[0] + baru[1] + baru[2] + baru[3];
    lai[i] = P.sla * daun[i] / 10000;
    residuBio[i] = (tot[i] - tot[i - 1]) - (Bnet - rmSum);
  }

  const harian = [];
  for (let i = 0; i < n; i++) {
    harian.push({
      Tanggal: data[i].tgl.toISOString().slice(0, 10), HST: i + 1,
      Fase: "Fase-" + (faseIdx[i] + 1), s: s[i], ds: ds[i],
      Suhu: data[i].suhu, RH: data[i].rh, CH: data[i].ch, Radiasi: Rs[i],
      ETo: ETo[i], ETc: etc[i], Em: em[i], Ea: ea[i], Tm: tm[i], Ta: ta[i], ETa: ea[i] + ta[i],
      Intersepsi: ic[i], CH_ef: chEf[i], Runoff: ro[i], Infiltrasi: infil[i],
      Perkolasi: pc[i], SimpananAir_mm: S[i], KAT: S[i] / P.Zr, WDF: wdf[i],
      Qint: Qint[i], Bp: dW[i], Ba: Ba[i], Rg: Rg[i], Rm: Rm[i],
      Daun: daun[i], Batang: batang[i], Akar: akar[i], Polong: polong[i],
      Total: tot[i], LAI: lai[i],
      ProdPolong_tonBK_ha: 0.01 * polong[i],
      ProdPolong_tonSegar_ha: (0.01 * polong[i]) / (1 - P.kadar_air_polong),
      ProdDaun_tonBK_ha: 0.01 * daun[i], ProdBatang_tonBK_ha: 0.01 * batang[i],
      ProdAkar_tonBK_ha: 0.01 * akar[i], ProdTotal_tonBK_ha: 0.01 * tot[i],
      ResiduAir_mm: residuAir[i], ResiduBiomassa_gm2: residuBio[i]
    });
  }
  return { harian };
}

/* ---------- [4] RINGKASAN (setara blok 4 Skenario_Iklim.R) ---------- */
function ringkasanSkenario(res, baseBK) {
  const ak = res.harian[res.harian.length - 1];
  const sum = key => res.harian.reduce((a, h) => a + h[key], 0);
  const mean = key => sum(key) / res.harian.length;
  const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100,
        r3 = x => Math.round(x * 1000) / 1000;
  return {
    Umur_Panen_HST: ak.HST,
    Total_CH_mm: r1(sum("CH")),
    Total_ETc_mm: r1(sum("ETc")),
    Total_ETa_mm: r1(sum("ETa")),
    Rerata_WDF: r3(mean("WDF")),
    ProdPolong_tonBK_ha: r3(ak.ProdPolong_tonBK_ha),
    ProdPolong_tonSegar_ha: r2(ak.ProdPolong_tonSegar_ha),
    Perubahan_Hasil_pct: r1((ak.ProdPolong_tonBK_ha / baseBK - 1) * 100),
    _BK_persis: ak.ProdPolong_tonBK_ha,
    maksResiduAir: Math.max(...res.harian.map(h => Math.abs(h.ResiduAir_mm))),
    maksResiduBiomassa: Math.max(...res.harian.map(h => Math.abs(h.ResiduBiomassa_gm2)))
  };
}

function jalankan8Skenario(prep, params, tglTanam) {
  const hasil = [], ringkas = [];
  let baseBK = null;
  for (const sk of SCENARIOS) {
    const res = simulasiBuncis(prep, params, tglTanam, sk.dT, sk.fCH);
    if (!res) {
      ringkas.push({ Kode: sk.kode, gagal: true, alasan: "Data cuaca tidak cukup sampai kemasakan (972 C hari)." });
      hasil.push(null);
      continue;
    }
    if (sk.kode === "S1") baseBK = res.harian[res.harian.length - 1].ProdPolong_tonBK_ha;
    const rk = ringkasanSkenario(res, baseBK);
    rk.Kode = sk.kode; rk.Kelompok = sk.kelompok; rk.Skenario = sk.nama;
    rk.deltaT = sk.dT; rk.faktorCH = sk.fCH;
    hasil.push(res); ringkas.push(rk);
  }
  return { hasil, ringkas };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { defaultParams, SCENARIOS, preprocessWeather, simulasiBuncis,
                     ringkasanSkenario, jalankan8Skenario, MISSING_TOKENS };
}

/* ============================================================================
 * MODUL ADAPTASI / PENYELAMATAN PANEN - Port presisi climate_scenario_adaptation.R
 * Tuas: mulsa jerami kontur | dosis & jadwal pupuk P (jam biologis TU-76) |
 *       irigasi tetes fase kritis | PHT hayati. Ekonomi: Ali et al. 2025,
 *       Keil et al. 2009 (Monte Carlo), Utami 2001, Nuryani 2019, Susiawan 2018.
 * Kekekalan massa air & biomassa dijaga |residu| < 1e-12.
 * ========================================================================== */
"use strict";

const ADAPT = {
  Tb: 10.0,                       // [PUSTAKA] suhu dasar modul adaptasi (deg C)
  tu: [76, 306, 79, 392, 119],    // [PUSTAKA] Dapaah et al. 1999; Skripsi IPB 2024
  kc: [0.40, 0.75, 1.15, 1.10, 0.85], // [PUSTAKA] FAO-56 Phaseolus vulgaris
  KL: 0.34, TLP: 0.14,            // [PUSTAKA] Latosol Magelang (m3/m3)
  Zr: 300,                        // [ASUMSI] zona akar efektif KONSTAN sepanjang simulasi (mm)
  k_beer: 0.63,                   // [PUSTAKA] Manshuri et al. 2015
  RUE: 1.85,                      // [PUSTAKA] g BK/MJ dasar modul adaptasi
  Rg_frac: 0.32,                  // [PUSTAKA] Amthor 2000
  Rm_coef: 0.031, Q10: 2.0,       // [PUSTAKA] respirasi pemeliharaan
  SLA: 0.024,                     // [PUSTAKA][KONVERSI] m2 daun/g BK daun
  kadar_air: 0.942,               // [KONVERSI][ASUMSI] Skripsi IPB 2024 hal. 21; dibatasi 0.80-0.97
  lat: -7.48, elev: 450, z_angin: 10, // [PUSTAKA] modul adaptasi; angin ERA5 10 m
  albedo: 0.23, a_ap: 0.25, b_ap: 0.50,
  partisi: [                      // [ASUMSI] baris fase 1..5, kolom (akar,batang,daun,polong); jumlah baris = 1
    [0.40, 0.25, 0.35, 0.00],
    [0.18, 0.34, 0.48, 0.00],
    [0.08, 0.27, 0.35, 0.30],
    [0.02, 0.10, 0.13, 0.75],
    [0.00, 0.04, 0.04, 0.92]
  ],
  W_awal: [0.80, 0.70, 1.20, 0.00], // [ASUMSI] stok benih g BK/m2 (akar,batang,daun,polong)
  P_dasar: 45.0,                  // [PUSTAKA] Nuryani et al. 2019: cadangan P Latosol (kg P2O5/ha)
  P_sinkron_awal: 0.82,           // [ASUMSI] efisiensi sebelum pupuk susulan masuk
  dosis_P_opt: 97.9,              // [PUSTAKA] optimum kuadratik Nuryani et al. 2019 Gamb. 3
  irigasi_mm: 6.5,                // [PUSTAKA] Servina 2019: irigasi tetes hemat air (mm/hari)
  p_ambang: 0.45,                 // [PUSTAKA] FAO-56: cekaman mulai di bawah 45% air tersedia
  diurnal_range: 9.0              // [ASUMSI] rentang Tmaks-Tmin harian saat data hanya suhu rerata (deg C)
};

const MULSA = {
  bekas: {   // praktik petani Ngablak: buncis di akhir masa mulsa 1,5 tahun (Ali et al. 2025)
    label: "Mulsa bekas 1,5 th (petani)", f_runoff: 0.350, U: 12.0, alpha: 5.08, dT_mikro: 0.0, cuci_P: 0.195
  },
  jerami: {  // guludan kontur + mulsa jerami (Susiawan et al. 2018 Windusari; Utami 2001)
    label: "Mulsa jerami + guludan kontur", f_runoff: 0.126, U: 7.5, alpha: 3.15, dT_mikro: -0.40, cuci_P: 0.015
  }
};
const JADWAL_P = [
  { id: "kaku_21hst", label: "Kaku 21 HST (kalender petani)" },
  { id: "kaku_14hst", label: "Kaku 14 HST (kalender)" },
  { id: "sinkron_TU76", label: "Sinkron jam biologis (TU = 76 °C·hari)" }
];

function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

/* ETo Penman-Monteith FAO-56 presisi penuh (port hitung_eto_fao56) */
function etoFAO56(tmin, tmax, tavg, rh, u_z, DOY, ssrd, lama) {
  const P_kpa = 101.3 * Math.pow((293 - 0.0065 * ADAPT.elev) / 293, 5.26);
  const gamma = 0.000665 * P_kpa;
  const esTmin = 0.6108 * Math.exp(17.27 * tmin / (tmin + 237.3));
  const esTmax = 0.6108 * Math.exp(17.27 * tmax / (tmax + 237.3));
  const es = (esTmin + esTmax) / 2;
  const ea = es * clamp(rh, 10, 100) / 100;
  const Delta = 4098 * (0.6108 * Math.exp(17.27 * tavg / (tavg + 237.3))) / Math.pow(tavg + 237.3, 2);
  const phi = ADAPT.lat * Math.PI / 180;
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * DOY / 365);
  const delta_sol = 0.409 * Math.sin(2 * Math.PI * DOY / 365 - 1.39);
  const omega_s = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta_sol), -1, 1));
  const N_jam = 24 / Math.PI * omega_s;
  const Ra = (24 * 60 / Math.PI) * 0.0820 * dr *
    (omega_s * Math.sin(phi) * Math.sin(delta_sol) + Math.cos(phi) * Math.cos(delta_sol) * Math.sin(omega_s));
  let RS;
  if (isFinite(ssrd) && ssrd > 0) RS = ssrd;
  else {
    const n = isFinite(lama) ? clamp(lama, 0, N_jam) : 0.55 * N_jam;
    RS = (ADAPT.a_ap + ADAPT.b_ap * (n / N_jam)) * Ra;
  }
  const Rso = (0.75 + 2e-5 * ADAPT.elev) * Ra;
  const Rns = (1 - ADAPT.albedo) * RS;
  const rasio_awan = clamp(RS / Math.max(0.1, Rso), 0.25, 1);
  const Rnl = 4.903e-9 * ((Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * rasio_awan - 0.35);
  const Rn = Rns - Rnl;
  let u2 = ADAPT.z_angin === 2 ? u_z : u_z * (4.87 / Math.log(67.8 * ADAPT.z_angin - 5.42));
  u2 = Math.max(0.5, u2);
  const pembilang = 0.408 * Delta * Rn + gamma * (900 / (tavg + 273)) * u2 * Math.max(0, es - ea);
  const penyebut = Delta + gamma * (1 + 0.34 * u2);
  return { ETo: Math.max(0, pembilang / penyebut), RS, Rn, VPD: Math.max(0, es - ea) };
}

/* prep: hasil preprocessWeather (sim_engine.js). tuas: {mulsa, dosisP, jadwalP, irigasi, pht} */
function simulasiAdaptasi(prep, tglMulai, deltaT, faktorCH, tuas) {
  const T = Object.assign({ mulsa: "bekas", dosisP: 58, jadwalP: "kaku_21hst", irigasi: false, pht: false }, tuas);
  const M = MULSA[T.mulsa] || MULSA.bekas;
  const dosis = clamp(T.dosisP, 0, 200);
  const KA = clamp(ADAPT.kadar_air, 0.80, 0.97);
  const src = prep.hari.filter(h => h.tgl.getTime() >= tglMulai.getTime())
    .map(h => Object.assign({}, h, { suhu: h.suhu + deltaT, ch: Math.max(0, h.ch * faktorCH) }));
  if (src.length < 2) return null;
  const batas = [];
  let acc = 0;
  for (const t of ADAPT.tu) { acc += t; batas.push(acc); }
  const totalTU = acc;
  const Dhalf = ADAPT.diurnal_range / 2;
  const tuHari = src.map(h => Math.max(0, h.suhu - ADAPT.Tb));
  const tuKum = [0];
  for (let i = 1; i < src.length; i++) tuKum.push(tuKum[i - 1] + tuHari[i]);
  let idxMatang = -1;
  for (let i = 0; i < tuKum.length; i++) if (tuKum[i] >= totalTU) { idxMatang = i; break; }
  if (idxMatang < 0) return null;
  const data = src.slice(0, idxMatang + 1);
  const TUk = tuKum.slice(0, idxMatang + 1);
  for (let i = 1; i < data.length; i++)
    if (Math.round((data[i].tgl - data[i - 1].tgl) / 86400000) !== 1) return null;
  const n = data.length;
  const fase = TUk.map(x => { const f = batas.findIndex(b => x <= b); return f < 0 ? 4 : f; }); // 0-based, inklusif seperti R

  const harian = [];
  let W = ADAPT.KL * ADAPT.Zr;
  let t_stage2 = 0, kum_Es1 = 0;
  let Worg = ADAPT.W_awal.slice();
  let LAI = Worg[2] * ADAPT.SLA;
  let P_aktif = ADAPT.P_dasar, sudahP = false, hstP = null, tuP = null, sinkron = ADAPT.P_sinkron_awal;
  let totIrig = 0, nIrig = 0, totRunoff = 0, totCuci = 0;
  const kapKL = ADAPT.KL * ADAPT.Zr, kapTLP = ADAPT.TLP * ADAPT.Zr;
  const ambangIrig = (ADAPT.TLP + 0.55 * (ADAPT.KL - ADAPT.TLP)) * ADAPT.Zr;
  const yOpt = -0.2749 * 97.90 * 97.90 + 53.827 * 97.90 - 616.43;

  for (let i = 0; i < n; i++) {
    const hst = i + 1;
    const Tavg = data[i].suhu + M.dT_mikro;
    const Tmax = data[i].suhu + Dhalf + M.dT_mikro;
    const Tmin = data[i].suhu - Dhalf + M.dT_mikro;
    const CH = data[i].ch;
    const TUh = Math.max(0, Tavg - ADAPT.Tb);
    const f = fase[i];
    const J = Math.floor((data[i].tgl.getTime() - Date.UTC(data[i].tgl.getUTCFullYear(), 0, 1)) / 86400000) + 1;

    // pupuk P: kalender kaku vs sinkron jam biologis (TU 76)
    let aplikasi = false;
    if (!sudahP) {
      if (T.jadwalP === "kaku_21hst" && hst === 21) aplikasi = true;
      else if (T.jadwalP === "kaku_14hst" && hst === 14) aplikasi = true;
      else if (T.jadwalP === "sinkron_TU76" && TUk[i] >= 76) aplikasi = true;
    }
    if (aplikasi) {
      sudahP = true; hstP = hst; tuP = TUk[i];
      P_aktif += dosis;
      const telat = Math.max(0, tuP - 85);
      sinkron = Math.max(0.825, Math.exp(-0.0018 * telat));
    }

    const pm = etoFAO56(Tmin, Tmax, Tavg, data[i].rh, data[i].angin, J,
      prep.ada_ssrd ? data[i].ssrd_mj : NaN, data[i].lama);
    const ETc = ADAPT.kc[f] * pm.ETo;

    // irigasi tetes presisi: hanya fase kritis bunga & pengisian polong, saat lengas di bawah ambang
    const W_awal = W;
    let irig = 0;
    if (T.irigasi && (f === 2 || f === 3) && W_awal < ambangIrig) { irig = ADAPT.irigasi_mm; nIrig++; }
    totIrig += irig;
    const masuk = CH + irig;

    const zin = LAI <= 3 ? 1.0 * LAI : 1.27;
    const ic = Math.min(masuk, zin);
    const lolos = masuk - ic;
    const runoff = lolos * M.f_runoff;
    const infil = lolos - runoff;
    totRunoff += runoff;
    const cuci = Math.min(P_aktif * 0.15, runoff * M.cuci_P);
    P_aktif = Math.max(40, P_aktif - cuci);
    totCuci += cuci;

    const fraksiCahaya = 1 - Math.exp(-ADAPT.k_beer * LAI);
    const Tm = Math.max(1e-6, ETc * fraksiCahaya);
    const Es_pot = Math.max(0, ETc * (1 - fraksiCahaya));

    // Ritchie dua tahap dengan penahan mulsa (port persis R adaptasi)
    if (infil > 0) {
      kum_Es1 = Math.max(0, kum_Es1 - infil);
      if (kum_Es1 < M.U) t_stage2 = 0;
    }
    let Es;
    if (kum_Es1 < M.U) {
      Es = Es_pot;
      kum_Es1 += Es;
      if (kum_Es1 > M.U) {
        const lebih = kum_Es1 - M.U;
        t_stage2 = 1;
        Es = (Es - lebih) + M.alpha * Math.sqrt(t_stage2);
      }
    } else {
      t_stage2 += 1;
      Es = Math.min(Es_pot, M.alpha * (Math.sqrt(t_stage2) - Math.sqrt(t_stage2 - 1)));
    }

    const setelahInf = W_awal + infil;
    const perkolasi = Math.max(0, setelahInf - kapKL);
    const profil = setelahInf - perkolasi;
    const tersedia = Math.max(0, profil - kapTLP);
    const AT = kapKL - kapTLP;
    const pAmb = ADAPT.p_ambang * AT;
    let WDFpot = tersedia >= pAmb ? 1 : tersedia / Math.max(1e-6, pAmb);
    WDFpot = clamp(WDFpot, 0, 1);
    const TaWant = Tm * WDFpot;
    const totalWant = TaWant + Es;
    let Ta, EsAkt;
    if (totalWant > tersedia && totalWant > 0) {
      const skala = tersedia / totalWant;
      Ta = TaWant * skala; EsAkt = Es * skala;
    } else { Ta = TaWant; EsAkt = Es; }
    const WDF = Tm > 1e-5 ? Math.min(1, Ta / Tm) : 1;
    W = W_awal + masuk - ic - runoff - perkolasi - Ta - EsAkt;
    const residuAir = Math.abs((W - W_awal) - (masuk - ic - runoff - perkolasi - Ta - EsAkt));

    // biomassa: nutrisi P kuadratik x sinkronisasi, penalti panas & OPT, guard Rm
    const WbioAwal = Worg[0] + Worg[1] + Worg[2] + Worg[3];
    const xP = clamp(P_aktif, 55, 133);
    const yP = -0.2749 * xP * xP + 53.827 * xP - 616.43;
    const faktorP = clamp((yP / yOpt) * sinkron + 0.15, 0.75, 1.12);
    const faktorPanas = (Tmax > 32 && (f === 2 || f === 3)) ? Math.max(0.55, 1 - 0.08 * (Tmax - 32)) : 1;
    let tekanan = 0;
    if (Tavg > 25) tekanan += 0.015 * (Tavg - 25);
    if (CH > 25) tekanan += 0.040;
    if (T.pht) tekanan *= 0.20;
    const faktorSehat = Math.max(0.70, 1 - tekanan);
    const Qint = pm.RS * (1 - Math.exp(-ADAPT.k_beer * LAI));
    const Ba = ADAPT.RUE * faktorP * faktorPanas * faktorSehat * Qint * WDF;
    const Rg = ADAPT.Rg_frac * Ba;
    const Q10 = Math.pow(ADAPT.Q10, (Tavg - 20) / 10);
    const RmPot = ADAPT.Rm_coef * Q10 * WbioAwal;
    const Rm = Math.min(RmPot, (Ba - Rg) + 0.02 * WbioAwal); // guard: biomassa tidak boleh negatif
    const dW = Ba - Rg - Rm;
    const pVec = ADAPT.partisi[f];
    const dOrg = [0, 0, 0, 0];
    if (dW >= 0) for (let o = 0; o < 4; o++) dOrg[o] = dW * pVec[o];
    else for (let o = 0; o < 4; o++) dOrg[o] = dW * (Worg[o] / Math.max(1e-9, WbioAwal));
    for (let o = 0; o < 4; o++) Worg[o] = Math.max(0, Worg[o] + dOrg[o]);
    const WbioAkhir = Worg[0] + Worg[1] + Worg[2] + Worg[3];
    const residuBio = Math.abs((WbioAkhir - WbioAwal) - (Ba - Rg - Rm));
    LAI = Math.max(0.02, Worg[2] * ADAPT.SLA);
    const BK = Worg[3] * 0.01;

    harian.push({
      HST: hst, Tanggal: data[i].tgl.toISOString().slice(0, 10), Fase_Ke: f + 1,
      T_Udara_C: Tavg, CH_mm: CH, Irigasi_mm: irig, TU_Kumulatif: TUk[i],
      ETo_mm: pm.ETo, ETc_mm: ETc, Runoff_mm: runoff, Ta_mm: Ta, Es_mm: EsAkt,
      Theta_m3m3: W / ADAPT.Zr, WDF, P_Aktif_kg_ha: P_aktif, LAI,
      W_Akar_g: Worg[0], W_Batang_g: Worg[1], W_Daun_g: Worg[2], W_Polong_g: Worg[3],
      Ba_gm2: Ba, Rg_gm2: Rg, Rm_gm2: Rm,
      Polong_BK_ton_ha: BK, Polong_Segar_ton_ha: BK / (1 - KA),
      Residu_Air: residuAir, Residu_Biomassa: residuBio
    });
  }
  const bp = harian.filter(h => h.Fase_Ke === 3 || h.Fase_Ke === 4);
  return {
    harian,
    meta: {
      hstPupuk: hstP, tuPupuk: tuP, faktorSinkron: sinkron,
      totalIrigasi_mm: totIrig, nIrigasi: nIrig, totalRunoff_mm: totRunoff, P_tercuci_kg: totCuci,
      P_akhir_kg: P_aktif,
      wdfBungaPolong: bp.length ? bp.reduce((a, h) => a + h.WDF, 0) / bp.length : 1,
      maksResiduAir: Math.max(...harian.map(h => h.Residu_Air)),
      maksResiduBiomassa: Math.max(...harian.map(h => h.Residu_Biomassa))
    }
  };
}

/* RNG deterministik (pengganti set.seed R) + normal Box-Muller */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeNorm(rng) {
  let spare = null;
  return function () {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    do { u = rng(); } while (u <= 1e-12);
    v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}

/* Ekonomi usahatani (port evaluasi_keputusan_penyuluh; skala luas user + kabupaten) */
const EKON = {
  luas_petani_m2: 782, harga_default: 5000,           // [PUSTAKA] Ali et al. 2025 Tabel 1-3
  biaya_dasar_mono_782: 1026741, biaya_dasar_tumpang_782: 1148810,
  biaya_adaptasi_782: 215000,                          // [PUSTAKA] paket mulsa+P+irigasi per 782 m2
  ambang_jatuh_782: 1000000,                           // [ASUMSI] batas kesejahteraan Rp/musim per 782 m2
  luas_magelang_ha: 914, kuota_bps_ton: 6400.4,        // [PUSTAKA] BPS Magelang 2024
  sd_konv: 0.18, sd_reko: 0.12, n_mc: 500, seed_mc: 450 // [PUSTAKA] Keil et al. 2009; [ASUMSI] galat normal
};
function evaluasiAdaptasi(resKonv, resReko, opts) {
  const o = Object.assign({ harga: EKON.harga_default, luasHa: 0.0782, sistem: "monokultur", nMC: EKON.n_mc, seed: EKON.seed_mc }, opts);
  const yK = resKonv.harian.at(-1).Polong_Segar_ton_ha;
  const yR = resReko.harian.at(-1).Polong_Segar_ton_ha;
  const skala = o.luasHa / (EKON.luas_petani_m2 / 10000); // [KONVERSI] biaya & ambang diskalakan dari 782 m2
  const biayaDasar = (o.sistem === "monokultur" ? EKON.biaya_dasar_mono_782 : EKON.biaya_dasar_tumpang_782) * skala;
  const biayaAdapt = EKON.biaya_adaptasi_782 * skala;
  const ambang = EKON.ambang_jatuh_782 * skala;
  const kgK = yK * 1000 * o.luasHa, kgR = yR * 1000 * o.luasHa;
  const netK = kgK * o.harga - biayaDasar;
  const netR = kgR * o.harga - (biayaDasar + biayaAdapt);
  const rng = mulberry32(o.seed), norm = makeNorm(rng);
  let jatuhK = 0, jatuhR = 0;
  const draws = [];
  for (let i = 0; i < o.nMC; i++) {
    const yk = Math.max(0, yK + EKON.sd_konv * yK * norm());
    const yr = Math.max(0, yR + EKON.sd_reko * yR * norm());
    const ik = yk * 1000 * o.luasHa * o.harga - biayaDasar;
    const ir = yr * 1000 * o.luasHa * o.harga - (biayaDasar + biayaAdapt);
    if (ik < ambang) jatuhK++;
    if (ir < ambang) jatuhR++;
    draws.push([ik, ir]);
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const incK = draws.map(d => d[0]), incR = draws.map(d => d[1]);
  const p5 = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(0.05 * (s.length - 1))]; };
  return {
    yK, yR, kgK, kgR, netK, netR, biayaDasar, biayaAdapt, ambang,
    risikoK: 100 * jatuhK / o.nMC, risikoR: 100 * jatuhR / o.nMC,
    rerataMcK: mean(incK), rerataMcR: mean(incR), p5K: p5(incK), p5R: p5(incR),
    runoffK: resKonv.meta.totalRunoff_mm, runoffR: resReko.meta.totalRunoff_mm,
    wdfK: resKonv.meta.wdfBungaPolong, wdfR: resReko.meta.wdfBungaPolong,
    irigasi_mm: resReko.meta.totalIrigasi_mm, nIrigasi: resReko.meta.nIrigasi,
    daerahK: yK * EKON.luas_magelang_ha, daerahR: yR * EKON.luas_magelang_ha,
    kuotaTercapai: yR * EKON.luas_magelang_ha >= EKON.kuota_bps_ton,
    hstK: resKonv.harian.length, hstR: resReko.harian.length
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ADAPT, MULSA, JADWAL_P, EKON, simulasiAdaptasi, evaluasiAdaptasi, etoFAO56, mulberry32 };
}
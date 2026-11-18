// Verifikasi numerik mesin JS terhadap tabel referensi spesifikasi (bagian 5)
const fs = require("fs");
const E = require("./sim_engine.js");

const raw = fs.readFileSync("./weather_data.js", "utf8");
let arrStr = raw.slice(raw.indexOf("WEATHER_DATA") + 12).trim();
arrStr = arrStr.slice(arrStr.indexOf("["), arrStr.lastIndexOf("]") + 1)
  .replace(/,\s*\]/g, "]");       // buang trailing comma
const rows = JSON.parse(arrStr)
  .map(r => ({ tgl: r[0], suhu: r[1], rh: r[2], ch: r[3], angin: r[4], ssrd_mj: r[5], lama: r[6] }));

const prep = E.preprocessWeather(rows);
const params = E.defaultParams();
const { hasil, ringkas } = E.jalankan8Skenario(prep, params, new Date(Date.UTC(2024, 2, 1)));

const REF = {
  S1: [53, 636.1, 164.5, 0.922, 0.413, 7.12, 0.0],
  S2: [50, 595.3, 159.5, 0.907, 0.330, 5.69, -20.0],
  S3: [48, 550.3, 156.6, 0.889, 0.262, 4.52, -36.6],
  S4: [46, 547.5, 153.3, 0.870, 0.202, 3.48, -51.1],
  S5: [53, 572.4, 163.5, 0.894, 0.381, 6.58, -7.6],
  S6: [53, 699.7, 166.9, 0.933, 0.426, 7.35, 3.2],
  S7: [53, 508.8, 156.7, 0.893, 0.379, 6.54, -8.1],
  S8: [53, 763.3, 167.1, 0.939, 0.434, 7.49, 5.2]
};

let ok = true;
for (const rk of ringkas) {
  if (rk.gagal) { console.log(rk.Kode, "GAGAL:", rk.alasan); ok = false; continue; }
  const got = [rk.Umur_Panen_HST, rk.Total_CH_mm, rk.Total_ETa_mm, rk.Rerata_WDF,
               rk.ProdPolong_tonBK_ha, rk.ProdPolong_tonSegar_ha, rk.Perubahan_Hasil_pct];
  const ref = REF[rk.Kode];
  const match = got.every((v, i) => Math.abs(v - ref[i]) < (i === 6 ? 0.15 : (i < 2 ? 1.01 : 0.011)));
  if (!match) ok = false;
  console.log(rk.Kode, match ? "OK " : "BEDA", "got:", got.join(" "), "| ref:", ref.join(" "));
}
console.log("---- kontrol konservasi massa ----");
for (const [i, rk] of ringkas.entries()) {
  if (rk.gagal) continue;
  console.log(rk.Kode, "residuAir", rk.maksResiduAir.toExponential(2), "residuBio", rk.maksResiduBiomassa.toExponential(2));
}
process.exit(ok ? 0 : 1);

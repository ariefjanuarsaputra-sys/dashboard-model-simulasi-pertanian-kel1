const fs = require("fs");
const path = require("path");
const DIR = __dirname;
const E = require(path.join(DIR, "sim_engine.js"));
const A = require(path.join(DIR, "adapt_engine.js"));

const raw = fs.readFileSync(path.join(DIR, "weather_data.js"), "utf8");
let arrStr = raw.slice(raw.indexOf("WEATHER_DATA") + 12).trim();
arrStr = arrStr.slice(arrStr.indexOf("["), arrStr.lastIndexOf("]") + 1).replace(/,\s*\]/g, "]");
const WEATHER = JSON.parse(arrStr);
const rows = WEATHER.map(r => ({ tgl: r[0], suhu: r[1], rh: r[2], ch: r[3], angin: r[4], ssrd_mj: r[5], lama: r[6] }));
const prep = E.preprocessWeather(rows);
const tgl = new Date("2024-04-15T00:00:00Z"); // akhir musim hujan menuju kemarau: tuas air & mulsa terlihat (data bawaan Mar 1 - Jun 15)

const konv = A.simulasiAdaptasi(prep, tgl, 2, 0.8, { mulsa: "bekas", dosisP: 58, jadwalP: "kaku_21hst", irigasi: false, pht: false });
const sli = A.simulasiAdaptasi(prep, tgl, 2, 0.8, { mulsa: "jerami", dosisP: 97.9, jadwalP: "sinkron_TU76", irigasi: true, pht: true });
if (!konv || !sli) { console.log("GAGAL: simulasi null"); process.exit(1); }

const cek = (name, cond, extra) => console.log((cond ? "OK  " : "FAIL") + " " + name + (extra ? "  " + extra : ""));
const yK = konv.harian.at(-1).Polong_Segar_ton_ha, yR = sli.harian.at(-1).Polong_Segar_ton_ha;
cek("residu air konv < 1e-12", konv.meta.maksResiduAir < 1e-12, konv.meta.maksResiduAir.toExponential(2));
cek("residu air sli < 1e-12", sli.meta.maksResiduAir < 1e-12, sli.meta.maksResiduAir.toExponential(2));
cek("residu bio konv < 1e-12", konv.meta.maksResiduBiomassa < 1e-12, konv.meta.maksResiduBiomassa.toExponential(2));
cek("residu bio sli < 1e-12", sli.meta.maksResiduBiomassa < 1e-12, sli.meta.maksResiduBiomassa.toExponential(2));
const minOrg = r => Math.min(...r.harian.flatMap(h => [h.W_Akar_g, h.W_Batang_g, h.W_Daun_g, h.W_Polong_g]));
cek("organ konv >= 0", minOrg(konv) >= 0, minOrg(konv).toFixed(4));
cek("organ sli >= 0", minOrg(sli) >= 0, minOrg(sli).toFixed(4));
cek("mulsa menurunkan runoff", sli.meta.totalRunoff_mm < konv.meta.totalRunoff_mm, konv.meta.totalRunoff_mm.toFixed(1) + " -> " + sli.meta.totalRunoff_mm.toFixed(1) + " mm");
cek("paket menaikkan WDF bunga-polong", sli.meta.wdfBungaPolong >= konv.meta.wdfBungaPolong, konv.meta.wdfBungaPolong.toFixed(3) + " -> " + sli.meta.wdfBungaPolong.toFixed(3));
cek("paket menaikkan hasil", yR > yK, yK.toFixed(2) + " -> " + yR.toFixed(2) + " t/ha");
cek("irigasi kritis aktif di kemarau", sli.meta.nIrigasi > 0, sli.meta.nIrigasi + " event, " + sli.meta.totalIrigasi_mm.toFixed(1) + " mm");
cek("sinkron TU76 tepat waktu", sli.meta.tuPupuk >= 76 && sli.meta.tuPupuk < 95 && sli.meta.faktorSinkron > 0.99, "TU=" + sli.meta.tuPupuk.toFixed(1) + " f=" + sli.meta.faktorSinkron.toFixed(3));
cek("kaku 21 HST terlambat (penalti)", konv.meta.faktorSinkron <= 0.83, "TU=" + konv.meta.tuPupuk.toFixed(1) + " f=" + konv.meta.faktorSinkron.toFixed(3));
cek("pencucian P mulsa lebih kecil", sli.meta.P_tercuci_kg < konv.meta.P_tercuci_kg, konv.meta.P_tercuci_kg.toFixed(2) + " -> " + sli.meta.P_tercuci_kg.toFixed(2) + " kg");

const ev1 = A.evaluasiAdaptasi(konv, sli, { luasHa: 0.0782, harga: 5000 });
const ev2 = A.evaluasiAdaptasi(konv, sli, { luasHa: 0.0782, harga: 5000 });
cek("Monte Carlo deterministik (seed 450)", ev1.risikoK === ev2.risikoK && ev1.risikoR === ev2.risikoR, ev1.risikoK.toFixed(1) + "% -> " + ev1.risikoR.toFixed(1) + "%");
cek("risiko paket lebih rendah", ev1.risikoR < ev1.risikoK);
console.log("   ekonomi 782 m2: net konv Rp" + Math.round(ev1.netK).toLocaleString("id") + " | net paket Rp" + Math.round(ev1.netR).toLocaleString("id") + " | daerah " + ev1.daerahK.toFixed(0) + " -> " + ev1.daerahR.toFixed(0) + " ton (kuota 6400.4: " + (ev1.kuotaTercapai ? "TERCAPAI" : "DEFISIT") + ")");

// uji tuas tunggal: efek terisolasi
const hanyaMulsa = A.simulasiAdaptasi(prep, tgl, 2, 0.8, { mulsa: "jerami", dosisP: 58, jadwalP: "kaku_21hst", irigasi: false, pht: false });
const hanyaIrig = A.simulasiAdaptasi(prep, tgl, 2, 0.8, { mulsa: "bekas", dosisP: 58, jadwalP: "kaku_21hst", irigasi: true, pht: false });
const hanyaSinkron = A.simulasiAdaptasi(prep, tgl, 2, 0.8, { mulsa: "bekas", dosisP: 97.9, jadwalP: "sinkron_TU76", irigasi: false, pht: false });
cek("mulsa saja menaikkan hasil", hanyaMulsa.harian.at(-1).Polong_Segar_ton_ha > yK);
cek("irigasi saja menaikkan hasil", hanyaIrig.harian.at(-1).Polong_Segar_ton_ha > yK);
cek("sinkron+dosis saja menaikkan hasil", hanyaSinkron.harian.at(-1).Polong_Segar_ton_ha > yK);

// guard engine utama: partisi negatif & KA ekstrem tidak boleh menghasilkan biomassa negatif
const g = E.defaultParams();
g.partisi = [[-0.5, 0.2, 0.3, 0.0], [0.42, 0.40, 0.18, 0], [0.28, 0.27, 0.10, 0.35], [0.12, 0.13, 0, 0.75], [0.05, 0.05, 0, 0.90]];
g.kadar_air_polong = 0.999;
const rg = E.simulasiBuncis(prep, g, new Date("2024-03-01T00:00:00Z"), 3, 0.6);
const minG = Math.min(...rg.harian.flatMap(h => [h.Daun, h.Batang, h.Akar, h.Polong]));
cek("guard: organ >= 0 dgn partisi negatif & KA 0.999", minG >= 0, minG.toExponential(2));
cek("guard: residu bio tetap < 1e-12", Math.max(...rg.harian.map(h => Math.abs(h.ResiduBiomassa_gm2))) < 1e-12);
const sg = E.sanitizeParams(g);
cek("guard: KA diklem ke 0.97", sg.kadar_air_polong === 0.97);
cek("guard: baris partisi dinormalisasi = 1", Math.abs(sg.partisi[0].reduce((a, b) => a + b, 0) - 1) < 1e-12);
console.log("selesai");
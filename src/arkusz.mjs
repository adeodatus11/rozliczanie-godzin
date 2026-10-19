// Odczyt dotychczasowego arkusza „godziny rozliczone” / „godziny planowe”
// (wiersze = dni i bloki tygodniowe, kolumny = nauczyciele). Służy do
// przeniesienia konfiguracji nauczycieli i do porównań z ręcznym rozliczeniem.
import { dataIso, kluczOsoby } from "./wejscie.mjs";

const liczba = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const DNI = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek"];

/** {osoby: [{kol, naglowek, osoba, tygodnie, miesiac: {suma, doWyplaty}}], wolne: {data: opis}} */
export function czytajArkusz(wiersze, { miesiac }) {
  const naglowek = wiersze[0];
  const kolumny = [];
  for (let c = 6; c < naglowek.length; c++) if (String(naglowek[c]).trim()) kolumny.push(c);
  const osoby = kolumny.map((c) => ({ kol: c, naglowek: String(naglowek[c]), osoba: kluczOsoby(naglowek[c]), tygodnie: [], miesiac: {} }));
  const wolne = {};
  let dni = [];
  let tydz = null;
  for (const w of wiersze.slice(1)) {
    const etykieta = String(w[2] ?? "").trim();
    const data = dataIso(w[1]);
    if (data && DNI.includes(etykieta)) {
      if (!data.startsWith(miesiac)) break;
      if (String(w[4]).trim() === "nie") wolne[data] = String(w[5] || "wolne").trim();
      dni.push({ data, w });
      continue;
    }
    if (etykieta === "SUMA") {
      tydz = osoby.map((o) => ({
        dni: dni.map((d) => ({ data: d.data, wartosc: d.w[o.kol] ?? "" })),
        suma: liczba(w[o.kol]),
      }));
      tydz.forEach((t, i) => osoby[i].tygodnie.push(t));
      dni = [];
      continue;
    }
    if (!tydz) continue;
    const pole = {
      PENSUM: "pensum",
      "MAKS. PONADWYM.": "maks",
      UŚREDNIENIE: "usrednienie",
      "godziny wg pabs [wiersz kontrolny]": "plan",
      "PONADWYM. DO ROZLICZENIA": "doRozliczenia",
    }[etykieta];
    if (pole) tydz.forEach((t, i) => (t[pole] = liczba(w[osoby[i].kol]) ?? (String(w[osoby[i].kol]).trim() || null)));
    if (etykieta.startsWith("MIESIĄC - SUMA")) osoby.forEach((o) => (o.miesiac.suma = liczba(w[o.kol])));
    if (etykieta === "PONADWYMIAROWE DO WYPŁATY") {
      osoby.forEach((o) => (o.miesiac.doWyplaty = liczba(w[o.kol]) ?? String(w[o.kol]).trim()));
      break;
    }
  }
  return { osoby, wolne };
}

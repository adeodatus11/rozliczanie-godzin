// Konfiguracja nauczycieli odtworzona z dotychczasowego arkusza ROZLICZONE
// albo PLANOWE. To punkt startowy — w aplikacji każdą wartość można poprawić.
import { czytajArkusz } from "./arkusz.mjs";
import { r2, rozliczMiesiac, pensumNaDzien, dzienTygodnia } from "./silnik.mjs";
import { znajdzOsobe } from "./wejscie.mjs";

const liczba = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const najczestsza = (xs) => {
  const c = new Map();
  for (const x of xs.filter((x) => typeof x === "number")) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const nazwaZNaglowka = (h) => h.split("\n")[0].replace(/\s+(PLAN LEKCJI|UŚREDNIENIE)\s*$/i, "").replace(/\s*-\s*/g, "-").trim();

/** Dni pracy: 5 albo dni z lekcjami w planie — wariant zgodny z pensum wpisanym w arkuszu. */
function wybierzDniPracy(o, n, { miesiac, kalendarz, plan }) {
  const lekcje = plan ? plan[znajdzOsobe(o.osoba, Object.keys(plan))] : null;
  const zLekcjami = [1, 2, 3, 4, 5].filter((d) => (lekcje?.[d] ?? []).length);
  const warianty = [[1, 2, 3, 4, 5]];
  if (zLekcjami.length && zLekcjami.length < 5) warianty.push(zLekcjami);
  const ocena = (dniPracy) => {
    const m = rozliczMiesiac({ ...n, dniPracy }, { miesiac, kalendarz });
    return m.tygodnie.filter((t, i) => {
      const p = o.tygodnie[i]?.pensum;
      if (typeof p !== "number") return false;
      const k = (t.pensum - p) / pensumNaDzien({ ...n, dniPracy });
      return Math.abs(k - Math.round(k)) < 0.02 && k > -0.01;
    }).length;
  };
  return warianty.map((d) => [d, ocena(d)]).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Wiersze arkusza „godziny rozliczone” / „godziny planowe” → {klucz: konfiguracja}.
 * Kolumny „PLAN LEKCJI” (podgląd przy uśrednieniu) są pomijane.
 */
export function konfiguracjaZArkusza(arkusze, { plan = null } = {}) {
  const wiersze = arkusze["godziny rozliczone"] ?? arkusze["godziny planowe"];
  const pierwszaData = wiersze.slice(1).map((w) => w[1]).find((v) => /^\d{5}$/.test(String(v)));
  const miesiac = new Date(Date.UTC(1899, 11, 30) + Number(pierwszaData) * 864e5).toISOString().slice(0, 7);
  const { osoby, wolne } = czytajArkusz(wiersze, { miesiac });
  const kalendarz = Object.fromEntries(Object.keys(wolne).map((d) => [d, "wolne"]));
  const specjalisci = new Set((arkusze["plan psycholog-pedagog"] ?? []).flat().map((v) => String(v).trim()).filter(Boolean));
  const wynik = {};
  for (const o of osoby) {
    if (/PLAN LEKCJI/i.test(o.naglowek)) continue;
    const nazwa = nazwaZNaglowka(o.naglowek);
    const maks = najczestsza(o.tygodnie.map((t) => t.maks)) ?? 0;
    const planGodz = najczestsza(o.tygodnie.map((t) => t.plan));
    const usr = najczestsza(o.tygodnie.map((t) => t.usrednienie));
    const srednia = /UŚREDNIENIE/i.test(o.naglowek);
    const pelnePensum = o.tygodnie.filter((t) => t.dni.length === 5 && !t.dni.some((d) => kalendarz[d.data])).map((t) => t.pensum);
    const pensum = maks > 0 && (srednia ? usr : planGodz) != null ? r2((srednia ? usr : planGodz) - maks) : (najczestsza(pelnePensum) ?? 18);
    const tryb = srednia ? "srednia" : specjalisci.has(nazwa) || pensum >= 22 ? "staly" : "tematy";
    const pelny = o.tygodnie.find((t) => t.dni.length === 5 && t.dni.every((d) => liczba(d.wartosc) != null));
    const dzienne = tryb === "tematy" || !pelny ? undefined : Object.fromEntries(pelny.dni.map((d) => [dzienTygodnia(d.data), liczba(d.wartosc)]));
    const od = o.tygodnie.flatMap((t) => t.dni).find((d) => d.wartosc !== "x" && !kalendarz[d.data])?.data;
    const n = { nazwa, tryb, pensum, maks, dniPracy: [1, 2, 3, 4, 5], ...(dzienne && { dzienne }), ...(od > `${miesiac}-02` && { od }) };
    if (tryb === "tematy") n.dniPracy = wybierzDniPracy(o, n, { miesiac, kalendarz, plan });
    const znizka = /zniżka/i.test(o.naglowek);
    if (znizka) n.uwagi = "zniżka — kadra kierownicza";
    wynik[o.osoba] = n;
  }
  return wynik;
}

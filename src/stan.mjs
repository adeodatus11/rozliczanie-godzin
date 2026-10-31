// Stan rozliczenia — jeden obiekt zapisywany do pliku JSON (OneDrive).
// Zawiera dane osobowe nauczycieli i powody nieobecności: nie publikować.
import { KALENDARZ_2026_2027 } from "./kalendarz.mjs";

export const WERSJA = 1;

export function nowyStan() {
  return {
    wersja: WERSJA,
    rokSzkolny: "2026/2027",
    zapisano: null,
    nauczyciele: {}, // klucz → {nazwa, tryb, pensum, dniPracy, maks, dzienne?, od?, do?, uwagi?}
    kalendarz: structuredClone(KALENDARZ_2026_2027), // data → {opis, czesciowy?}
    plany: [], // [{od, zrodlo, plan: {osoba: {1..5: [pory]}}}]
    realizacja: {}, // osoba → data → {godziny, lekcje, ind, zastepstwa, szkoly}
    zestawienie: { nieobecnosci: {}, zastepstwa: {} },
    informacje: { zastepstwa: {}, przeniesienia: {} }, // „InformacjeOZastepstwach”, „InformacjeOPrzeniesieniach”
    zrodla: [], // [{rodzaj, plik, od, do, wczytano}]
    decyzje: {}, // osoba → data → {odliczenie?, zPlanu?, godziny?, ind?, kkz?, dorazne?, uwaga?, kiedy}
  };
}

export function wczytajStan(tekst) {
  const s = JSON.parse(tekst);
  if (s?.wersja !== WERSJA || typeof s.nauczyciele !== "object") throw Error("To nie jest plik rozliczenia godzin (inna wersja albo uszkodzony plik).");
  return { ...nowyStan(), ...s };
}

export const zapiszStan = (s) => JSON.stringify({ ...s, zapisano: new Date().toISOString() }, null, 1);

/** Zastępuje dane z zakresu dat [od, do] nowymi (ponowne wgranie tego samego tygodnia nie dubluje godzin). */
function podmienZakres(cel, nowe, od, doDnia) {
  for (const osoba of Object.keys(cel))
    for (const data of Object.keys(cel[osoba])) if (data >= od && data <= doDnia) delete cel[osoba][data];
  for (const [osoba, dni] of Object.entries(nowe)) Object.assign((cel[osoba] ??= {}), dni);
}

export function dodajTematy(s, realizacja, plik) {
  const daty = Object.values(realizacja).flatMap((d) => Object.keys(d)).sort();
  const od = daty[0];
  const doDnia = daty.at(-1);
  podmienZakres(s.realizacja, realizacja, od, doDnia);
  s.zrodla.push({ rodzaj: "tematy", plik, od, do: doDnia, wczytano: new Date().toISOString() });
  return { od, do: doDnia, osob: Object.keys(realizacja).length };
}

export function dodajZestawienie(s, z, plik) {
  podmienZakres(s.zestawienie.nieobecnosci, z.nieobecnosci, z.okres.od, z.okres.do);
  podmienZakres(s.zestawienie.zastepstwa, z.zastepstwa, z.okres.od, z.okres.do);
  s.zrodla.push({ rodzaj: "zestawienie", plik, ...z.okres, wczytano: new Date().toISOString() });
  return z.okres;
}

/** rodzaj: "zastepstwa" (InformacjeOZastepstwach) albo "przeniesienia" (InformacjeOPrzeniesieniach). */
export function dodajInformacje(s, rodzaj, okres, dane, plik) {
  podmienZakres(s.informacje[rodzaj], dane, okres.od, okres.do);
  s.zrodla.push({ rodzaj, plik, ...okres, wczytano: new Date().toISOString() });
  return okres;
}

export function dodajPlan(s, plan, od, zrodlo) {
  s.plany = s.plany.filter((p) => p.od !== od);
  s.plany.push({ od, zrodlo, plan });
  s.plany.sort((a, b) => a.od.localeCompare(b.od));
}

/** Plan obowiązujący w danym dniu (ostatni z datą „od” nie późniejszą). */
export const planNaDzien = (s, data) => s.plany.filter((p) => p.od <= data).at(-1)?.plan ?? null;

export function ustawDecyzje(s, osoba, data, decyzja) {
  const d = (s.decyzje[osoba] ??= {});
  if (!decyzja || !Object.keys(decyzja).length) delete d[data];
  else d[data] = { ...decyzja, kiedy: new Date().toISOString() };
}

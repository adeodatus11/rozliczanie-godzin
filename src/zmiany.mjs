// Odczyt „ZbiorczeZestawienieZmian”, „InformacjeOZastepstwach” i
// „InformacjeOPrzeniesieniach” (VULCAN): powody nieobecności nauczycieli,
// formy płatności zastępstw i przeniesione lekcje. Zostają wyłącznie dane potrzebne do rozliczenia:
// osoba, data, numer lekcji, powód, forma płatności. Nazwy dzienników (mogą
// zawierać dane uczniów) i arkusze z oddziałami są odrzucane od razu.
import { dataIso, kluczOsoby } from "./wejscie.mjs";

function tabela(wiersze, wymagane, nazwa) {
  const naglowek = (wiersze?.[0] ?? []).map((h) => String(h).trim());
  const brak = wymagane.filter((k) => !naglowek.includes(k));
  if (brak.length) throw Error(`Zestawienie zmian, arkusz „${nazwa}”: brak kolumn ${brak.join(", ")}.`);
  const k = Object.fromEntries(naglowek.map((h, i) => [h, i]));
  return wiersze.slice(1).filter((w) => w?.[k["Data"]] !== "" && w?.[k["Data"]] != null).map((w) => (kol) => String(w[k[kol]] ?? "").trim());
}

/**
 * {okres: {od, do}, nieobecnosci: {osoba: {data: {powody: [], lekcje: []}}},
 *  zastepstwa: {zastępca: {data: [{lekcja, forma, skutek, przedmiot, zaKogo, oddzial}]}}}
 */
export function czytajZestawienie(arkusze) {
  const nieobecnosci = {};
  const zastepstwa = {};
  const daty = [];
  // Nieobecna lekcja trafia albo do „Dane nieobecności” (bez zastępstwa),
  // albo do „Dane zastępstwa” (z zastępcą) — powód jest w obu.
  function nieobecny(w) {
    const data = dataIso(w("Data"));
    if (!data) return null;
    daty.push(data);
    const d = ((nieobecnosci[kluczOsoby(w("Prowadzący"))] ??= {})[data] ??= { powody: [], lekcje: [] });
    const powod = w("Powód nieobecności") || "(bez powodu)";
    if (!d.powody.includes(powod)) d.powody.push(powod);
    const nr = Number(w("Numer lekcji"));
    if (w("Typ danych") === "Oddział" && nr && !d.lekcje.includes(nr)) d.lekcje.push(nr);
    d.lekcje.sort((a, b) => a - b);
    return data;
  }
  for (const w of tabela(arkusze["Dane nieobecności"], ["Data", "Numer lekcji", "Typ danych", "Prowadzący", "Powód nieobecności"], "Dane nieobecności")) nieobecny(w);
  for (const w of tabela(arkusze["Dane zastępstwa"], ["Data", "Numer lekcji", "Typ danych", "Prowadzący", "Zastępstwo", "Forma płatności"], "Dane zastępstwa")) {
    nieobecny(w);
    if (w("Typ danych") !== "Oddział") continue;
    const data = dataIso(w("Data"));
    const zastepca = w("Zastępstwo");
    if (!data || !zastepca || !/\[/.test(zastepca)) continue; // „Zastępstwo” bez nazwiska = brak zastępcy
    daty.push(data);
    ((zastepstwa[kluczOsoby(zastepca)] ??= {})[data] ??= []).push({
      lekcja: Number(w("Numer lekcji")),
      forma: w("Forma płatności") || null,
      skutek: w("Skutek nieobecności") || null,
      przedmiot: w("Realizowana nazwa zajęć") || w("Nazwa zajęć") || null,
      zaKogo: w("Prowadzący").replace(/\s*\[.*?\]\s*$/, ""),
      oddzial: w("Oddział/dziennik/grupa/miejsce dyżuru z podziałem") || w("Oddział/dziennik/grupa/miejsce dyżuru"),
    });
  }
  return { okres: okresZOpisu(arkusze, daty), nieobecnosci, zastepstwa };
}

/** Okres z arkusza „Opis parametrów” („Okres: 01.10.2026 (czw.) - 01.11.2026 (niedz.)”). */
function okresZOpisu(arkusze, daty) {
  const opis = (arkusze["Opis parametrów"] ?? []).map((w) => String(w?.[0] ?? "")).join(" ");
  const m = opis.match(/(\d{2}\.\d{2}\.\d{4}).*?(\d{2}\.\d{2}\.\d{4})/);
  const d = daty.slice().sort();
  return m ? { od: dataIso(m[1]), do: dataIso(m[2]) } : { od: d[0], do: d.at(-1) };
}

const naglowekOddzialow = (arkusze) => (arkusze["Oddziały"]?.[0] ?? []).map((h) => String(h).trim());

/**
 * „InformacjeOZastepstwach” (VULCAN), arkusz „Oddziały” → {okres, zastepstwa} jak w
 * czytajZestawienie. Służy do kontroli form płatności ze zbiorczego zestawienia
 * (i zastępuje je, gdy zestawienia za dany dzień nie ma). Arkusze „Dzienniki zajęć
 * innych” (nazwiska uczniów IN) i „Dyżury” są pomijane.
 */
export function czytajInformacjeOZastepstwach(arkusze) {
  const wiersze = arkusze["Oddziały"];
  const naglowek = naglowekOddzialow(arkusze);
  const k = Object.fromEntries(naglowek.map((h, i) => [h, i]));
  const brak = ["Dzień", "Lekcja", "Nauczyciel/wakat", "Zastępca", "Forma płatności"].filter((x) => k[x] == null);
  if (brak.length) throw Error(`Informacje o zastępstwach: brak kolumn ${brak.join(", ")}.`);
  const zastepstwa = {};
  const daty = [];
  for (const w of wiersze.slice(1)) {
    const pole = (kol) => String(w[k[kol]] ?? "").trim();
    const data = dataIso(pole("Dzień"));
    const lekcja = parseInt(pole("Lekcja"), 10);
    const forma = pole("Forma płatności");
    if (!data || !lekcja) continue;
    daty.push(data);
    if (!forma || forma === "-") continue; // „Uczniowie przychodzą później”, „Przeniesiona” itp. — bez zastępcy
    ((zastepstwa[kluczOsoby(pole("Zastępca"))] ??= {})[data] ??= []).push({ lekcja, forma, skutek: null, przedmiot: pole("Przedmiot") || null, zaKogo: pole("Nauczyciel/wakat"), oddzial: pole("Oddział") });
  }
  return { okres: okresZOpisu(arkusze, daty), zastepstwa };
}

const terminLekcji = (tekst) => {
  const [data, lekcja] = String(tekst).split(",").map((x) => x.trim());
  return { data: dataIso(data), lekcja: parseInt(lekcja, 10) };
};

/**
 * „InformacjeOPrzeniesieniach” (VULCAN), arkusz „Oddziały” →
 * {okres, przeniesienia: {osoba: {data: {z: [lekcje], na: [lekcje]}}}}.
 * Sama zmiana sali (ta sama lekcja tego samego dnia) jest pomijana.
 */
export function czytajPrzeniesienia(arkusze) {
  const wiersze = arkusze["Oddziały"];
  const naglowek = naglowekOddzialow(arkusze);
  const k = Object.fromEntries(naglowek.map((h, i) => [h, i]));
  const brak = ["Przeniesiono z", "Przeniesiono na", "Nauczyciel/wakat"].filter((x) => k[x] == null);
  if (brak.length) throw Error(`Informacje o przeniesieniach: brak kolumn ${brak.join(", ")}.`);
  const przeniesienia = {};
  const daty = [];
  const dodaj = (osoba, t, strona) => {
    const d = ((przeniesienia[osoba] ??= {})[t.data] ??= { z: [], na: [] });
    if (!d[strona].includes(t.lekcja)) d[strona].push(t.lekcja);
    d[strona].sort((a, b) => a - b);
  };
  for (const w of wiersze.slice(1)) {
    const z = terminLekcji(w[k["Przeniesiono z"]]);
    const na = terminLekcji(w[k["Przeniesiono na"]]);
    if (!z.data || !z.lekcja) continue;
    daty.push(z.data);
    if (!na.data || !na.lekcja || (na.data === z.data && na.lekcja === z.lekcja)) continue;
    const osoby = [w[k["Nauczyciel/wakat"]], w[k["Nauczyciel/wakat wspomagający"]]].map((x) => String(x ?? "").trim()).filter((x) => x && x !== "-");
    for (const o of osoby) {
      dodaj(kluczOsoby(o), z, "z");
      dodaj(kluczOsoby(o), na, "na");
    }
  }
  return { okres: okresZOpisu(arkusze, daty), przeniesienia };
}

/** Rozpoznaje rodzaj wczytanego skoroszytu po nazwach arkuszy. */
export function rodzajSkoroszytu(arkusze) {
  const nazwy = Object.keys(arkusze);
  if (nazwy.includes("Wykaz zrealizowanych tematów")) return "tematy";
  if (nazwy.includes("Dane nieobecności") && nazwy.includes("Dane zastępstwa")) return "zestawienie";
  const oddzialy = naglowekOddzialow(arkusze);
  if (oddzialy.includes("Przeniesiono z")) return "przeniesienia";
  if (oddzialy.includes("Zastępca") && oddzialy.includes("Forma płatności")) return "zastepstwa";
  if (nazwy.includes("godziny rozliczone") || nazwy.includes("godziny planowe")) return "arkusz";
  return null;
}

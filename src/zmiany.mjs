// Odczyt „ZbiorczeZestawienieZmian” (VULCAN): powody nieobecności nauczycieli
// i formy płatności zastępstw. Zostają wyłącznie dane potrzebne do rozliczenia:
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
 *  zastepstwa: {zastępca: {data: [{lekcja, forma, skutek, zaKogo, oddzial}]}}}
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
      zaKogo: w("Prowadzący").replace(/\s*\[.*?\]\s*$/, ""),
      oddzial: w("Oddział/dziennik/grupa/miejsce dyżuru z podziałem") || w("Oddział/dziennik/grupa/miejsce dyżuru"),
    });
  }
  const opis = String(arkusze["Opis parametrów"]?.[1]?.[0] ?? "");
  const m = opis.match(/(\d{2}\.\d{2}\.\d{4}).*?(\d{2}\.\d{2}\.\d{4})/);
  const okres = m ? { od: dataIso(m[1]), do: dataIso(m[2]) } : { od: daty.sort()[0], do: daty.sort().at(-1) };
  return { okres, nieobecnosci, zastepstwa };
}

/** Rozpoznaje rodzaj wczytanego skoroszytu po nazwach arkuszy. */
export function rodzajSkoroszytu(arkusze) {
  const nazwy = Object.keys(arkusze);
  if (nazwy.includes("Wykaz zrealizowanych tematów")) return "tematy";
  if (nazwy.includes("Dane nieobecności") && nazwy.includes("Dane zastępstwa")) return "zestawienie";
  if (nazwy.includes("godziny rozliczone") || nazwy.includes("godziny planowe")) return "arkusz";
  return null;
}

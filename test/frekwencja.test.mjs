// Frekwencja ucznia na danych zmyślonych (repozytorium jest publiczne —
// żadnych prawdziwych uczniów).
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { rodzajWpisu, rozpoznajTabele, czytajWpisy, rozpoznajMacierz, czytajMacierz, parametryZestawienia, domyslneRodzaje, polaczWpisy, listaUczniow, frekwencjaUcznia, zakresDat } from "../src/frekwencja.mjs";
import { czytajCsv, czytajHtml, dekoduj } from "../src/tabele.mjs";

// Eksport z tytułem i parametrami nad tabelą, jeden wiersz = jedna lekcja.
const WPISY = [
  ["Frekwencja uczniów"],
  ["Okres: 01.09.2026 - 30.10.2026"],
  [],
  ["Lp.", "Oddział", "Uczeń", "Data", "Nr lekcji", "Przedmiot", "Kategoria frekwencji"],
  ["1", "1A", "Testowy Adam", "01.09.2026", "1", "Matematyka", "Obecność"],
  ["2", "1A", "Testowy Adam", "01.09.2026", "2", "Matematyka", "Spóźnienie"],
  ["3", "1A", "Testowy Adam", "01.09.2026", "3", "Język polski", "Nieobecność nieusprawiedliwiona"],
  ["4", "1A", "Testowy Adam", "02.09.2026", "1", "Język polski", "Nieobecność usprawiedliwiona"],
  ["5", "1A", "Testowy Adam", "02.09.2026", "2", "Wychowanie fizyczne", "Zwolniony z zajęć"],
  ["6", "1A", "Testowy Adam", "05.10.2026", "1", "Matematyka", "Nieobecność z przyczyn szkolnych"],
  ["7", "1A", "Testowy Adam", "05.10.2026", "2", "Matematyka", "Obecność"],
  ["8", "1A", "Testowy Adam", "05.10.2026", "3", "Matematyka", "Nieobecność nieusprawiedliwiona"],
  ["9", "2B", "Przykładowa Ewa", "01.09.2026", "1", "Historia", "Obecność"],
];

test("rodzaje wpisów VULCAN i symbole", () => {
  assert.equal(rodzajWpisu("Obecność"), "obecny");
  assert.equal(rodzajWpisu("Nieobecność"), "nieusprawiedliwiona");
  assert.equal(rodzajWpisu("Nieobecność nieusprawiedliwiona"), "nieusprawiedliwiona");
  assert.equal(rodzajWpisu("nieobecność usprawiedliwiona"), "usprawiedliwiona");
  assert.equal(rodzajWpisu("Spóźnienie usprawiedliwione"), "obecny");
  assert.equal(rodzajWpisu("Nieobecność z przyczyn szkolnych"), "obecny");
  assert.equal(rodzajWpisu("Zwolnienie"), "usprawiedliwiona");
  assert.equal(rodzajWpisu("Zwolniony obecny"), "obecny");
  assert.equal(rodzajWpisu("nb"), "nieusprawiedliwiona");
  assert.equal(rodzajWpisu("u"), "usprawiedliwiona");
  assert.equal(rodzajWpisu("coś innego"), null);
});

test("tabela pod tytułem: nagłówek, kolumny, wpisy", () => {
  const t = rozpoznajTabele(WPISY);
  assert.equal(t.wiersz, 3);
  assert.equal(t.uklad, "wpisy");
  assert.deepEqual(t.kolumny, { oddzial: 1, uczen: 2, data: 3, lekcja: 4, przedmiot: 5, wpis: 6 });
  const wpisy = czytajWpisy(WPISY, t);
  assert.equal(wpisy.length, 9);
  assert.deepEqual(listaUczniow(wpisy).map((u) => u.klucz), ["Testowy Adam|1A", "Przykładowa Ewa|2B"]);
  assert.deepEqual(zakresDat(wpisy), { od: "2026-09-01", do: "2026-10-05" });
});

test("frekwencja ze wszystkich przedmiotów w wybranym okresie", () => {
  const t = rozpoznajTabele(WPISY);
  const wpisy = czytajWpisy(WPISY, t);
  const rodzaje = domyslneRodzaje([...new Set(wpisy.map((w) => w.etykieta))], "wpisy");
  assert.equal(rodzaje["Zwolniony z zajęć"], "usprawiedliwiona");
  rodzaje["Zwolniony z zajęć"] = "pomin"; // zwolniony z WF — poza rachunkiem

  const caly = frekwencjaUcznia(wpisy, "Testowy Adam|1A", { od: "2026-09-01", do: "2026-10-31" }, rodzaje);
  assert.equal(caly.zajecia, 7);
  assert.equal(caly.obecny, 4); // obecność, spóźnienie, przyczyny szkolne, obecność
  assert.equal(caly.nieusprawiedliwiona, 2);
  assert.equal(caly.usprawiedliwiona, 1);
  assert.equal(caly.pomin, 1);
  assert.equal(caly.frekwencja, 57.14);
  assert.equal(caly.procentNieusprawiedliwionych, 28.57);
  assert.deepEqual(caly.przedmioty.map((p) => [p.przedmiot, p.zajecia]), [["Język polski", 2], ["Matematyka", 5], ["Wychowanie fizyczne", 0]]);

  const wrzesien = frekwencjaUcznia(wpisy, "Testowy Adam|1A", { od: "2026-09-01", do: "2026-09-30" }, rodzaje);
  assert.equal(wrzesien.zajecia, 4);
  assert.equal(wrzesien.frekwencja, 50);
  assert.equal(wrzesien.nieusprawiedliwiona, 1);
  assert.equal(wrzesien.procentNieusprawiedliwionych, 25);
  assert.deepEqual(wrzesien.dane, { od: "2026-09-01", do: "2026-09-02" });

  const pusty = frekwencjaUcznia(wpisy, "Testowy Adam|1A", { od: "2026-11-01", do: "2026-11-30" }, rodzaje);
  assert.equal(pusty.zajecia, 0);
  assert.equal(pusty.frekwencja, null);
});

test("wpisy bez przypisanego rodzaju nie są liczone, ale są zgłaszane", () => {
  const w = [["Uczeń", "Data", "Wpis"], ["Testowy Adam", "2026-09-01", "Obecność"], ["Testowy Adam", "2026-09-01", "???"]];
  const wpisy = czytajWpisy(w, rozpoznajTabele(w));
  const f = frekwencjaUcznia(wpisy, "Testowy Adam|", {}, domyslneRodzaje(["Obecność", "???"], "wpisy"));
  assert.equal(f.zajecia, 1);
  assert.equal(f.nieprzypisane, 1);
  assert.deepEqual(f.nieprzypisaneEtykiety, ["???"]);
});

test("ten sam wpis z dwóch plików liczy się raz", () => {
  const t = rozpoznajTabele(WPISY);
  const a = czytajWpisy(WPISY, t);
  const b = czytajWpisy(WPISY.slice(0, 6), t);
  assert.equal(polaczWpisy([a, b]).length, a.length);
});

test("układ z sumami: osobne nazwisko i imię, kolumna ogólna „Nieobecności” nie dubluje", () => {
  const w = [
    ["Zestawienie frekwencji"],
    ["Lp.", "Nazwisko", "Imię", "Klasa", "Obecności", "Spóźnienia", "Nieobecności", "Nieobecności usprawiedliwione", "Nieobecności nieusprawiedliwione", "Frekwencja %"],
    ["1", "Testowy", "Adam", "3C", "90", "5", "15", "12", "3", "86,36"],
    ["", "Razem", "", "", "90", "5", "15", "12", "3", ""],
  ];
  const t = rozpoznajTabele(w);
  assert.equal(t.uklad, "sumy");
  assert.equal(t.wiersz, 1);
  assert.deepEqual(t.sumy, [4, 5, 6, 7, 8]);
  const wpisy = czytajWpisy(w, t);
  assert.deepEqual(listaUczniow(wpisy).map((u) => u.klucz), ["Testowy Adam|3C"]);
  const rodzaje = domyslneRodzaje([...new Set(wpisy.map((x) => x.etykieta))], "sumy");
  assert.equal(rodzaje["Nieobecności"], "pomin");
  const f = frekwencjaUcznia(wpisy, "Testowy Adam|3C", { od: "2026-09-01", do: "2026-09-30" }, rodzaje);
  assert.equal(f.zajecia, 110);
  assert.equal(f.frekwencja, 86.36);
  assert.equal(f.procentNieusprawiedliwionych, 2.73);
  assert.ok(f.bezDat);
});

test("CSV (średnik, cudzysłowy, windows-1250) i tabela HTML", () => {
  const csv = 'Uczeń;Data;Wpis\r\n"Testowy; Adam";2026-09-01;"Obecność"\r\nPrzykładowa Ewa;2026-09-01;nb\r\n';
  const bajty = Uint8Array.from([...csv].map((c) => ({ "ś": 0x9c, "ć": 0xe6, "ł": 0xb3 })[c] ?? c.charCodeAt(0)));
  const wiersze = czytajCsv(dekoduj(bajty));
  assert.deepEqual(wiersze[1], ["Testowy; Adam", "2026-09-01", "Obecność"]);
  assert.equal(wiersze.length, 3);
  const html = `<table><tr><td colspan="2">Tytuł</td></tr><tr><th>Uczeń</th><th>Data</th><th>Wpis</th></tr><tr><td>Testowy Adam</td><td>01.09.2026</td><td>u</td></tr></table>`;
  const arkusz = czytajHtml(html, DOMParser)["Tabela 1"];
  assert.deepEqual(arkusz[0], ["Tytuł", "Tytuł"]);
  const wpisy = czytajWpisy(arkusz, rozpoznajTabele(arkusz));
  assert.deepEqual(wpisy, [{ uczen: "Testowy Adam", oddzial: "", data: "2026-09-01", przedmiot: "", lekcja: "", etykieta: "u", n: 1 }]);
});

// Układ „ZestawienieFrekwencjeNaLekcjachPrzedmiotow” (VULCAN): blok kolumn na przedmiot,
// symbol z parą (liczba, %) jest w podstawie frekwencji, sam licznik (p) — nie.
function zestawienie(okres) {
  const blok = ["●", "●", "▬", "▬", "u", "u", "s", "s", "L4", "L4", "p", "% frekwencji"];
  const komorki = (ob, nb, u, s, l4, p, proc) => [`${ob} `, "", `${nb} `, "", `${u} `, "", `${s} `, "", `${l4} `, "", String(p), proc];
  return {
    "Opis parametrów": [["Rok szkolny: 2026/2027;"], [`Badany okres: ${okres};`], ["Dziennik: 1A (T);"]],
    "Frekwencja oddziałów": [
      ["Dziennik", "Uczeń, nr w dzienniku", "Matematyka (mat)", ...Array(11).fill(""), "Historia (hist)", ...Array(11).fill(""), "Wszystkie wpisy", ...Array(11).fill("")],
      ["", "", ...blok, ...blok, ...blok],
      // „Wszystkie wpisy” ma jedną lekcję więcej niż przedmioty (zajęcia spoza listy) — jak w VULCAN
      ["1A (T)", "Testowy Adam, nr 1", ...komorki(6, 2, 1, 1, 0, 3, "70%"), ...komorki(4, 0, 0, 0, 2, 0, "66,67%"), ...komorki(11, 2, 1, 1, 2, 3, "70,59%")],
      ["1A (T)", "Przykładowa Ewa, nr 2", ...komorki(0, 0, 0, 0, 0, 0, "brak"), ...komorki(3, 0, 0, 0, 0, 0, "100%"), ...komorki(3, 0, 0, 0, 0, 0, "100%")],
    ],
  };
}

test("zestawienie VULCAN: podstawa jak w VULCAN, suma z „Wszystkie wpisy”, okres eksportu", () => {
  const arkusze = zestawienie("01.09.2026 - 21.10.2026");
  const { okres, dziennik } = parametryZestawienia(arkusze);
  assert.deepEqual(okres, { od: "2026-09-01", do: "2026-10-21" });
  assert.equal(dziennik, "1A (T)");
  const t = rozpoznajMacierz(arkusze["Frekwencja oddziałów"]);
  assert.equal(rozpoznajMacierz(arkusze["Opis parametrów"]), null);
  assert.deepEqual(t.bloki.map((b) => [b.przedmiot, b.razem]), [["Matematyka", false], ["Historia", false], ["Wszystkie wpisy", true]]);
  assert.deepEqual(t.pozaPodstawa, ["p"]);
  const wpisy = czytajMacierz(arkusze["Frekwencja oddziałów"], t).map((w) => ({ ...w, zrodlo: "a.xlsx", okres }));
  assert.deepEqual(listaUczniow(wpisy).map((u) => u.klucz), ["Przykładowa Ewa|1A (T)", "Testowy Adam|1A (T)"]);
  const rodzaje = domyslneRodzaje([...new Set(wpisy.map((w) => w.etykieta))], "wpisy", t.pozaPodstawa);
  assert.deepEqual(rodzaje, { "●": "obecny", "▬": "nieusprawiedliwiona", u: "usprawiedliwiona", s: "obecny", p: "pomin", L4: "usprawiedliwiona" });

  const f = frekwencjaUcznia(wpisy, "Testowy Adam|1A (T)", okres, rodzaje);
  assert.equal(f.zajecia, 17);
  assert.equal(f.frekwencja, 70.59);
  assert.equal(f.procentVulcan, 70.59);
  assert.equal(f.nieusprawiedliwiona, 2);
  assert.equal(f.procentNieusprawiedliwionych, 11.76);
  assert.equal(f.pomin, 3);
  assert.ok(f.tylkoOkresy);
  assert.deepEqual(f.przedmioty.map((p) => [p.przedmiot, p.zajecia]), [["Historia", 6], ["Matematyka", 10], ["inne wpisy (poza listą przedmiotów)", 1]]);

  // Stały okres eksportu: węższy wybór go nie obejmuje.
  const wrzesien = frekwencjaUcznia(wpisy, "Testowy Adam|1A (T)", { od: "2026-09-01", do: "2026-09-30" }, rodzaje);
  assert.equal(wrzesien.zajecia, 0);
  assert.deepEqual(wrzesien.poza, [{ zrodlo: "a.xlsx", ...okres }]);

  // Ten sam eksport pod inną nazwą nie liczy się podwójnie.
  const kopia = wpisy.map((w) => ({ ...w, zrodlo: "b.xlsx" }));
  const dwa = frekwencjaUcznia([...wpisy, ...kopia], "Testowy Adam|1A (T)", okres, rodzaje);
  assert.equal(dwa.zajecia, 17);
  assert.equal(dwa.procentVulcan, 70.59);
});

test("okres zaświadczenia składa się z eksportów miesięcznych, bez podwójnego liczenia", () => {
  const wczytaj = (plik, opis) => {
    const arkusze = zestawienie(opis);
    const t = rozpoznajMacierz(arkusze["Frekwencja oddziałów"]);
    const { okres } = parametryZestawienia(arkusze);
    return czytajMacierz(arkusze["Frekwencja oddziałów"], t).map((w) => ({ ...w, zrodlo: plik, okres }));
  };
  const wpisy = [
    ...wczytaj("wrzesien.xlsx", "01.09.2026 - 30.09.2026"),
    ...wczytaj("pazdziernik.xlsx", "01.10.2026 - 31.10.2026"),
    ...wczytaj("listopad.xlsx", "02.11.2026 - 30.11.2026"),
    ...wczytaj("calosc.xlsx", "01.09.2026 - 31.10.2026"),
  ];
  const rodzaje = domyslneRodzaje([...new Set(wpisy.map((w) => w.etykieta))], "wpisy", ["p"]);
  const ucz = "Testowy Adam|1A (T)";

  const pazdziernik = frekwencjaUcznia(wpisy, ucz, { od: "2026-10-01", do: "2026-10-31" }, rodzaje);
  assert.equal(pazdziernik.zajecia, 17);
  assert.deepEqual(pazdziernik.okresy, [{ od: "2026-10-01", do: "2026-10-31" }]);
  assert.deepEqual(pazdziernik.poza.map((o) => o.zrodlo), ["calosc.xlsx"]);

  // wrzesień–październik: jeden eksport za całość zamiast dwóch miesięcznych (te same dni, mniej plików)
  const dwaMiesiace = frekwencjaUcznia(wpisy, ucz, { od: "2026-09-01", do: "2026-10-31" }, rodzaje);
  assert.equal(dwaMiesiace.zajecia, 17);
  assert.equal(dwaMiesiace.procentVulcan, 70.59);
  assert.deepEqual(dwaMiesiace.luki, []);

  // wrzesień–listopad: 1.11 to niedziela, więc okresy łączą się w jeden; trzy pliki niezachodzące
  const trzy = frekwencjaUcznia(wpisy, ucz, { od: "2026-09-01", do: "2026-11-30" }, rodzaje);
  assert.equal(trzy.zajecia, 34);
  assert.deepEqual(trzy.okresy, [{ od: "2026-09-01", do: "2026-11-30" }]);
  assert.equal(trzy.procentVulcan, null);

  // brak października: luka i dwa osobne okresy na zaświadczeniu
  const bezPazdziernika = wpisy.filter((w) => !["pazdziernik.xlsx", "calosc.xlsx"].includes(w.zrodlo));
  const zLuka = frekwencjaUcznia(bezPazdziernika, ucz, { od: "2026-09-01", do: "2026-11-30" }, rodzaje);
  assert.deepEqual(zLuka.okresy, [{ od: "2026-09-01", do: "2026-09-30" }, { od: "2026-11-02", do: "2026-11-30" }]);
  assert.deepEqual(zLuka.luki, [{ od: "2026-10-01", do: "2026-11-01" }]);
});

test("różnica eksportów o wspólnym początku daje okres pośrodku; niespójna różnica jest zgłaszana", () => {
  const wczytaj = (plik, opis, mnoznik = 1) => {
    const arkusze = zestawienie(opis);
    const t = rozpoznajMacierz(arkusze["Frekwencja oddziałów"]);
    const { okres } = parametryZestawienia(arkusze);
    return czytajMacierz(arkusze["Frekwencja oddziałów"], t).map((w) => ({ ...w, n: w.n * mnoznik, zrodlo: plik, okres }));
  };
  const narastajaco = wczytaj("do-21-10.xlsx", "01.09.2026 - 21.10.2026", 2);
  const wrzesien = wczytaj("wrzesien.xlsx", "01.09.2026 - 30.09.2026");
  const rodzaje = domyslneRodzaje([...new Set(wrzesien.map((w) => w.etykieta))], "wpisy", ["p"]);
  const ucz = "Testowy Adam|1A (T)";

  const pazdziernik = frekwencjaUcznia([...narastajaco, ...wrzesien], ucz, { od: "2026-10-01", do: "2026-10-21" }, rodzaje);
  assert.equal(pazdziernik.zajecia, 17); // 34 − 17
  assert.equal(pazdziernik.frekwencja, 70.59);
  assert.equal(pazdziernik.procentVulcan, null);
  assert.deepEqual(pazdziernik.okresy, [{ od: "2026-10-01", do: "2026-10-21" }]);
  assert.deepEqual(pazdziernik.eksporty, [{ zrodlo: "do-21-10.xlsx − wrzesien.xlsx", od: "2026-10-01", do: "2026-10-21", roznica: true }]);
  assert.deepEqual(pazdziernik.przedmioty.map((p) => [p.przedmiot, p.zajecia]), [["Historia", 6], ["Matematyka", 10], ["inne wpisy (poza listą przedmiotów)", 1]]);
  assert.deepEqual(pazdziernik.luki, []);

  // cały okres: prawdziwy eksport, nie wrzesień + różnica
  const calosc = frekwencjaUcznia([...narastajaco, ...wrzesien], ucz, { od: "2026-09-01", do: "2026-10-21" }, rodzaje);
  assert.equal(calosc.zajecia, 34);
  assert.deepEqual(calosc.eksporty.map((o) => o.zrodlo), ["do-21-10.xlsx"]);

  // wrzesień zrobiony później, z innymi liczbami niż narastający — różnica ujemna
  const zmieniony = wczytaj("wrzesien-pozniej.xlsx", "01.09.2026 - 30.09.2026", 3);
  const zle = frekwencjaUcznia([...narastajaco, ...zmieniony], ucz, { od: "2026-10-01", do: "2026-10-21" }, rodzaje);
  assert.equal(zle.zajecia, 0);
  assert.deepEqual(zle.niespojne, [{ zrodlo: "do-21-10.xlsx − wrzesien-pozniej.xlsx", od: "2026-10-01", do: "2026-10-21" }]);
});

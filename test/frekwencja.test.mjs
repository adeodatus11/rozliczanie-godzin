// Frekwencja ucznia na danych zmyślonych (repozytorium jest publiczne —
// żadnych prawdziwych uczniów).
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { rodzajWpisu, rozpoznajTabele, czytajWpisy, domyslneRodzaje, polaczWpisy, listaUczniow, frekwencjaUcznia, zakresDat } from "../src/frekwencja.mjs";
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

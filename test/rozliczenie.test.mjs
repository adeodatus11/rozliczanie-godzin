// Analiza dnia, decyzje, plik stanu i eksport XLSX na danych zmyślonych
// (repozytorium jest publiczne — żadnych prawdziwych osób ani nieobecności).
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { nowyStan, dodajPlan, dodajTematy, dodajZestawienie, ustawDecyzje, zapiszStan, wczytajStan } from "../src/stan.mjs";
import { analizaDnia, rozliczWszystkich } from "../src/rozliczenie.mjs";
import { realizacjaDzienna, lekcjeZTematow, znajdzOsobe, kluczOsoby } from "../src/wejscie.mjs";
import { eksportMiesiaca } from "../src/eksport.mjs";
import { readWorkbook } from "../src/xlsx.mjs";

const NAGLOWEK = ["Szkoła", "Okres klasyfikacyjny", "Dziennik", "Grupa", "Pseudonim Ucznia", "Przedmiot", "Nauczyciel", "Nauczyciel wspomagający", "Temat", "Data realizacji", "Numer pory lekcji", "Zastępstwo"];
const serial = (iso) => String((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5);
const temat = (kto, data, nr, { zast = false, grupa = "cały oddział" } = {}) => ["T5", "Semestr 1", "1A", grupa, "", "Matematyka", `${kto} (XX)`, "", "temat", serial(data), String(nr), zast ? "Tak" : "Nie"];

function stanTestowy() {
  const s = nowyStan();
  s.nauczyciele = { "kowalska anna": { nazwa: "Kowalska Anna", tryb: "tematy", pensum: 18, dniPracy: [1, 2, 3, 4, 5], maks: 6 } };
  // plan: pn–pt po 5 lekcji (1–5) = 25 godzin, przydział 18 + 6 (limit) — jedna godzina ponad przydział z planu nie ma znaczenia
  dodajPlan(s, { "kowalska anna": { 1: [1, 2, 3, 4, 5], 2: [1, 2, 3, 4, 5], 3: [1, 2, 3, 4, 5], 4: [1, 2, 3, 4, 5], 5: [1, 2, 3, 4, 5] } }, "2026-09-07", "test");
  const wiersze = [NAGLOWEK];
  for (const data of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]) for (const nr of [1, 2, 3, 4, 5]) wiersze.push(temat("Kowalska Anna", data, nr));
  wiersze.push(temat("Kowalska Anna", "2026-09-08", 6, { zast: true })); // zastępstwo po lekcjach
  wiersze.push(temat("Kowalska Anna", "2026-09-09", 7, { grupa: "Indywidualne (IND)" }));
  wiersze.push(temat("Kowalska Anna", "2026-09-11", 1)); // piątek: tylko 1 z 5 lekcji
  dodajTematy(s, realizacjaDzienna(lekcjeZTematow(wiersze)), "tematy");
  return s;
}

test("dopasowanie osób: inne zapisy tego samego nazwiska", () => {
  const klucze = ["lis-kowalczyk maria", "zając jan", "wróbel ewa"];
  assert.equal(znajdzOsobe(kluczOsoby("Lis Maria"), klucze), "lis-kowalczyk maria");
  assert.equal(znajdzOsobe(kluczOsoby("Zając ks. Jan [ZJ]"), klucze), "zając jan");
  assert.equal(znajdzOsobe(kluczOsoby("Wróbel Adam"), klucze), null);
});

test("dzień z brakującymi lekcjami jest do wyjaśnienia, IND i zastępstwo poza sumą", () => {
  const s = stanTestowy();
  const pt = analizaDnia(s, "kowalska anna", "2026-09-11");
  assert.equal(pt.godziny, 1);
  assert.ok(pt.doWyjasnienia);
  assert.match(pt.uwagi.join(), /bez tematu lekcje z planu: 2,3,4,5/);
  const sr = analizaDnia(s, "kowalska anna", "2026-09-09");
  assert.equal(sr.godziny, 5);
  assert.equal(sr.ind, 1);
  const wt = analizaDnia(s, "kowalska anna", "2026-09-08");
  assert.equal(wt.godziny, 5, "zastępstwo bez formy płatności nie wchodzi do sumy");
  assert.equal(wt.bezFormy, 1);
});

test("forma płatności z zestawienia zmian: dodatkowo płatne = doraźne, do zliczenia = do sumy", () => {
  const s = stanTestowy();
  dodajZestawienie(s, { okres: { od: "2026-09-07", do: "2026-09-11" }, nieobecnosci: {}, zastepstwa: { "kowalska anna": { "2026-09-08": [{ lekcja: 6, forma: "Dodatkowo płatne" }] } } }, "zestawienie");
  assert.equal(analizaDnia(s, "kowalska anna", "2026-09-08").dorazne, 1);
  s.zestawienie.zastepstwa["kowalska anna"]["2026-09-08"][0].forma = "Godzina do zliczenia";
  assert.equal(analizaDnia(s, "kowalska anna", "2026-09-08").godziny, 6);
});

test("podpowiedź przy L4 i decyzja „z planu” przy wycieczce", () => {
  const s = stanTestowy();
  dodajZestawienie(s, { okres: { od: "2026-09-07", do: "2026-09-11" }, nieobecnosci: { "kowalska anna": { "2026-09-11": { powody: ["Wycieczka"], lekcje: [2, 3, 4, 5] } } }, zastepstwa: {} }, "zestawienie");
  const pt = analizaDnia(s, "kowalska anna", "2026-09-11");
  assert.deepEqual(pt.podpowiedz.zPlanu, true);
  ustawDecyzje(s, "kowalska anna", "2026-09-11", pt.podpowiedz);
  assert.equal(analizaDnia(s, "kowalska anna", "2026-09-11").godziny, 5);
  const [w] = rozliczWszystkich(s, "2026-09");
  const tydzien = w.tygodnie.find((t) => t.poniedzialek === "2026-09-07");
  assert.equal(tydzien.suma, 25);
  assert.equal(tydzien.doRozliczenia, 6, "limit przydzielonych godzin");

  s.zestawienie.nieobecnosci["kowalska anna"]["2026-09-11"].powody = ["Zwolnienie lekarskie"];
  ustawDecyzje(s, "kowalska anna", "2026-09-11", null);
  s.realizacja["kowalska anna"]["2026-09-11"] = { godziny: 0, lekcje: [], ind: 0, zastepstwa: [], szkoly: {} };
  assert.equal(analizaDnia(s, "kowalska anna", "2026-09-11").podpowiedz.odliczenie, "nieobecnosc");
});

test("dni bez eksportu tematów to „brak danych”, nie braki do wyjaśnienia", () => {
  const s = stanTestowy();
  const a = analizaDnia(s, "kowalska anna", "2026-09-14");
  assert.ok(a.brakDanych);
  assert.ok(!a.doWyjasnienia);
});

test("plik stanu i eksport XLSX", async () => {
  const s = stanTestowy();
  ustawDecyzje(s, "kowalska anna", "2026-09-11", { godziny: 5, uwaga: "zmiana w planie" });
  const s2 = wczytajStan(zapiszStan(s));
  assert.deepEqual(rozliczWszystkich(s2, "2026-09").map((w) => w.doWyplaty), rozliczWszystkich(s, "2026-09").map((w) => w.doWyplaty));
  assert.throws(() => wczytajStan('{"x":1}'));
  const bajty = await eksportMiesiaca(s, "2026-09", rozliczWszystkich(s, "2026-09"));
  const { sheets } = await readWorkbook(bajty, DOMParser);
  assert.deepEqual(Object.keys(sheets), ["Zestawienie 2026-09", "Tygodnie", "Dni", "Decyzje"]);
  assert.equal(sheets["Zestawienie 2026-09"][1][0], "Kowalska Anna");
  assert.match(sheets.Decyzje[1].join("|"), /zmiana w planie/);
});

test("koniec zatrudnienia („do”) odlicza pensum i nie zostawia dni do wyjaśnienia", () => {
  const s = stanTestowy();
  s.nauczyciele["kowalska anna"].do = "2026-09-10";
  const [w] = rozliczWszystkich(s, "2026-09");
  const tydzien = w.tygodnie.find((t) => t.poniedzialek === "2026-09-07");
  assert.equal(tydzien.pensum, 14.4, "piątek 11.09 po ustaniu zatrudnienia");
  assert.equal(w.tygodnie.find((t) => t.poniedzialek === "2026-09-14").pensum, 0);
  assert.ok(!analizaDnia(s, "kowalska anna", "2026-09-11").doWyjasnienia);
});

test("zastępstwo z formą płatności spoza listy jest do wyjaśnienia", () => {
  const s = stanTestowy();
  dodajZestawienie(s, { okres: { od: "2026-09-07", do: "2026-09-11" }, nieobecnosci: {}, zastepstwa: { "kowalska anna": { "2026-09-08": [{ lekcja: 6, forma: "Inna forma" }] } } }, "zestawienie");
  const wt = analizaDnia(s, "kowalska anna", "2026-09-08");
  assert.equal(wt.godziny, 5);
  assert.ok(wt.doWyjasnienia);
  assert.match(wt.uwagi.join(), /nieznaną formą płatności: lekcja 6 „Inna forma”/);
});

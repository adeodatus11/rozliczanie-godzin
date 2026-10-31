// Analiza dnia, decyzje, plik stanu i eksport XLSX na danych zmyślonych
// (repozytorium jest publiczne — żadnych prawdziwych osób ani nieobecności).
import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { nowyStan, dodajPlan, dodajTematy, dodajZestawienie, dodajInformacje, ustawDecyzje, zapiszStan, wczytajStan } from "../src/stan.mjs";
import { czytajPrzeniesienia, czytajInformacjeOZastepstwach, rodzajSkoroszytu } from "../src/zmiany.mjs";
import { analizaDnia, rozliczWszystkich } from "../src/rozliczenie.mjs";
import { realizacjaDzienna, lekcjeZTematow, znajdzOsobe, kluczOsoby, planZXml, planOdZXml } from "../src/wejscie.mjs";
import { eksportMiesiaca } from "../src/eksport.mjs";
import { raportNauczyciela } from "../src/raport.mjs";
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

test("plan XML w formacie planNauczycieli: dni i pory, data obowiązywania", () => {
  const xml = `<?xml version='1.0' encoding='utf-8'?>
<planNauczycieli typ="wzorcowy" obowiazujeOd="2026-09-07">
  <godziny><godzina nr="1" od="8:00" do="8:45" /></godziny>
  <nauczyciel skrot="AK" imie="Anna" nazwisko="Kowalska">
    <podsumowanie lekcjiTygodniowo="4" />
    <lekcja dzien="Wtorek" godzina="2" przedmiot="Matematyka" oddzial="1A" grupa="gr1" />
    <lekcja dzien="Wtorek" godzina="2" przedmiot="Matematyka" oddzial="1A" grupa="gr2" />
    <lekcja dzien="Wtorek" godzina="1" przedmiot="Matematyka" oddzial="2B" />
    <lekcja dzien="Środa" godzina="7" przedmiot="Fizyka" oddzial="3C" />
    <dyzur dzien="Wtorek" przerwaPoLekcji="5" miejsce="parter" />
  </nauczyciel>
  <nauczyciel skrot="v1" imie="matematyka" nazwisko="vacat1"><podsumowanie lekcjiTygodniowo="0" /></nauczyciel>
</planNauczycieli>`;
  assert.deepEqual(planZXml(xml, DOMParser), { "kowalska anna": { 2: [1, 2], 3: [7] } });
  assert.equal(planOdZXml(xml), "2026-09-07");
  assert.equal(planOdZXml(`<timetable><teachers/></timetable>`), null);
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
  assert.deepEqual(Object.keys(sheets), ["Zestawienie 2026-09", "Tygodnie", "Dni", "Decyzje", "Uwagi"]);
  assert.deepEqual(sheets.Uwagi[0], ["Data", "Nauczyciel", "Godziny", "Status", "Uwagi automatyczne"]);
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

const OPIS = [["Rok szkolny: 2026/2027"], ["Okres: 07.09.2026 (pon.) - 11.09.2026 (pt.)"]];

test("przeniesione lekcje zmieniają plan dnia (InformacjeOPrzeniesieniach)", () => {
  const arkusze = {
    "Opis parametrów": OPIS,
    Oddziały: [
      ["Przeniesiono z", "Przeniesiono na", "Nauczyciel/wakat", "Nauczyciel/wakat wspomagający", "Oddział", "Przedmiot", "Uwagi"],
      ["11.09.2026, 2, 08:50-09:35, sala: 4", "10.09.2026, 6, 12:25-13:10, sala: 4", "Kowalska Anna", "-", "1A", "Matematyka", ""],
      ["11.09.2026, 3, 09:40-10:25, sala: 4", "11.09.2026, 1, 08:00-08:45, sala: 4", "Kowalska Anna", "-", "1A", "Matematyka", ""],
      ["11.09.2026, 4, 10:35-11:20, sala: 4", "11.09.2026, 4, 10:35-11:20, sala: 9", "Kowalska Anna", "-", "1A", "Matematyka", ""], // tylko sala
    ],
  };
  assert.equal(rodzajSkoroszytu(arkusze), "przeniesienia");
  const p = czytajPrzeniesienia(arkusze);
  assert.deepEqual(p.okres, { od: "2026-09-07", do: "2026-09-11" });
  assert.deepEqual(p.przeniesienia, { "kowalska anna": { "2026-09-11": { z: [2, 3], na: [1] }, "2026-09-10": { z: [], na: [6] } } });

  const s = stanTestowy();
  dodajInformacje(s, "przeniesienia", p.okres, p.przeniesienia, "przeniesienia");
  const pt = analizaDnia(s, "kowalska anna", "2026-09-11");
  assert.deepEqual(pt.plan, [1, 4, 5], "lekcje 2 i 3 przeniesione z piątku");
  assert.match(pt.uwagi.join(" "), /bez tematu lekcje z planu: 4,5/);
  const czw = analizaDnia(s, "kowalska anna", "2026-09-10");
  assert.deepEqual(czw.plan, [1, 2, 3, 4, 5, 6]);
  assert.match(czw.uwagi.join(" "), /przeniesienia: na lekcje 6/);
  assert.match(czw.uwagi.join(" "), /bez tematu lekcje przeniesione na ten dzień: 6/);
  assert.ok(!/bez tematu lekcje z planu/.test(czw.uwagi.join(" ")));
  assert.ok(czw.doWyjasnienia);
});

test("informacje o zastępstwach: kontrola form płatności i zastępstwo za brak zestawienia", () => {
  const arkusze = {
    "Opis parametrów": OPIS,
    Oddziały: [
      ["Dzień", "Lekcja", "Nauczyciel/wakat", "Oddział", "Przedmiot", "Sala", "Zastępca", "Uwagi", "Forma płatności"],
      ["08.09.2026", "6, 12:25-13:10", "Nowak Jan", "2B", "Fizyka", "5", "Kowalska Anna", "", "Godzina do zliczenia"],
      ["08.09.2026", "7, 13:15-14:00", "Nowak Jan", "2B", "Fizyka", "5", "Uczniowie zwolnieni do domu", "", "-"],
    ],
    "Dzienniki zajeć innych": [["Dzień", "Godzina", "Nauczyciel", "Dziennik zajęć innych"], ["08.09.2026", "08:00-08:45", "Nowak Jan", "IN - Uczeń Zmyślony"]],
  };
  assert.equal(rodzajSkoroszytu(arkusze), "zastepstwa");
  const z = czytajInformacjeOZastepstwach(arkusze);
  assert.deepEqual(z.zastepstwa, { "kowalska anna": { "2026-09-08": [{ lekcja: 6, forma: "Godzina do zliczenia", skutek: null, zaKogo: "Nowak Jan", oddzial: "2B" }] } });
  assert.ok(!JSON.stringify(z).includes("Uczeń"), "bez dzienników zajęć innych");

  // bez zbiorczego zestawienia forma płatności pochodzi z informacji; własna lekcja 2 odwołana
  const s = stanTestowy();
  s.realizacja["kowalska anna"]["2026-09-08"].lekcje = [1, 3, 4, 5];
  dodajInformacje(s, "zastepstwa", z.okres, z.zastepstwa, "informacje");
  const wt = analizaDnia(s, "kowalska anna", "2026-09-08");
  assert.equal(wt.godziny, 5);
  assert.ok(!wt.doWyjasnienia, wt.uwagi.join("; "));

  // zestawienie ma pierwszeństwo, a różna forma w obu raportach jest do wyjaśnienia
  dodajZestawienie(s, { okres: { od: "2026-09-07", do: "2026-09-11" }, nieobecnosci: {}, zastepstwa: { "kowalska anna": { "2026-09-08": [{ lekcja: 6, forma: "Bezpłatne" }] } } }, "zestawienie");
  const wt2 = analizaDnia(s, "kowalska anna", "2026-09-08");
  assert.equal(wt2.godziny, 4);
  assert.ok(wt2.doWyjasnienia);
  assert.match(wt2.uwagi.join(" "), /lekcja 6 — zestawienie „Bezpłatne”, informacje „Godzina do zliczenia”/);

  // dwie grupy w tej samej godzinie z różnymi formami — zgodne, jeśli oba raporty mają te same formy
  s.zestawienie.zastepstwa["kowalska anna"]["2026-09-08"] = [{ lekcja: 6, forma: "Bezpłatne" }, { lekcja: 6, forma: "Godzina do zliczenia" }];
  s.informacje.zastepstwa["kowalska anna"]["2026-09-08"].push({ lekcja: 6, forma: "Bezpłatne" });
  assert.ok(!/różne formy/.test(analizaDnia(s, "kowalska anna", "2026-09-08").uwagi.join(" ")));
});

test("stary plik rozliczenia bez „informacje” wczytuje się", () => {
  const s = JSON.parse(zapiszStan(stanTestowy()));
  delete s.informacje;
  const w = wczytajStan(JSON.stringify(s));
  assert.deepEqual(w.informacje, { zastepstwa: {}, przeniesienia: {} });
  assert.equal(analizaDnia(w, "kowalska anna", "2026-09-08").godziny, 5);
});

test("zastępstwo ze zmian bez tematu: płatne do wyjaśnienia, bezpłatne tylko w uwagach", () => {
  const s = stanTestowy();
  dodajZestawienie(s, { okres: { od: "2026-09-07", do: "2026-09-11" }, nieobecnosci: {}, zastepstwa: { "kowalska anna": { "2026-09-07": [{ lekcja: 8, forma: "Bezpłatne", zaKogo: "Nowak Jan", oddzial: "2B" }], "2026-09-09": [{ lekcja: 7, forma: "Dodatkowo płatne", zaKogo: "Nowak Jan", oddzial: "2B" }] } } }, "zestawienie");
  const sr = analizaDnia(s, "kowalska anna", "2026-09-09");
  assert.ok(sr.doWyjasnienia);
  assert.match(sr.uwagi.join(" "), /zastępstwo bez tematu w dzienniku: lekcja 7 za Nowak Jan, 2B \(Dodatkowo płatne\)/);
  const pn = analizaDnia(s, "kowalska anna", "2026-09-07");
  assert.ok(!pn.doWyjasnienia);
  assert.match(pn.uwagi.join(" "), /zastępstwo bezpłatne bez tematu w dzienniku \(nie zmienia rozliczenia\): lekcja 8/);
});

test("„godzin do zliczenia” tyle, ile odwołanych lekcji z planu", () => {
  const zast = (lekcje) => ({ okres: { od: "2026-09-07", do: "2026-09-11" }, nieobecnosci: { "kowalska anna": { "2026-09-10": { powody: ["Wycieczka"], lekcje: [5] } } }, zastepstwa: { "kowalska anna": { "2026-09-10": lekcje.map((lekcja) => ({ lekcja, forma: "Godzina do zliczenia" })) } } });
  const s = stanTestowy();
  // czwartek: plan 1–5, tematy tylko 1,2 → odwołane 3,4 (5 — własna nieobecność, nie odwołana)
  s.realizacja["kowalska anna"]["2026-09-10"] = { godziny: 2, lekcje: [1, 2], ind: 0, zastepstwa: [6, 7], szkoly: {} };
  dodajZestawienie(s, zast([6, 7]), "zestawienie");
  let czw = analizaDnia(s, "kowalska anna", "2026-09-10");
  assert.equal(czw.godziny, 4);
  assert.ok(!/bez tematu lekcje z planu|ponad odwołane/.test(czw.uwagi.join(" ")), czw.uwagi.join("; "));

  // trzy „do zliczenia” na dwie odwołane lekcje — nadmiar do wyjaśnienia
  s.realizacja["kowalska anna"]["2026-09-10"].zastepstwa = [6, 7, 8];
  dodajZestawienie(s, zast([6, 7, 8]), "zestawienie");
  czw = analizaDnia(s, "kowalska anna", "2026-09-10");
  assert.ok(czw.doWyjasnienia);
  assert.match(czw.uwagi.join(" "), /„godzin do zliczenia” 3 \(lekcje 6,7,8\), a odwołanych lekcji z planu 2 \(3,4\) — 1 ponad odwołane/);

  // jedna „do zliczenia” na dwie odwołane — brakująca lekcja do wyjaśnienia
  s.realizacja["kowalska anna"]["2026-09-10"].zastepstwa = [6];
  dodajZestawienie(s, zast([6]), "zestawienie");
  czw = analizaDnia(s, "kowalska anna", "2026-09-10");
  assert.match(czw.uwagi.join(" "), /bez tematu lekcje z planu: 3,4 \(odwołanych 2, „godzin do zliczenia” 1 — brakuje 1\)/);
});

test("raport nauczyciela: pozycje do wypłaty, tygodnie i lista doraźnych zastępstw", () => {
  const s = stanTestowy();
  dodajZestawienie(s, { okres: { od: "2026-09-07", do: "2026-09-11" }, nieobecnosci: {}, zastepstwa: { "kowalska anna": { "2026-09-08": [{ lekcja: 6, forma: "Dodatkowo płatne", zaKogo: "Nowak Jan", oddzial: "2B" }] } } }, "zestawienie");
  const [w] = rozliczWszystkich(s, "2026-09");
  const r = raportNauczyciela(s, w, "2026-09");
  assert.equal(r.nazwa, "Kowalska Anna");
  assert.deepEqual(r.pozycje.map((p) => p.co), ["Godziny ponadwymiarowe", "Doraźne zastępstwa", "Nauczanie indywidualne (IND)", "KKZ"]);
  assert.equal(r.pozycje[0].godziny, w.doWyplaty);
  assert.equal(r.pozycje[1].godziny, 1);
  assert.equal(r.pozycje[2].godziny, 1, "IND w środę");
  assert.equal(r.razem, w.razem);
  assert.deepEqual(r.dorazne, [{ data: "2026-09-08", lekcja: 6, zaKogo: "Nowak Jan", oddzial: "2B", opis: null }]);
  const t = r.tygodnie.find((x) => x.od === "2026-09-07");
  assert.equal(t.do, "2026-09-11");
  assert.equal(t.suma, 21);
  // 1–4.09: wtorek 1.09 jest wolny, 2–4.09 to pierwszy tydzień
  assert.ok(r.tygodnie[0].odliczone.some((d) => d.data === "2026-09-01"));
  assert.ok(r.dni.every((d) => d.data.startsWith("2026-09")));
  const pt = r.dni.find((d) => d.data === "2026-09-11");
  assert.ok(pt.doWyjasnienia);
  assert.equal(r.doWyjasnienia, w.doWyjasnienia);
});


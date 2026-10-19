// Przykłady z załączników do prezentacji „Godziny ponadwymiarowe od 1.09.2025”
// (wrzesień 2025: pn 1.09 to dzień bez zajęć, 29–30.09 to pn–wt).
import test from "node:test";
import assert from "node:assert/strict";
import { rozliczMiesiac, godzinyDoWyplaty, rachunekTygodnia } from "../src/silnik.mjs";

const miesiac = "2025-09";
const kalendarz = { "2025-09-01": "wolne" };
/** Tygodnie [pn, wt, śr, czw, pt] od 1.09.2025 → {data: godziny}. */
function dni(tygodnie) {
  const out = {};
  tygodnie.forEach((tydz, t) =>
    tydz.forEach((g, i) => {
      const d = new Date(Date.UTC(2025, 8, 1 + 7 * t + i));
      if (d.getUTCMonth() === 8 && g != null) out[d.toISOString().slice(0, 10)] = g;
    }),
  );
  return out;
}
const nieobecnosc = (...daty) => Object.fromEntries(daty.map((d) => [d, { odliczenie: "nieobecnosc" }]));

test("zaokrąglenie do wypłaty: do 0,5 w dół, powyżej w górę (art. 35 ust. 3h)", () => {
  assert.equal(godzinyDoWyplaty(20.6), 21);
  assert.equal(godzinyDoWyplaty(17.5), 17);
  assert.equal(godzinyDoWyplaty(23.4), 23);
  assert.equal(godzinyDoWyplaty(33.6), 34);
  assert.equal(godzinyDoWyplaty(0.34), 0);
  assert.equal(godzinyDoWyplaty(27.99), 28);
});

test("slajd 52: 18 godzin, 2 dni z 5 → pensum 7,2", () => {
  assert.deepEqual(rachunekTygodnia({ suma: 10, pensum: 7.2, maks: 6 }), { nadPensum: 2.8, doRozliczenia: 2.8 });
});

test("Zał. 4: 5 dni pracy, nieobecność 11–12.09", () => {
  const n = { tryb: "tematy", pensum: 18, dniPracy: [1, 2, 3, 4, 5], maks: 6 };
  const m = rozliczMiesiac(n, {
    miesiac,
    kalendarz,
    realizacja: dni([[0, 4, 3, 5, 5], [7, 4, 3, 0, 0], [7, 4, 3, 5, 5], [7, 4, 3, 5, 5], [7, 4]]),
    decyzje: nieobecnosc("2025-09-11", "2025-09-12"),
  });
  assert.deepEqual(m.tygodnie.map((t) => t.pensum), [14.4, 10.8, 18, 18, 7.2]);
  assert.deepEqual(m.tygodnie.map((t) => t.doRozliczenia), [2.6, 3.2, 6, 6, 3.8]);
  assert.equal(m.suma, 21.6);
  assert.equal(m.doWyplaty, 22);
});

test("Zał. 4a: wypracowane ponad plan obcina się do przydziału (20,6 → 21)", () => {
  const n = { tryb: "tematy", pensum: 18, dniPracy: [1, 2, 3, 4, 5], maks: 6 };
  const m = rozliczMiesiac(n, {
    miesiac,
    kalendarz,
    realizacja: dni([[0, 7, 6, 2, 2], [7, 7, 6, 0, 0], [null], [7, 7, 6, 2, 2], [7, 7]]),
    // Załącznik pomija tydzień 15–19.09; tu jest pełną nieobecnością.
    decyzje: nieobecnosc("2025-09-11", "2025-09-12", "2025-09-15", "2025-09-16", "2025-09-17", "2025-09-18", "2025-09-19"),
  });
  const bezPominietego = m.tygodnie.filter((t) => t.poniedzialek !== "2025-09-15");
  assert.deepEqual(bezPominietego.map((t) => t.nadPensum), [2.6, 9.2, 6, 6.8]);
  assert.deepEqual(bezPominietego.map((t) => t.doRozliczenia), [2.6, 6, 6, 6]);
  assert.equal(m.doWyplaty, 21);
});

test("Zał. 8: czterodniowy tydzień (pn wolny), pensum 18/4", () => {
  const n = { tryb: "tematy", pensum: 18, dniPracy: [2, 3, 4, 5], maks: 4 };
  const m = rozliczMiesiac(n, {
    miesiac,
    kalendarz,
    realizacja: dni([[0, 7, 6, 6, 3], [0, 7, 6, 0, 0], [0, 7, 6, 6, 3], [0, 7, 6, 4, 4], [0, 7]]),
    decyzje: nieobecnosc("2025-09-11", "2025-09-12"),
  });
  assert.deepEqual(m.tygodnie.map((t) => t.pensum), [18, 9, 18, 18, 4.5]);
  assert.deepEqual(m.tygodnie.map((t) => t.doRozliczenia), [4, 4, 4, 3, 2.5]);
  assert.equal(m.doWyplaty, 17);
});

test("Zał. 9: pensum uśrednione 23,63 (dziennie 4,726)", () => {
  const sr = 23.63 / 5;
  const n = { tryb: "srednia", pensum: 18, dniPracy: [1, 2, 3, 4, 5], maks: 5.63, dzienne: { 1: sr, 2: sr, 3: sr, 4: sr, 5: sr } };
  const m = rozliczMiesiac(n, { miesiac, kalendarz, decyzje: nieobecnosc("2025-09-25", "2025-09-26") });
  assert.deepEqual(m.tygodnie.map((t) => t.doRozliczenia), [4.5, 5.63, 5.63, 3.38, 2.25]);
  assert.equal(m.doWyplaty, 21);
});

test("Zał. 6: dyrektor, pensum po zniżce 5 na dni z lekcjami (wt, śr)", () => {
  const n = { tryb: "tematy", pensum: 5, dniPracy: [2, 3], maks: 2 };
  const m = rozliczMiesiac(n, {
    miesiac,
    kalendarz,
    realizacja: dni([[0, 4, 3, 0, 0], [0, 4, 3, 0, 0], [0, 4, 3, 0, 0], [0, 4, 3, 0, 0], [0, 4]]),
    decyzje: nieobecnosc("2025-09-11", "2025-09-12"),
  });
  assert.deepEqual(m.tygodnie.map((t) => t.doRozliczenia), [2, 2, 2, 2, 1.5]);
  assert.equal(m.doWyplaty, 9);
});

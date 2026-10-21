// Reguły rozliczania godzin ponadwymiarowych (Karta Nauczyciela, art. 35
// ust. 3f i 3h w brzmieniu ustawy z 21.11.2025, Dz.U. 2025 poz. 1849).
// Moduł nie czyta plików i nie zna VULCAN-a: dostaje dni, konfigurację
// nauczyciela i decyzje, zwraca tygodnie i miesiąc. Działa tak samo
// w przeglądarce i w Node.

/** Usuwa szum zmiennoprzecinkowy (7.199999… → 7.2). */
export const r2 = (x) => Math.round(x * 100) / 100;

/** Godziny do wypłaty (art. 35 ust. 3h): do 0,5 w dół, powyżej 0,5 w górę. */
export function godzinyDoWyplaty(x) {
  const v = r2(x);
  const całe = Math.floor(v);
  return r2(v - całe) > 0.5 ? całe + 1 : całe;
}

/**
 * Konfiguracja nauczyciela:
 *  pensum      — tygodniowy obowiązkowy wymiar (u kadry kierowniczej po zniżce),
 *  dniPracy    — dni tygodnia (1 = pn … 5 = pt), na które rozkłada się pensum:
 *                5 dni, 4 dni przy czterodniowym tygodniu, a u dyrekcji dni z lekcjami,
 *  maks        — przydzielone godziny ponadwymiarowe w tygodniu (górny limit),
 *  tryb        — "tematy" (realizacja z dziennika), "srednia" (pensum uśrednione)
 *                albo "staly" (stały tygodniowy plan, np. specjaliści),
 *  dzienne     — przy trybie "srednia" i "staly": godziny w danym dniu tygodnia.
 */
export const pensumNaDzien = (n) => n.pensum / n.dniPracy.length;

const dzienTygodnia = (iso) => ((new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;

/** Poniedziałek tygodnia, do którego należy data. */
export function poniedzialek(iso) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - dzienTygodnia(iso) + 1);
  return d.toISOString().slice(0, 10);
}

function dodajDni(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Powody, dla których dzień pomniejsza pensum o 1/5 (1/4) — art. 35 ust. 3f.
 * Prywatnego dnia wolnego tu nie ma: taki dzień się odpracowuje albo jest
 * urlopem bezpłatnym (decyzja dyrektora), pensum się nie zmienia.
 */
export const POWODY_ODLICZENIA = {
  nieobecnosc: "usprawiedliwiona nieobecność (L4, urlop, opieka nad dzieckiem…)",
  innyMiesiac: "dzień w tygodniu przypadający w innym miesiącu",
  wolne: "dzień ustawowo wolny albo wolny od zajęć dydaktycznych",
  bezZajec: "dzień, w którym nie zaplanowano zajęć z art. 42 ust. 2 pkt 1",
  przedZatrudnieniem: "przed zatrudnieniem albo po jego ustaniu",
};

/**
 * Rozlicza jeden tydzień nauczyciela w obrębie miesiąca.
 *  poniedzialekIso — początek tygodnia,
 *  miesiac         — "RRRR-MM", miesiąc rozliczenia,
 *  realizacja      — {data: godziny} zrealizowane i zaliczone (tryb "tematy"),
 *  kalendarz       — {data: "wolne"} dni wolne od zajęć w szkole,
 *  decyzje         — {data: {odliczenie?: klucz POWODY_ODLICZENIA, godziny?: liczba, uwaga?}}
 *                    — decyzja dyrektora nadpisuje wszystko inne.
 */
export function rozliczTydzien(n, { poniedzialekIso, miesiac, realizacja = {}, kalendarz = {}, decyzje = {} }) {
  const naDzien = pensumNaDzien(n);
  const dni = [];
  let suma = 0;
  let pensum = 0;
  for (let i = 0; i < 5; i++) {
    const data = dodajDni(poniedzialekIso, i);
    const dt = i + 1;
    const decyzja = decyzje[data] ?? {};
    let odliczenie = decyzja.odliczenie ?? null;
    if (!odliczenie && !data.startsWith(miesiac)) odliczenie = "innyMiesiac";
    if (!odliczenie && kalendarz[data]) odliczenie = "wolne";
    if (!odliczenie && ((n.od && data < n.od) || (n.do && data > n.do))) odliczenie = "przedZatrudnieniem";
    const dzienPracy = n.dniPracy.includes(dt);
    let godziny = 0;
    if (!odliczenie) {
      if (decyzja.godziny != null) godziny = decyzja.godziny;
      else if (n.tryb === "tematy") godziny = realizacja[data] ?? 0;
      else godziny = n.dzienne?.[dt] ?? 0;
      if (dzienPracy) pensum += naDzien;
    }
    suma += godziny;
    dni.push({ data, godziny, odliczenie, dzienPracy, uwaga: decyzja.uwaga ?? null });
  }
  suma = r2(suma);
  pensum = r2(pensum);
  const nadPensum = r2(suma - pensum);
  const doRozliczenia = r2(Math.min(Math.max(0, nadPensum), n.maks));
  return { poniedzialek: poniedzialekIso, dni, suma, pensum, maks: n.maks, nadPensum, doRozliczenia };
}

/** Wszystkie tygodnie, które mają choć jeden dzień roboczy w miesiącu "RRRR-MM". */
export function tygodnieMiesiaca(miesiac) {
  const [r, m] = miesiac.split("-").map(Number);
  const ostatni = new Date(Date.UTC(r, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= ostatni; d++) {
    const iso = `${miesiac}-${String(d).padStart(2, "0")}`;
    if (dzienTygodnia(iso) > 5) continue;
    const pn = poniedzialek(iso);
    if (!out.includes(pn)) out.push(pn);
  }
  return out;
}

/** Rozliczenie miesiąca: tygodnie, suma i godziny do wypłaty. */
export function rozliczMiesiac(n, { miesiac, ...dane }) {
  const tygodnie = tygodnieMiesiaca(miesiac).map((pn) =>
    rozliczTydzien(n, { poniedzialekIso: pn, miesiac, ...dane }),
  );
  const suma = r2(tygodnie.reduce((s, t) => s + t.doRozliczenia, 0));
  return { tygodnie, suma, doWyplaty: godzinyDoWyplaty(suma) };
}

/** Sam rachunek tygodnia z gotowych liczb (do porównań z arkuszem). */
export function rachunekTygodnia({ suma, pensum, maks }) {
  const nadPensum = r2(suma - pensum);
  return { nadPensum, doRozliczenia: r2(Math.min(Math.max(0, nadPensum), maks)) };
}

export { dzienTygodnia, dodajDni };

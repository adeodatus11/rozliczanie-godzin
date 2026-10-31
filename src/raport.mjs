// Raport indywidualny nauczyciela za miesiąc: ile godzin do wypłaty i z jakiej
// podstawy (ponadwymiarowe z tygodni, doraźne zastępstwa, IND, KKZ), z
// rozpisaniem tygodni i dni. Tylko dane — wygląd i druk są w aplikacji.
import { FORMY } from "./rozliczenie.mjs";
import { POWODY_ODLICZENIA, dzienTygodnia } from "./silnik.mjs";

const DNI = ["", "pn", "wt", "śr", "czw", "pt"];

/** w — wynik rozliczNauczyciela za miesiąc. */
export function raportNauczyciela(stan, w, miesiac) {
  const n = stan.nauczyciele[w.osoba];
  const dniTygodni = w.tygodnie.flatMap((t) => t.dni).filter((d) => d.data.startsWith(miesiac));
  const odliczenie = Object.fromEntries(dniTygodni.map((d) => [d.data, d.odliczenie]));

  const dni = dniTygodni.map((d) => {
    const a = w.dni[d.data];
    const zast = (rodzaj) => a.zastepstwa.filter((z) => FORMY[z.forma] === rodzaj);
    return {
      data: d.data,
      dzien: DNI[dzienTygodnia(d.data)],
      odliczenie: d.odliczenie ? (POWODY_ODLICZENIA[d.odliczenie] ?? d.odliczenie) : null,
      godziny: d.odliczenie ? 0 : d.godziny,
      lekcje: a.tematy.length,
      doZliczenia: zast("doSumy").map((z) => z.lekcja),
      dorazne: d.odliczenie ? 0 : a.dorazne,
      ind: d.odliczenie ? 0 : a.ind,
      kkz: d.odliczenie ? 0 : a.kkz,
      decyzja: a.decyzja,
      uwagi: a.uwagi,
      doWyjasnienia: a.doWyjasnienia,
    };
  });

  // Doraźne zastępstwa rozpisane na lekcje (z raportów zmian); ręcznie wpisana liczba z decyzji ma pierwszeństwo.
  const dorazne = [];
  for (const d of dni) {
    if (!d.dorazne || odliczenie[d.data]) continue;
    const lista = w.dni[d.data].zastepstwa.filter((z) => FORMY[z.forma] === "dorazne");
    if (d.decyzja?.dorazne != null && d.decyzja.dorazne !== lista.length) dorazne.push({ data: d.data, lekcja: null, zaKogo: null, oddzial: null, rozdzial: null, opis: `decyzja: ${d.decyzja.dorazne} h${d.decyzja.uwaga ? ` — ${d.decyzja.uwaga}` : ""}` });
    else for (const z of lista) dorazne.push({ data: d.data, lekcja: z.lekcja, zaKogo: z.zaKogo, oddzial: z.oddzial, rozdzial: z.rozdzial ?? null, opis: null });
  }

  const tygodnie = w.tygodnie.map((t) => {
    const wMiesiacu = t.dni.filter((d) => d.data.startsWith(miesiac));
    return {
      od: wMiesiacu[0]?.data ?? t.poniedzialek,
      do: wMiesiacu.at(-1)?.data ?? t.poniedzialek,
      suma: t.suma,
      pensum: t.pensum,
      odliczone: wMiesiacu.filter((d) => d.odliczenie).map((d) => ({ data: d.data, powod: POWODY_ODLICZENIA[d.odliczenie] ?? d.odliczenie })),
      nadPensum: t.nadPensum,
      maks: t.maks,
      doRozliczenia: t.doRozliczenia,
    };
  });

  const pozycje = [
    { co: "Godziny ponadwymiarowe", podstawa: `art. 35 ust. 2 KN — suma tygodni ${w.suma} h (nadwyżka nad pensum, najwyżej ${n.maks} h w tygodniu), zaokrąglona wg art. 35 ust. 3h`, godziny: w.doWyplaty },
    { co: "Doraźne zastępstwa", podstawa: "zastępstwa „Dodatkowo płatne” w zestawieniu zmian VULCAN", godziny: w.dorazne },
    { co: "Nauczanie indywidualne (IND)", podstawa: "lekcje IND z eksportu tematów, poza pensum", godziny: w.ind },
    { co: "KKZ", podstawa: "godziny KKZ wpisane w decyzjach dnia, poza pensum", godziny: w.kkz },
  ];

  return {
    nazwa: n.nazwa,
    miesiac,
    tryb: n.tryb,
    pensum: n.pensum,
    maks: n.maks,
    dniPracy: n.dniPracy,
    pozycje,
    razem: w.razem,
    rozdzialy: w.rozdzialy,
    tygodnie,
    dorazne,
    dni,
    doWyjasnienia: w.doWyjasnienia,
  };
}

// Frekwencja ucznia z eksportu dziennika: rozpoznanie tabeli, rodzaje wpisów
// i rachunek za wybrany okres. Moduł nie czyta plików i nie zna przeglądarki —
// dostaje wiersze arkusza (tablice tekstów), zwraca liczby.
import { dataIso } from "./wejscie.mjs";

/** Jak wpis liczy się do frekwencji. Podstawa = obecności + nieobecności (bez „nie liczyć”). */
export const RODZAJE = {
  obecny: "obecność",
  usprawiedliwiona: "nieobecność usprawiedliwiona",
  nieusprawiedliwiona: "nieobecność nieusprawiedliwiona",
  pomin: "nie liczyć",
};

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl");

/**
 * Domyślny rodzaj wpisu po jego nazwie albo symbolu (VULCAN: „Obecność”, „Nieobecność
 * usprawiedliwiona”, „Spóźnienie”, „Zwolnienie”, „Nieobecność z przyczyn szkolnych”, „nb”, „u”…).
 * Spóźnienie i nieobecność z przyczyn szkolnych liczą się jak obecność. null = nie wiadomo.
 */
export function rodzajWpisu(etykieta) {
  const t = norm(etykieta);
  if (!t) return null;
  if (/nieusprawiedliw|^(nb|n|-|–|—)$/.test(t)) return "nieusprawiedliwiona";
  if (/przyczyn szkolnych|^ns$/.test(t)) return "obecny";
  if (/spóźn|^(s|sp|su|ss)$/.test(t)) return "obecny";
  if (/zwolnion\S* obecn|^zo$/.test(t)) return "obecny";
  if (/zwolni|^(z|zw)$/.test(t)) return "usprawiedliwiona";
  if (/usprawiedliw|^(u|nu)$/.test(t)) return "usprawiedliwiona";
  if (/^nieobecn/.test(t)) return "nieusprawiedliwiona";
  if (/obecn|^(ob|o|\+|•|●|·|\.)$/.test(t)) return "obecny";
  return null;
}

/** Role kolumn i nagłówki, po których są rozpoznawane. */
export const ROLE = {
  uczen: { nazwa: "Uczeń (nazwisko i imię)", wzor: /^uczeń$|^uczen$|nazwisko i imi|imi[eę] i nazwisko|^dane ucznia/ },
  nazwisko: { nazwa: "Nazwisko", wzor: /^nazwisko( ucznia)?$/ },
  imie: { nazwa: "Imię", wzor: /^imi[eę]( ucznia)?$|^imiona$|^pierwsze imi/ },
  oddzial: { nazwa: "Oddział / klasa", wzor: /^(oddział|oddzial|klasa|dziennik)/ },
  data: { nazwa: "Data", wzor: /^data(?! urodzenia)/ },
  przedmiot: { nazwa: "Przedmiot", wzor: /^przedmiot|^zajęcia|^zajecia/ },
  lekcja: { nazwa: "Nr lekcji", wzor: /nr lekcji|numer lekcji|numer pory|pora lekcji|^lekcja$|^godzina lekcyjna/ },
  wpis: { nazwa: "Wpis frekwencji", wzor: /kategori|frekwencj|wpis|symbol|^obecno(ść|sc)$|^(rodzaj|typ) (obecności|nieobecności|frekwencji|wpisu)/ },
};

// Kolumny, które nie są ani rolą, ani sumą: porządkowe, procenty, dane wrażliwe.
const POMIJANE = /%|procent|pseudonim|pesel/;
const NIE_SUMA = /^lp\.?$|^nr|numer/;

function rozpoznajNaglowek(naglowek) {
  const kolumny = {};
  naglowek.forEach((h, i) => {
    const t = norm(h);
    if (!t || POMIJANE.test(t)) return;
    for (const [rola, { wzor }] of Object.entries(ROLE)) if (kolumny[rola] == null && wzor.test(t)) {
      kolumny[rola] = i;
      break;
    }
  });
  return kolumny;
}

/**
 * Szuka wiersza nagłówka (eksporty mają nad tabelą tytuł i parametry) i układu tabeli:
 *  „wpisy” — wiersz = jedna lekcja ucznia (uczeń, data, wpis),
 *  „sumy”  — wiersz = uczeń (albo uczeń i przedmiot) z liczbami w kolumnach rodzajów.
 * Zwraca {wiersz, uklad, kolumny: {rola: indeks}, sumy: [indeksy]} albo null.
 */
export function rozpoznajTabele(wiersze) {
  let najlepszy = null;
  for (let r = 0; r < Math.min(wiersze.length, 40); r++) {
    const kolumny = rozpoznajNaglowek(wiersze[r] ?? []);
    if (kolumny.uczen == null && (kolumny.nazwisko == null || kolumny.imie == null)) continue;
    const uklad = ukladTabeli(wiersze, r, kolumny);
    if (!uklad) continue;
    const ocena = Object.keys(kolumny).length + (uklad.uklad === "wpisy" ? 1 : 0);
    if (!najlepszy || ocena > najlepszy.ocena) najlepszy = { ocena, wiersz: r, ...uklad };
  }
  if (!najlepszy) return null;
  const { ocena, ...wynik } = najlepszy;
  return wynik;
}

/** Układ tabeli przy znanym nagłówku; przy ręcznym wyborze kolumn też tędy. */
export function ukladTabeli(wiersze, wiersz, kolumny) {
  if (kolumny.wpis != null) return { uklad: "wpisy", kolumny, sumy: [] };
  const zajete = new Set(Object.values(kolumny));
  const dane = wiersze.slice(wiersz + 1, wiersz + 200).filter((w) => w?.some((v) => String(v).trim()));
  const sumy = (wiersze[wiersz] ?? [])
    .map((h, i) => [norm(h), i])
    .filter(([h, i]) => h && !zajete.has(i) && !NIE_SUMA.test(h) && !POMIJANE.test(h))
    .filter(([, i]) => dane.length && dane.filter((w) => /^\d+([.,]\d+)?$/.test(String(w[i] ?? "").trim()) || String(w[i] ?? "").trim() === "").length === dane.length)
    .map(([, i]) => i);
  return sumy.length ? { uklad: "sumy", kolumny, sumy } : null;
}

const tekst = (w, i) => (i == null ? "" : String(w[i] ?? "").replace(/\s+/g, " ").trim());

/**
 * Wiersze danych → wpisy [{uczen, oddzial, data, przedmiot, lekcja, etykieta, n}].
 * W układzie „sumy” jeden wiersz daje wpis na każdą niezerową kolumnę (etykieta = nagłówek).
 */
export function czytajWpisy(wiersze, { wiersz, uklad, kolumny, sumy }) {
  const naglowek = wiersze[wiersz] ?? [];
  const out = [];
  for (const w of wiersze.slice(wiersz + 1)) {
    if (!w) continue;
    const uczen = kolumny.uczen != null ? tekst(w, kolumny.uczen) : [tekst(w, kolumny.nazwisko), tekst(w, kolumny.imie)].filter(Boolean).join(" ");
    if (!uczen || /^(razem|suma|ogółem|średnia)/i.test(uczen)) continue;
    const wspolne = {
      uczen,
      oddzial: tekst(w, kolumny.oddzial),
      data: kolumny.data != null ? dataIso(tekst(w, kolumny.data)) : null,
      przedmiot: tekst(w, kolumny.przedmiot),
      lekcja: tekst(w, kolumny.lekcja),
    };
    if (uklad === "wpisy") {
      const etykieta = tekst(w, kolumny.wpis);
      if (etykieta) out.push({ ...wspolne, etykieta, n: 1 });
    } else
      for (const i of sumy) {
        const n = Number(tekst(w, i).replace(",", "."));
        if (n > 0) out.push({ ...wspolne, etykieta: tekst(naglowek, i), n });
      }
  }
  return out;
}

/**
 * Domyślne przypisanie etykiet do rodzajów. W układzie „sumy” kolumna ogólna
 * „Nieobecności” obok usprawiedliwionych i nieusprawiedliwionych byłaby liczona
 * podwójnie — dostaje „nie liczyć”.
 */
export function domyslneRodzaje(etykiety, uklad) {
  const out = Object.fromEntries(etykiety.map((e) => [e, rodzajWpisu(e) ?? (uklad === "sumy" ? "pomin" : null)]));
  if (uklad === "sumy" && etykiety.some((e) => /nieusprawiedliw/i.test(e)) && etykiety.some((e) => /(^|\s)usprawiedliw/i.test(e)))
    for (const e of etykiety) if (/^nieobecno\S*$/i.test(e.trim())) out[e] = "pomin";
  return out;
}

/** Łączy wpisy z kilku plików; ta sama lekcja ucznia (data + nr lekcji + przedmiot) liczy się raz — wygrywa późniejszy plik. */
export function polaczWpisy(listy) {
  const klucze = new Map();
  const bezKlucza = [];
  for (const wpisy of listy)
    for (const w of wpisy) {
      if (w.data && w.lekcja) klucze.set([w.uczen, w.oddzial, w.data, w.lekcja, w.przedmiot].join("|"), w);
      else bezKlucza.push(w);
    }
  return [...klucze.values(), ...bezKlucza];
}

export const kluczUcznia = (w) => `${w.uczen}|${w.oddzial}`;

/** Lista uczniów: [{klucz, uczen, oddzial}] w porządku oddział, nazwisko. */
export function listaUczniow(wpisy) {
  const m = new Map();
  for (const w of wpisy) if (!m.has(kluczUcznia(w))) m.set(kluczUcznia(w), { klucz: kluczUcznia(w), uczen: w.uczen, oddzial: w.oddzial });
  return [...m.values()].sort((a, b) => a.oddzial.localeCompare(b.oddzial, "pl", { numeric: true }) || a.uczen.localeCompare(b.uczen, "pl"));
}

/** Zakres dat wpisów (null, gdy plik nie ma dat). */
export function zakresDat(wpisy) {
  const daty = wpisy.map((w) => w.data).filter(Boolean).sort();
  return daty.length ? { od: daty[0], do: daty.at(-1) } : null;
}

const procent = (x, z) => (z ? Math.round((x / z) * 10000) / 100 : null);

function zlicz(wpisy, rodzaje) {
  const s = { obecny: 0, usprawiedliwiona: 0, nieusprawiedliwiona: 0, pomin: 0, nieprzypisane: 0 };
  for (const w of wpisy) s[rodzaje[w.etykieta] ?? "nieprzypisane"] += w.n;
  s.zajecia = s.obecny + s.usprawiedliwiona + s.nieusprawiedliwiona;
  s.frekwencja = procent(s.obecny, s.zajecia);
  s.procentNieusprawiedliwionych = procent(s.nieusprawiedliwiona, s.zajecia);
  s.procentUsprawiedliwionych = procent(s.usprawiedliwiona, s.zajecia);
  return s;
}

/**
 * Frekwencja ucznia ze wszystkich przedmiotów w okresie [od, do] (włącznie).
 *  frekwencja                  — obecności / zajęcia × 100,
 *  procentNieusprawiedliwionych — godziny nieusprawiedliwione / zajęcia × 100.
 * Wpisy bez daty (eksport sum) wchodzą zawsze — wtedy bezDat = true.
 */
export function frekwencjaUcznia(wpisy, klucz, { od, do: doDnia }, rodzaje) {
  const ucznia = wpisy.filter((w) => kluczUcznia(w) === klucz);
  const wOkresie = ucznia.filter((w) => !w.data || ((!od || w.data >= od) && (!doDnia || w.data <= doDnia)));
  const przedmioty = new Map();
  for (const w of wOkresie) (przedmioty.get(w.przedmiot) ?? przedmioty.set(w.przedmiot, []).get(w.przedmiot)).push(w);
  return {
    ...zlicz(wOkresie, rodzaje),
    przedmioty: [...przedmioty]
      .filter(([p]) => p)
      .sort((a, b) => a[0].localeCompare(b[0], "pl"))
      .map(([przedmiot, ws]) => ({ przedmiot, ...zlicz(ws, rodzaje) })),
    dane: zakresDat(wOkresie),
    bezDat: wOkresie.some((w) => !w.data),
    nieprzypisaneEtykiety: [...new Set(wOkresie.filter((w) => !rodzaje[w.etykieta]).map((w) => w.etykieta))],
  };
}

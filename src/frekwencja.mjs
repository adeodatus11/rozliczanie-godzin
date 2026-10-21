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
  if (/nieusprawiedliw|^(nb|n|-|–|—|▬)$/.test(t)) return "nieusprawiedliwiona";
  if (/przyczyn szkolnych|^ns$/.test(t)) return "obecny";
  if (/spóźn|^(s|sp|su|ss)$/.test(t)) return "obecny";
  if (/zwolnion\S* obecn|^zo$/.test(t)) return "obecny";
  if (/zwolni|^(z|zw)$/.test(t)) return "usprawiedliwiona";
  if (/usprawiedliw|^(u|nu|l4)$/.test(t)) return "usprawiedliwiona";
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
 * podwójnie — dostaje „nie liczyć”. Symbole, które zestawienie VULCAN liczy
 * poza podstawą frekwencji (pozaPodstawa), też.
 */
export function domyslneRodzaje(etykiety, uklad, pozaPodstawa = []) {
  const out = Object.fromEntries(etykiety.map((e) => [e, pozaPodstawa.includes(e) ? "pomin" : (rodzajWpisu(e) ?? (uklad === "sumy" ? "pomin" : null))]));
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

/** Zakres danych: daty wpisów i okresy zestawień (null, gdy nie ma ani jednych, ani drugich). */
export function zakresDat(wpisy) {
  const od = wpisy.map((w) => w.data ?? w.okres?.od).filter(Boolean).sort();
  const doDnia = wpisy.map((w) => w.data ?? w.okres?.do).filter(Boolean).sort();
  return od.length ? { od: od[0], do: doDnia.at(-1) } : null;
}

const procent = (x, z) => (z ? Math.round((x / z) * 10000) / 100 : null);
const POLA = ["obecny", "usprawiedliwiona", "nieusprawiedliwiona", "pomin", "nieprzypisane"];

function zlicz(wpisy, rodzaje) {
  const s = Object.fromEntries(POLA.map((k) => [k, 0]));
  for (const w of wpisy) s[rodzaje[w.etykieta] ?? "nieprzypisane"] += w.n;
  return wskazniki(s);
}

function wskazniki(s) {
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
 * Wpisy z datą liczą się, gdy data jest w okresie. Zestawienie VULCAN ma stały
 * okres eksportu: liczy się tylko, gdy cały mieści się w wybranym okresie
 * (inaczej trafia do okresyPoza). Gdy plik ma sumę ucznia („Wszystkie wpisy”),
 * wynik jest z niej, a przedmioty służą do rozbicia.
 */
export function frekwencjaUcznia(wpisy, klucz, { od, do: doDnia }, rodzaje) {
  const wZakresie = (a, b) => (!od || a >= od) && (!doDnia || b <= doDnia);
  const ucznia = wpisy.filter((w) => kluczUcznia(w) === klucz);
  const wOkresie = ucznia.filter((w) => (w.data ? wZakresie(w.data, w.data) : w.okres ? wZakresie(w.okres.od, w.okres.do) : true));
  const okresy = (ws) => [...new Map(ws.filter((w) => !w.data && w.okres).map((w) => [`${w.okres.od}|${w.okres.do}`, w.okres])).values()].sort((a, b) => a.od.localeCompare(b.od));

  const zrodla = new Map();
  for (const w of wOkresie) (zrodla.get(w.zrodlo) ?? zrodla.set(w.zrodlo, []).get(w.zrodlo)).push(w);
  const doSumy = [...zrodla.values()].flatMap((ws) => (ws.some((w) => w.razem) ? ws.filter((w) => w.razem) : ws));
  const wynik = zlicz(doSumy, rodzaje);

  const czesci = new Map();
  for (const w of wOkresie) if (!w.razem && w.przedmiot) (czesci.get(w.przedmiot) ?? czesci.set(w.przedmiot, []).get(w.przedmiot)).push(w);
  const przedmioty = [...czesci].sort((a, b) => a[0].localeCompare(b[0], "pl")).map(([przedmiot, ws]) => ({ przedmiot, ...zlicz(ws, rodzaje) }));
  // Suma ucznia w zestawieniu VULCAN obejmuje też lekcje spoza listy przedmiotów.
  if (przedmioty.length) {
    const reszta = Object.fromEntries(POLA.map((k) => [k, wynik[k] - przedmioty.reduce((s, p) => s + p[k], 0)]));
    if (POLA.some((k) => reszta[k] > 0)) przedmioty.push({ przedmiot: "inne wpisy (poza listą przedmiotów)", ...wskazniki(reszta) });
  }

  const uzyteOkresy = okresy(wOkresie);
  const vulcan = [...new Set(doSumy.filter((w) => w.razem).map((w) => w.procentVulcan))];
  return {
    ...wynik,
    przedmioty,
    dane: zakresDat(wOkresie),
    okresy: uzyteOkresy,
    okresyPoza: okresy(ucznia).filter((o) => !uzyteOkresy.some((u) => u.od === o.od && u.do === o.do)),
    nakladajaSie: nakladajaSie(wOkresie),
    tylkoOkresy: wOkresie.length > 0 && wOkresie.every((w) => !w.data && w.okres),
    bezDat: wOkresie.some((w) => !w.data && !w.okres),
    procentVulcan: zrodla.size === 1 && vulcan.length === 1 ? vulcan[0] : null,
    nieprzypisaneEtykiety: [...new Set(doSumy.filter((w) => !rodzaje[w.etykieta]).map((w) => w.etykieta))],
  };
}

/** Czy zestawienia z różnych plików mają wspólne dni (ten sam okres wgrany dwa razy też). */
function nakladajaSie(wpisy) {
  const pary = [...new Map(wpisy.filter((w) => !w.data && w.okres).map((w) => [`${w.zrodlo}|${w.okres.od}|${w.okres.do}`, w.okres])).values()];
  pary.sort((a, b) => a.od.localeCompare(b.od));
  return pary.some((o, i) => i > 0 && o.od <= pary[i - 1].do);
}

/** Okres i dziennik z arkusza „Opis parametrów” zestawień VULCAN. */
export function parametryZestawienia(arkusze) {
  const opis = (arkusze["Opis parametrów"] ?? []).flat().join("\n");
  const m = opis.match(/Badany okres:\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/);
  return { okres: m ? { od: dataIso(m[1]), do: dataIso(m[2]) } : null, dziennik: opis.match(/Dziennik:\s*([^;\n]+)/)?.[1].trim() ?? null };
}

/**
 * „Zestawienie frekwencji na lekcjach przedmiotów” (VULCAN): wiersz = uczeń,
 * nad kolumnami przedmiot (komórka scalona), pod nim symbole wpisów. Symbol
 * z parą kolumn (liczba, %) wchodzi do podstawy frekwencji, sam licznik nie —
 * tak liczy VULCAN. Blok „Wszystkie wpisy” to suma ucznia.
 * Zwraca {wiersz, uklad: "macierz", kolumny: {uczen, oddzial}, bloki, pozaPodstawa} albo null.
 */
export function rozpoznajMacierz(wiersze) {
  for (let r = 0; r < Math.min(wiersze.length - 1, 20); r++) {
    const naglowek = (wiersze[r] ?? []).map(norm);
    const symbole = (wiersze[r + 1] ?? []).map((s) => String(s ?? "").trim());
    const uczen = naglowek.findIndex((h) => /^uczeń/.test(h));
    if (uczen < 0 || !symbole.includes("% frekwencji")) continue;
    const oddzial = naglowek.findIndex((h) => ROLE.oddzial.wzor.test(h));
    const bloki = [];
    for (let i = uczen + 1; i < symbole.length; i++) {
      const przedmiot = String(wiersze[r][i] ?? "").trim();
      if (przedmiot) bloki.push({ przedmiot: przedmiot.replace(/\s*\([^)]*\)$/, ""), razem: /^wszystkie wpisy$/i.test(przedmiot), kolumny: [], kolProcent: null });
      const b = bloki.at(-1);
      const s = symbole[i];
      if (!b || !s) continue;
      if (s === "% frekwencji") b.kolProcent = i;
      else if (b.kolumny.at(-1)?.symbol === s && b.kolumny.at(-1).i === i - 1) b.kolumny.at(-1).wPodstawie = true; // druga kolumna pary to %
      else b.kolumny.push({ i, symbol: s, wPodstawie: false });
    }
    if (!bloki.length) continue;
    const pozaPodstawa = [...new Set(bloki.flatMap((b) => b.kolumny.filter((k) => !k.wPodstawie).map((k) => k.symbol)))];
    return { wiersz: r, uklad: "macierz", kolumny: { uczen, ...(oddzial >= 0 && { oddzial }) }, bloki, pozaPodstawa };
  }
  return null;
}

/** Wiersze zestawienia → wpisy z liczbami; suma ucznia ma razem = true i procent wyliczony przez VULCAN. */
export function czytajMacierz(wiersze, { wiersz, kolumny, bloki }) {
  const out = [];
  for (const w of wiersze.slice(wiersz + 2)) {
    if (!w) continue;
    const uczen = tekst(w, kolumny.uczen).replace(/,\s*nr\s*\d+\s*$/i, "");
    if (!uczen) continue;
    const oddzial = tekst(w, kolumny.oddzial);
    for (const b of bloki) {
      const p = tekst(w, b.kolProcent).replace("%", "").replace(",", ".");
      const extra = b.razem ? { razem: true, procentVulcan: p && !isNaN(Number(p)) ? Number(p) : null } : {};
      for (const k of b.kolumny) {
        const n = Number(tekst(w, k.i).replace(",", "."));
        if (n > 0) out.push({ uczen, oddzial, data: null, przedmiot: b.razem ? "" : b.przedmiot, lekcja: "", etykieta: k.symbol, n, ...extra });
      }
    }
  }
  return out;
}

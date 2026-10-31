// Odczyt danych wejściowych: eksport „Wykaz zrealizowanych tematów” z VULCAN
// i plan lekcji XML (eksport aSc albo „planNauczycieli”). Zwraca proste struktury dla silnika.

/** Klucz osoby niezależny od zapisu: „Nowak- Wiśniewska Ewa PLAN LEKCJI” = „Nowak-Wiśniewska Ewa (NW)”. */
export function kluczOsoby(tekst) {
  return String(tekst)
    .split("\n")[0]
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/PLAN LEKCJI|UŚREDNIENIE/gi, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pl");
}

/** Dopasowanie z tolerancją podwójnego nazwiska: „Lis Maria” ↔ „Lis-Kowalczyk Maria”. */
export function znajdzOsobe(klucz, klucze) {
  if (klucze.includes(klucz)) return klucz;
  // Nazwisko (pierwszy człon) i imię (ostatnie słowo) — „Zając ks. Jan” = „Zając Jan”.
  const czlony = (k) => {
    const s = k.split(" ");
    return [s[0].split("-")[0], s.at(-1)];
  };
  const [nazw, imie] = czlony(klucz);
  const pasuje = klucze.filter((k) => {
    const [n2, i2] = czlony(k);
    return n2 === nazw && i2 === imie && k.split(" ").length > 1;
  });
  return pasuje.length === 1 ? pasuje[0] : null;
}

/** Data z komórki: numer seryjny Excela („46267”) albo „dd.mm.rrrr”. */
export function dataIso(v) {
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

const KOLUMNY_TEMATOW = ["Szkoła", "Dziennik", "Grupa", "Przedmiot", "Nauczyciel", "Data realizacji", "Numer pory lekcji", "Zastępstwo"];

/**
 * Wiersze arkusza „Wykaz zrealizowanych tematów” → lekcje.
 * Kolumny „Pseudonim Ucznia” i „Temat” są pomijane od razu — nie są potrzebne
 * do rozliczenia, a mogą identyfikować ucznia.
 */
export function lekcjeZTematow(wiersze) {
  const naglowek = wiersze[0].map((h) => String(h).trim());
  const brak = KOLUMNY_TEMATOW.filter((k) => !naglowek.includes(k));
  if (brak.length) throw Error(`Eksport tematów: brak kolumn ${brak.join(", ")}.`);
  const k = Object.fromEntries(KOLUMNY_TEMATOW.map((c) => [c, naglowek.indexOf(c)]));
  const lekcje = [];
  for (const w of wiersze.slice(1)) {
    if (!w?.[k["Nauczyciel"]]) continue;
    const data = dataIso(w[k["Data realizacji"]]);
    if (!data) throw Error(`Eksport tematów: nieczytelna data „${w[k["Data realizacji"]]}”.`);
    lekcje.push({
      osoba: kluczOsoby(w[k["Nauczyciel"]]),
      nazwa: String(w[k["Nauczyciel"]]).replace(/\s*\(.*?\)\s*$/, "").trim(),
      data,
      lekcja: Number(w[k["Numer pory lekcji"]]),
      szkola: String(w[k["Szkoła"]]),
      oddzial: String(w[k["Dziennik"]]),
      grupa: String(w[k["Grupa"]]),
      przedmiot: String(w[k["Przedmiot"]]),
      zastepstwo: String(w[k["Zastępstwo"]]).trim() === "Tak",
      ind: /\(IND\)|^Indywidualne/.test(String(w[k["Grupa"]])),
    });
  }
  return lekcje;
}

/**
 * Realizacja dzienna: {osoba: {data: {godziny, lekcje[], ind, zastepstwa, szkoly}}}.
 * Godzina = jedna pora lekcyjna; kilka grup naraz (złączenie) to jedna godzina.
 * Nauczanie indywidualne i zastępstwa są liczone osobno, poza sumą dnia —
 * tak jak w dotychczasowym arkuszu ROZLICZONE.
 */
export function realizacjaDzienna(lekcje) {
  const out = {};
  for (const l of lekcje) {
    const dzien = ((out[l.osoba] ??= {})[l.data] ??= { pory: new Set(), ind: new Set(), zastepstwa: new Set(), szkoly: {} });
    if (l.ind) dzien.ind.add(l.lekcja);
    else if (l.zastepstwo) dzien.zastepstwa.add(l.lekcja);
    else if (!dzien.pory.has(l.lekcja)) {
      dzien.pory.add(l.lekcja);
      dzien.szkoly[l.szkola] = (dzien.szkoly[l.szkola] ?? 0) + 1;
    }
  }
  for (const osoba of Object.values(out))
    for (const [data, d] of Object.entries(osoba))
      osoba[data] = {
        godziny: d.pory.size,
        lekcje: [...d.pory].sort((a, b) => a - b),
        ind: d.ind.size,
        zastepstwa: [...d.zastepstwa].sort((a, b) => a - b),
        szkoly: d.szkoly,
      };
  return out;
}

const DNI_TYGODNIA = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek"];

/** Data „obowiązuje od” zapisana w pliku planu (tylko format „planNauczycieli”). */
export function planOdZXml(xml) {
  return (xml.match(/<planNauczycieli\b[^>]*\bobowiazujeOd="(\d{4}-\d{2}-\d{2})"/) ?? [])[1] ?? null;
}

/** Plan lekcji XML → {osoba: {dzień tygodnia 1–5: [pory lekcyjne]}}. */
export function planZXml(xml, DOMParser) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const tag = (t) => Array.from(doc.getElementsByTagName(t));
  if (doc.documentElement?.nodeName === "planNauczycieli") return planNauczycieli(tag("nauczyciel"));
  const nauczyciele = Object.fromEntries(
    tag("teacher").map((t) => [t.getAttribute("id"), kluczOsoby(`${t.getAttribute("lastname")} ${t.getAttribute("firstname")}`)]),
  );
  const lekcje = Object.fromEntries(
    tag("lesson").map((l) => [l.getAttribute("id"), { ids: l.getAttribute("teacherids").split(",").filter(Boolean), dl: Number(l.getAttribute("periodspercard")) || 1 }]),
  );
  const plan = {};
  for (const c of tag("card")) {
    const l = lekcje[c.getAttribute("lessonid")];
    if (!l) continue;
    const dni = c.getAttribute("days");
    const dzien = dni.indexOf("1") + 1;
    if (dzien < 1) continue;
    for (const id of l.ids) {
      const osoba = nauczyciele[id];
      if (!osoba) continue;
      const pory = ((plan[osoba] ??= {})[dzien] ??= new Set());
      for (let p = 0; p < l.dl; p++) pory.add(Number(c.getAttribute("period")) + p);
    }
  }
  for (const o of Object.values(plan)) for (const d of Object.keys(o)) o[d] = [...o[d]].sort((a, b) => a - b);
  return plan;
}

/** Format „planNauczycieli”: <nauczyciel nazwisko imie><lekcja dzien="Wtorek" godzina="1"/>. */
function planNauczycieli(nauczyciele) {
  const plan = {};
  for (const n of nauczyciele) {
    const osoba = kluczOsoby(`${n.getAttribute("nazwisko")} ${n.getAttribute("imie")}`);
    for (const l of Array.from(n.getElementsByTagName("lekcja"))) {
      const dzien = DNI_TYGODNIA.indexOf(l.getAttribute("dzien").trim().toLocaleLowerCase("pl")) + 1;
      const pora = Number(l.getAttribute("godzina"));
      if (dzien < 1 || !pora) continue;
      ((plan[osoba] ??= {})[dzien] ??= new Set()).add(pora);
    }
  }
  for (const o of Object.values(plan)) for (const d of Object.keys(o)) o[d] = [...o[d]].sort((a, b) => a - b);
  return plan;
}

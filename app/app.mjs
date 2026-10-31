// Interfejs aplikacji. Wszystko dzieje się w przeglądarce: pliki są czytane
// lokalnie, stan zapisuje się do pliku JSON wskazanego przez użytkownika.
import { readWorkbook } from "../src/xlsx.mjs";
import { lekcjeZTematow, realizacjaDzienna, planZXml, planOdZXml, kluczOsoby, znajdzOsobe } from "../src/wejscie.mjs";
import { czytajZestawienie, czytajInformacjeOZastepstwach, czytajPrzeniesienia, rodzajSkoroszytu } from "../src/zmiany.mjs";
import { konfiguracjaZArkusza } from "../src/konfiguracja.mjs";
import { nowyStan, wczytajStan, zapiszStan, dodajTematy, dodajZestawienie, dodajInformacje, dodajPlan, ustawDecyzje } from "../src/stan.mjs";
import { rozliczWszystkich, analizaDnia } from "../src/rozliczenie.mjs";
import { tygodnieMiesiaca, dodajDni, POWODY_ODLICZENIA, dzienTygodnia } from "../src/silnik.mjs";
import { eksportMiesiaca, opisDecyzji } from "../src/eksport.mjs";
import { raportNauczyciela } from "../src/raport.mjs";

const $ = (s) => document.querySelector(s);
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DNI = ["", "pn", "wt", "śr", "czw", "pt"];
const MIESIACE = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const nazwaMiesiaca = (m) => `${MIESIACE[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const dm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const odmiana = (n, [jeden, kilka, wiele]) => `${n} ${n === 1 ? jeden : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? kilka : wiele}`;
const liczba = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100).replace(".", ","));
const puste = (x) => (x ? liczba(x) : "");
const ETYKIETY_ODL = { innyMiesiac: "inny m-c", wolne: "wolne", nieobecnosc: "nieob.", bezZajec: "bez zajęć", przedZatrudnieniem: "—" };
const TRYBY = { tematy: "tematy z dziennika", srednia: "pensum uśrednione", staly: "stały plan (specjaliści)" };
const PLAN_REPO = "https://raw.githubusercontent.com/adeodatus11/zastepstwa/przebudowa/";

const ui = {
  widok: "tydzien",
  miesiac: (() => {
    const d = new Date().toISOString().slice(0, 7);
    return d >= "2026-09" && d <= "2027-08" ? d : "2026-09";
  })(),
  tydzien: null,
  raport: "*", // klucz nauczyciela albo "*" — wszyscy
  szukaj: "",
  tylkoWyj: false,
  komunikaty: [],
};
let stan = nowyStan();
let uchwyt = null;
let nazwaPliku = null;
let zmiany = false;

function zmieniono() {
  zmiany = true;
  render();
}
function komunikat(tekst, rodzaj = "") {
  ui.komunikaty.unshift({ tekst, rodzaj });
  ui.komunikaty = ui.komunikaty.slice(0, 6);
}

// ——— pliki ———
// Kolejność przy wgraniu kilku plików naraz: najpierw plik rozliczenia, potem plan (potrzebny konfiguracji z arkusza).
const KOLEJNOSC_PLIKOW = (f) => (/\.json$/i.test(f.name) ? 0 : /\.xml$/i.test(f.name) ? 1 : 2);

async function wczytajPliki(pliki) {
  for (const f of [...pliki].sort((a, b) => KOLEJNOSC_PLIKOW(a) - KOLEJNOSC_PLIKOW(b))) {
    try {
      if (/\.json$/i.test(f.name)) {
        stan = wczytajStan(await f.text());
        uchwyt = null;
        nazwaPliku = f.name;
        zmiany = false;
        komunikat(`Otwarto rozliczenie ${f.name}.`);
      } else if (/\.xml$/i.test(f.name)) {
        const bajty = new Uint8Array(await f.arrayBuffer());
        const kod = /encoding="windows-1250"/i.test(new TextDecoder("latin1").decode(bajty.slice(0, 200))) ? "windows-1250" : "utf-8";
        const xml = new TextDecoder(kod).decode(bajty);
        const od = planOdZXml(xml) ?? (f.name.match(/\d{4}-\d{2}-\d{2}/) ?? [])[0] ?? prompt(`Od kiedy obowiązuje plan z pliku ${f.name}? (RRRR-MM-DD)`, new Date().toISOString().slice(0, 10));
        if (!od) continue;
        const plan = planZXml(xml, DOMParser);
        if (!Object.keys(plan).length) throw Error("w pliku nie znaleziono planu lekcji nauczycieli (oczekiwany eksport aSc albo „planNauczycieli”)");
        dodajPlan(stan, plan, od, f.name);
        zmiany = true;
        komunikat(`Plan lekcji od ${od}: ${Object.keys(plan).length} nauczycieli.`);
      } else {
        const { sheets } = await readWorkbook(await f.arrayBuffer(), DOMParser);
        const rodzaj = rodzajSkoroszytu(sheets);
        if (rodzaj === "tematy") {
          const r = dodajTematy(stan, realizacjaDzienna(lekcjeZTematow(sheets["Wykaz zrealizowanych tematów"])), f.name);
          zmiany = true;
          komunikat(`Tematy ${dm(r.od)}–${dm(r.do)}: ${r.osob} nauczycieli. Lekcje IND i zastępstwa liczone osobno.`);
          ui.miesiac = r.do.slice(0, 7) <= "2027-08" ? r.do.slice(0, 7) : ui.miesiac;
          ui.tydzien = null;
        } else if (rodzaj === "zestawienie") {
          const okres = dodajZestawienie(stan, czytajZestawienie(sheets), f.name);
          zmiany = true;
          komunikat(`Zestawienie zmian ${dm(okres.od)}–${dm(okres.do)}: powody nieobecności i formy płatności zastępstw.`);
        } else if (rodzaj === "zastepstwa") {
          const z = czytajInformacjeOZastepstwach(sheets);
          const okres = dodajInformacje(stan, "zastepstwa", z.okres, z.zastepstwa, f.name);
          zmiany = true;
          komunikat(`Informacje o zastępstwach ${dm(okres.od)}–${dm(okres.do)}: kontrola form płatności ze zbiorczego zestawienia zmian.`);
        } else if (rodzaj === "przeniesienia") {
          const p = czytajPrzeniesienia(sheets);
          const okres = dodajInformacje(stan, "przeniesienia", p.okres, p.przeniesienia, f.name);
          zmiany = true;
          komunikat(`Informacje o przeniesieniach ${dm(okres.od)}–${dm(okres.do)}: przeniesione lekcje zmieniają plan dnia.`);
        } else if (rodzaj === "arkusz") {
          const konf = konfiguracjaZArkusza(sheets, { plan: stan.plany.at(-1)?.plan ?? null });
          let nowi = 0;
          const nadpisz = Object.keys(stan.nauczyciele).length > 0 && confirm("Nadpisać konfigurację nauczycieli, którzy już są w rozliczeniu? (Anuluj = dodaj tylko nowych)");
          for (const [k, n] of Object.entries(konf))
            if (!stan.nauczyciele[k] || nadpisz) {
              stan.nauczyciele[k] = n;
              nowi++;
            }
          zmiany = true;
          komunikat(`Konfiguracja z arkusza ${f.name}: ${nowi} nauczycieli. Sprawdź zakładkę „Nauczyciele”.`);
        } else komunikat(`Nie rozpoznano pliku ${f.name}. Oczekiwane: eksport tematów, zestawienie zmian, informacje o zastępstwach lub przeniesieniach, plan XML albo arkusz PLANOWE/ROZLICZONE.`, "blad");
      }
    } catch (e) {
      komunikat(`${f.name}: ${e.message}`, "blad");
    }
  }
  render();
}

async function pobierzPlanZSerwisu() {
  try {
    const pub = await fetch(PLAN_REPO + "publication.json").then((r) => r.json());
    const bajty = new Uint8Array(await fetch(PLAN_REPO + encodeURIComponent(pub.sources.xml)).then((r) => r.arrayBuffer()));
    const plan = planZXml(new TextDecoder("windows-1250").decode(bajty), DOMParser);
    dodajPlan(stan, plan, pub.validFrom, pub.sources.xml);
    komunikat(`Pobrano plan ${pub.sources.xml} (od ${pub.validFrom}).`);
    zmiany = true;
  } catch (e) {
    komunikat(`Nie udało się pobrać planu: ${e.message}`, "blad");
  }
  render();
}

async function zapisz() {
  const tekst = zapiszStan(stan);
  try {
    if (!uchwyt && window.showSaveFilePicker)
      uchwyt = await showSaveFilePicker({ suggestedName: nazwaPliku ?? "rozliczenie-godzin-2026-2027.json", types: [{ description: "Rozliczenie godzin", accept: { "application/json": [".json"] } }] });
    if (uchwyt) {
      const w = await uchwyt.createWritable();
      await w.write(tekst);
      await w.close();
      nazwaPliku = uchwyt.name;
    } else pobierz(new Blob([tekst], { type: "application/json" }), nazwaPliku ?? "rozliczenie-godzin-2026-2027.json");
    zmiany = false;
    komunikat(`Zapisano ${nazwaPliku ?? "plik"}.`);
  } catch (e) {
    if (e.name !== "AbortError") komunikat(`Zapis nie powiódł się: ${e.message}`, "blad");
  }
  render();
}

async function otworz() {
  if (zmiany && !confirm("Są niezapisane zmiany. Otworzyć inny plik?")) return;
  if (window.showOpenFilePicker) {
    try {
      [uchwyt] = await showOpenFilePicker({ types: [{ description: "Rozliczenie godzin", accept: { "application/json": [".json"] } }] });
      const f = await uchwyt.getFile();
      stan = wczytajStan(await f.text());
      nazwaPliku = f.name;
      zmiany = false;
      komunikat(`Otwarto rozliczenie ${f.name}.`);
    } catch (e) {
      if (e.name !== "AbortError") komunikat(e.message, "blad");
    }
    render();
  } else $("#wyborStanu").click();
}

function pobierz(blob, nazwa) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: nazwa });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ——— widoki ———
function render() {
  $("#plik").innerHTML = `${h(nazwaPliku ?? "nowe rozliczenie (niezapisane)")}${zmiany ? " · <b>niezapisane zmiany</b>" : ""}`;
  const wyniki = Object.keys(stan.nauczyciele).length ? rozliczWszystkich(stan, ui.miesiac) : [];
  const tygodnie = tygodnieMiesiaca(ui.miesiac);
  if (!tygodnie.includes(ui.tydzien)) ui.tydzien = tygodnie.findLast((t) => stan.zrodla.some((z) => z.rodzaj === "tematy" && z.do >= t && z.od <= dodajDni(t, 4))) ?? tygodnie[0];
  const zakladki = [["tydzien", "Tydzień"], ["miesiac", "Miesiąc"], ["nauczyciele", `Nauczyciele (${Object.keys(stan.nauczyciele).length})`], ["uwagi", `Uwagi (${dniZUwagami(wyniki).length})`], ["raport", "Raport nauczyciela"], ["kalendarz", "Kalendarz"], ["zrodla", "Źródła"]];
  const miesiace = [];
  for (let d = new Date(Date.UTC(2026, 8, 1)); d < new Date(Date.UTC(2027, 8, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) miesiace.push(d.toISOString().slice(0, 7));
  $("#app").innerHTML = `
    <div class="drop" id="drop">
      <p><b>Przeciągnij tutaj wszystkie pliki naraz</b> (albo wybierz) — rodzaj rozpozna się sam. Co tydzień: <i>ZestawienieTematowZrealizowanych</i>, <i>ZbiorczeZestawienieZmian</i>, <i>InformacjeOZastepstwach</i>, <i>InformacjeOPrzeniesieniach</i>. Na start: plan lekcji (XML) i arkusz PLANOWE (konfiguracja nauczycieli). Pliki są czytane tylko na tym komputerze.</p>
      <button type="button" data-akcja="wybierz">Wybierz pliki…</button>
    </div>
    ${ui.komunikaty.length ? `<ul class="komunikaty">${ui.komunikaty.slice(0, 3).map((k) => `<li class="${k.rodzaj}">${h(k.tekst)}</li>`).join("")}<li class="zamknij"><button type="button" class="link" data-akcja="zamknijKom">ukryj komunikaty</button></li></ul>` : ""}
    ${banery(wyniki)}
    <nav class="zakladki">${zakladki.map(([k, t]) => `<button type="button" data-widok="${k}" aria-current="${ui.widok === k}">${t}</button>`).join("")}</nav>
    <div class="pasek">
      <label>Miesiąc <select data-pole="miesiac">${miesiace.map((m) => `<option value="${m}" ${m === ui.miesiac ? "selected" : ""}>${nazwaMiesiaca(m)}</option>`).join("")}</select></label>
      ${ui.widok === "raport" ? `<label>Nauczyciel <select data-pole="raport"><option value="*" ${ui.raport === "*" ? "selected" : ""}>wszyscy (każdy na osobnej stronie)</option>${Object.entries(stan.nauczyciele)
        .sort((a, b) => a[1].nazwa.localeCompare(b[1].nazwa, "pl"))
        .map(([k, n]) => `<option value="${h(k)}" ${k === ui.raport ? "selected" : ""}>${h(n.nazwa)}</option>`)
        .join("")}</select></label>` : ""}
      ${ui.widok === "tydzien" ? `<label>Tydzień <select data-pole="tydzien">${tygodnie.map((t) => `<option value="${t}" ${t === ui.tydzien ? "selected" : ""}>${dm(t)}–${dm(dodajDni(t, 4))}</option>`).join("")}</select></label>` : ""}
      ${["tydzien", "miesiac", "uwagi"].includes(ui.widok) ? `<label>Szukaj <input type="search" data-pole="szukaj" value="${h(ui.szukaj)}" placeholder="nazwisko"></label>
      <label><input type="checkbox" data-pole="tylkoWyj" ${ui.tylkoWyj ? "checked" : ""}> tylko do wyjaśnienia</label>` : ""}
      <span class="spacer"></span>
      ${ui.widok === "tydzien" ? `<button type="button" data-akcja="podpowiedzi">Zastosuj podpowiedzi w tygodniu</button>` : ""}
      ${ui.widok === "raport" ? `<button type="button" class="primary" data-akcja="drukuj" ${wyniki.length ? "" : "disabled"}>Drukuj / zapisz jako PDF</button>` : ""}
      ${ui.widok === "miesiac" ? `<button type="button" class="primary" data-akcja="xlsx" ${wyniki.length ? "" : "disabled"}>Pobierz XLSX za ${nazwaMiesiaca(ui.miesiac)}</button>` : ""}
    </div>
    <div id="widok">${{ tydzien: widokTydzien, miesiac: widokMiesiac, nauczyciele: widokNauczyciele, uwagi: widokUwagi, raport: widokRaport, kalendarz: widokKalendarz, zrodla: widokZrodla }[ui.widok](wyniki)}</div>`;
}

function banery(wyniki) {
  const out = [];
  if (!Object.keys(stan.nauczyciele).length)
    out.push(`Brak konfiguracji nauczycieli. Wgraj arkusz PLANOWE (przeniesie pensum, limity, uśrednienia) albo dodaj osoby w zakładce „Nauczyciele”.`);
  if (!stan.plany.length) out.push(`Brak planu lekcji — aplikacja nie pokaże, których lekcji brakuje. <button type="button" class="link" data-akcja="planSerwis">Pobierz aktualny plan z serwisu nauczyciela</button>`);
  const bezFormy = wyniki.reduce((s, w) => s + Object.values(w.dni).filter((a) => a.data.startsWith(ui.miesiac)).reduce((x, a) => x + a.bezFormy, 0), 0);
  if (bezFormy) out.push(`${odmiana(bezFormy, ["zastępstwo", "zastępstwa", "zastępstw"])} z tematów bez formy płatności, bo brak zbiorczego zestawienia zmian za te dni — nie są liczone. Wgraj <i>ZbiorczeZestawienieZmian</i>.`);
  const kluczeKonf = Object.keys(stan.nauczyciele);
  const brakujacy = Object.keys(stan.realizacja).filter((k) => !znajdzOsobe(k, kluczeKonf) && Object.keys(stan.realizacja[k]).some((d) => d.startsWith(ui.miesiac)));
  if (kluczeKonf.length && brakujacy.length)
    out.push(`${odmiana(brakujacy.length, ["osoba", "osoby", "osób"])} z tematów — brak w konfiguracji: ${h(brakujacy.slice(0, 6).join(", "))}${brakujacy.length > 6 ? "…" : ""}. <button type="button" class="link" data-akcja="dodajBrakujacych">Dodaj z pensum 18 i limitem 0</button>`);
  return out.length ? `<ul class="komunikaty">${out.map((t) => `<li class="uwaga">${t}</li>`).join("")}</ul>` : "";
}

const pasujeFiltr = (w) => !ui.szukaj || stan.nauczyciele[w.osoba].nazwa.toLocaleLowerCase("pl").includes(ui.szukaj.toLocaleLowerCase("pl"));

function komorka(w, d) {
  const n = stan.nauczyciele[w.osoba];
  if (!d.data.startsWith(ui.miesiac)) return `<td class="dzien inny">—</td>`;
  const a = w.dni[d.data];
  const attr = `data-osoba="${h(w.osoba)}" data-data="${d.data}" title="${h([a.kalendarz?.opis, ...a.uwagi, a.decyzja ? `decyzja: ${opisDecyzji(a.decyzja)}${a.decyzja.uwaga ? ` — ${a.decyzja.uwaga}` : ""}` : ""].filter(Boolean).join("\n"))}"`;
  if (d.odliczenie) return `<td class="dzien odl ${a.decyzja ? "kor" : ""}" ${attr}>${a.decyzja ? `<span class="znak">●</span>` : ""}${ETYKIETY_ODL[d.odliczenie] ?? d.odliczenie}</td>`;
  if (a.brakDanych && !a.decyzja) return `<td class="dzien brak ${a.doWyjasnienia ? "wyj" : ""}" ${attr}>${a.podpowiedz ? `<span class="znak">✦</span>` : ""}?</td>`;
  const klasa = a.decyzja ? "kor" : a.doWyjasnienia ? "wyj" : "";
  const planInfo = n.tryb === "tematy" && a.plan && a.plan.length !== d.godziny ? `<span class="p">plan ${a.plan.length}</span>` : "";
  const dodatki = [a.ind ? `IND ${a.ind}` : "", a.dorazne ? `dor. ${a.dorazne}` : "", a.kkz ? `KKZ ${a.kkz}` : ""].filter(Boolean).join(" · ");
  return `<td class="dzien ${klasa}" ${attr}>${a.decyzja ? `<span class="znak">●</span>` : a.podpowiedz ? `<span class="znak">✦</span>` : ""}<span class="g">${liczba(d.godziny)}</span>${planInfo}${dodatki ? `<span class="p">${dodatki}</span>` : ""}</td>`;
}

function widokTydzien(wyniki) {
  if (!wyniki.length) return `<div class="pusto">Najpierw wgraj konfigurację nauczycieli i eksport tematów.</div>`;
  const pn = ui.tydzien;
  const wiersze = wyniki
    .map((w) => ({ w, t: w.tygodnie.find((t) => t.poniedzialek === pn) }))
    .filter(({ w, t }) => pasujeFiltr(w) && (!ui.tylkoWyj || t.dni.some((d) => d.data.startsWith(ui.miesiac) && w.dni[d.data].doWyjasnienia)));
  const sumaDod = (w, t, pole) => t.dni.filter((d) => d.data.startsWith(ui.miesiac) && !d.odliczenie).reduce((s, d) => s + (w.dni[d.data][pole] || 0), 0);
  const dniNag = [0, 1, 2, 3, 4].map((i) => {
    const data = dodajDni(pn, i);
    const kal = stan.kalendarz[data];
    return `<th class="dzienNag" data-dzienall="${data}" title="Decyzja dla wszystkich nauczycieli w tym dniu">${DNI[i + 1]} ${dm(data)}${kal ? `<br><small>${h(kal.czesciowy ? "część klas wolna" : "wolne")}</small>` : ""}</th>`;
  });
  return `<div class="tabela"><table>
    <thead><tr><th>Nauczyciel</th>${dniNag.join("")}<th class="sep">Suma</th><th>Pensum</th><th>Maks.</th><th>Do rozl.</th><th class="sep">IND</th><th>KKZ</th><th>Dor.</th></tr></thead>
    <tbody>${wiersze
      .map(({ w, t }) => {
        const n = stan.nauczyciele[w.osoba];
        return `<tr><td class="nazwa">${h(n.nazwa)}<small>${h(TRYBY[n.tryb])} · pensum ${liczba(n.pensum)}${n.dniPracy.length < 5 ? ` (${n.dniPracy.map((d) => DNI[d]).join(",")})` : ""}</small></td>
        ${t.dni.map((d) => komorka(w, d)).join("")}
        <td class="sep">${liczba(t.suma)}</td><td>${liczba(t.pensum)}</td><td>${liczba(t.maks)}</td><td class="wynik">${liczba(t.doRozliczenia)}</td>
        <td class="sep">${puste(sumaDod(w, t, "ind"))}</td><td>${puste(sumaDod(w, t, "kkz"))}</td><td>${puste(sumaDod(w, t, "dorazne"))}</td></tr>`;
      })
      .join("")}</tbody></table></div>
    <div class="legenda"><span class="l-wyj">do wyjaśnienia</span><span class="l-kor">Twoja decyzja</span><span class="l-odl">dzień odliczony (pensum −1/5)</span><span>✦ jest podpowiedź</span><span>? brak eksportu tematów za ten dzień</span><span>„plan N” — lekcji w planie, gdy różni się od tematów</span><span>Kliknij dzień, żeby zobaczyć szczegóły i zdecydować; nagłówek dnia — decyzja dla wszystkich.</span></div>`;
}

/** Dni miesiąca z uwagami automatycznymi albo do wyjaśnienia, w kolejności daty i nazwiska. */
const dniZUwagami = (wyniki) =>
  wyniki
    .flatMap((w) => Object.values(w.dni).filter((a) => a.data.startsWith(ui.miesiac) && (a.uwagi.length || a.doWyjasnienia)).map((a) => ({ w, a })))
    .sort((x, y) => x.a.data.localeCompare(y.a.data) || stan.nauczyciele[x.w.osoba].nazwa.localeCompare(stan.nauczyciele[y.w.osoba].nazwa, "pl"));

function widokUwagi(wyniki) {
  const lista = dniZUwagami(wyniki).filter(({ w, a }) => pasujeFiltr(w) && (!ui.tylkoWyj || a.doWyjasnienia));
  if (!lista.length) return `<div class="pusto">Brak uwag w miesiącu ${nazwaMiesiaca(ui.miesiac)}.</div>`;
  const status = (a) => (a.decyzja ? `<span class="status-kor">decyzja: ${h(opisDecyzji(a.decyzja))}</span>` : a.doWyjasnienia ? `<span class="status-wyj">do wyjaśnienia</span>` : "informacja");
  return `<div class="tabela"><table class="konf listaUwag">
    <thead><tr><th>Data</th><th>Nauczyciel</th><th>Godziny</th><th>Status</th><th>Uwagi</th></tr></thead>
    <tbody>${lista
      .map(({ w, a }) => `<tr data-osoba="${h(w.osoba)}" data-data="${a.data}" class="klik"><td>${DNI[dzienTygodnia(a.data)] ?? ""} ${dm(a.data)}</td><td>${h(stan.nauczyciele[w.osoba].nazwa)}</td><td>${liczba(a.godziny)}</td><td>${status(a)}</td><td>${a.uwagi.map(h).join("<br>") || "—"}</td></tr>`)
      .join("")}</tbody></table></div>
    <p class="uwagaMala">Kliknij wiersz, żeby zobaczyć szczegóły dnia i zdecydować. Uwagi pochodzą z porównania planu, tematów i raportów zmian (zastępstwa, przeniesienia, nieobecności).</p>`;
}

const powodyOdliczen = (xs) => [...new Set(xs.map((x) => x.powod))].map((p) => `${odmiana(xs.filter((x) => x.powod === p).length, ["dzień", "dni", "dni"])}: ${p}`).join("; ");

function htmlRaportu(r) {
  const tab = (naglowki, wiersze, klasa = "") => `<table class="${klasa}"><thead><tr>${naglowki.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${wiersze.join("")}</tbody></table>`;
  const dniPracy = r.dniPracy.length < 5 ? ` (dni pracy: ${r.dniPracy.map((d) => DNI[d]).join(", ")})` : "";
  return `<article class="raport">
    <h2>${h(r.nazwa)}</h2>
    <p class="podtytul">Rozliczenie godzin — ${nazwaMiesiaca(r.miesiac)} · ${h(TRYBY[r.tryb])} · pensum ${liczba(r.pensum)} h/tydz.${dniPracy} · przydział ponadwymiarowych do ${liczba(r.maks)} h/tydz.</p>
    ${r.doWyjasnienia ? `<p class="ostrzezenie">Raport wstępny: ${odmiana(r.doWyjasnienia, ["dzień jest", "dni są", "dni jest"])} do wyjaśnienia (zob. „Dni”). Po decyzjach liczby mogą się zmienić.</p>` : ""}
    <h3>Do wypłaty</h3>
    ${tab(["Za co", "Podstawa", "Godziny"], [...r.pozycje.map((p) => `<tr><td>${h(p.co)}</td><td>${h(p.podstawa)}</td><td class="liczba">${liczba(p.godziny)}</td></tr>`), `<tr class="razem"><td>Razem</td><td></td><td class="liczba">${liczba(r.razem)}</td></tr>`], "pozycje")}
    <h3>Tygodnie (godziny ponadwymiarowe)</h3>
    ${tab(
      ["Tydzień", "Zrealizowane", "Pensum", "Pensum obniżone o", "Nad pensum", "Limit", "Do rozliczenia"],
      r.tygodnie.map((t) => `<tr><td>${dm(t.od)}–${dm(t.do)}</td><td class="liczba">${liczba(t.suma)}</td><td class="liczba">${liczba(t.pensum)}</td><td>${t.odliczone.length ? h(powodyOdliczen(t.odliczone)) : "—"}</td><td class="liczba">${liczba(t.nadPensum)}</td><td class="liczba">${liczba(t.maks)}</td><td class="liczba"><b>${liczba(t.doRozliczenia)}</b></td></tr>`),
    )}
    <p class="uwagaMala">Do rozliczenia = nadwyżka nad pensum, nie więcej niż przydzielony limit. Pensum obniża się o 1/5 (1/4) za każdy dzień z art. 35 ust. 3f KN.</p>
    ${r.dorazne.length ? `<h3>Doraźne zastępstwa</h3>${tab(["Data", "Lekcja", "Za kogo", "Oddział"], r.dorazne.map((z) => (z.opis ? `<tr><td>${DNI[dzienTygodnia(z.data)]} ${dm(z.data)}</td><td colspan="3">${h(z.opis)}</td></tr>` : `<tr><td>${DNI[dzienTygodnia(z.data)]} ${dm(z.data)}</td><td>${z.lekcja}</td><td>${h(z.zaKogo ?? "")}</td><td>${h(z.oddzial ?? "")}</td></tr>`)))}` : ""}
    <h3>Dni</h3>
    ${tab(
      ["Dzień", "Godziny", "Skład", "Decyzja / odliczenie", "Uwagi"],
      r.dni.map((d) => {
        const sklad = d.odliczenie ? "—" : r.tryb !== "tematy" ? h(TRYBY[r.tryb]) : [`lekcje z tematem ${d.lekcje}`, d.doZliczenia.length ? `do zliczenia ${d.doZliczenia.length} (lekcje ${d.doZliczenia.join(",")})` : "", d.dorazne ? `doraźne ${d.dorazne}` : "", d.ind ? `IND ${d.ind}` : "", d.kkz ? `KKZ ${d.kkz}` : ""].filter(Boolean).join(" · ");
        const decyzja = d.decyzja ? `${opisDecyzji(d.decyzja)}${d.decyzja.uwaga ? ` — ${d.decyzja.uwaga}` : ""}` : d.odliczenie ?? "";
        return `<tr class="${d.doWyjasnienia ? "wyj" : ""}"><td>${d.dzien} ${dm(d.data)}</td><td class="liczba">${d.odliczenie ? "—" : liczba(d.godziny)}</td><td>${sklad}</td><td>${h(decyzja)}</td><td>${d.uwagi.map(h).join("<br>")}${d.doWyjasnienia ? `${d.uwagi.length ? "<br>" : ""}<b>do wyjaśnienia</b>` : ""}</td></tr>`;
      }),
      "dni",
    )}
    <p class="uwagaMala stopka">Wygenerowano ${new Date().toLocaleString("pl-PL")} z eksportów dziennika VULCAN, planu lekcji i decyzji dyrekcji.</p>
  </article>`;
}

function widokRaport(wyniki) {
  if (!wyniki.length) return `<div class="pusto">Najpierw wgraj konfigurację nauczycieli i eksport tematów.</div>`;
  const lista = ui.raport === "*" ? wyniki : wyniki.filter((w) => w.osoba === ui.raport);
  if (!lista.length) return `<div class="pusto">Wybierz nauczyciela.</div>`;
  return `<div class="raporty">${lista.map((w) => htmlRaportu(raportNauczyciela(stan, w, ui.miesiac))).join("")}</div>`;
}

function widokMiesiac(wyniki) {
  if (!wyniki.length) return `<div class="pusto">Brak danych.</div>`;
  const lista = wyniki.filter((w) => pasujeFiltr(w) && (!ui.tylkoWyj || w.doWyjasnienia));
  const tyg = wyniki[0].tygodnie.map((t) => t.poniedzialek);
  const suma = (f) => liczba(lista.reduce((s, w) => s + f(w), 0));
  return `<div class="tabela"><table>
    <thead><tr><th>Nauczyciel</th>${tyg.map((t) => `<th>od ${dm(t)}</th>`).join("")}<th class="sep">Suma</th><th>Ponadwym. do wypłaty</th><th class="sep">IND</th><th>KKZ</th><th>Doraźne</th><th class="sep">Razem</th><th>Do wyjaśnienia</th></tr></thead>
    <tbody>${lista
      .map(
        (w) => `<tr><td class="nazwa"><button type="button" class="link" data-raport="${h(w.osoba)}" title="Raport nauczyciela">${h(stan.nauczyciele[w.osoba].nazwa)}</button></td>${w.tygodnie.map((t) => `<td>${liczba(t.doRozliczenia)}</td>`).join("")}
      <td class="sep">${liczba(w.suma)}</td><td class="wynik">${w.doWyplaty}</td><td class="sep">${puste(w.ind)}</td><td>${puste(w.kkz)}</td><td>${puste(w.dorazne)}</td>
      <td class="sep wynik">${liczba(w.razem)}</td><td>${w.doWyjasnienia ? `<button type="button" class="link" data-dowyj="${h(w.osoba)}">${w.doWyjasnienia} dni</button>` : "—"}</td></tr>`,
      )
      .join("")}</tbody>
    <tfoot><tr><td>Razem (${lista.length})</td>${tyg.map(() => "<td></td>").join("")}<td class="sep">${suma((w) => w.suma)}</td><td>${suma((w) => w.doWyplaty)}</td><td class="sep">${suma((w) => w.ind)}</td><td>${suma((w) => w.kkz)}</td><td>${suma((w) => w.dorazne)}</td><td class="sep">${suma((w) => w.razem)}</td><td>${suma((w) => w.doWyjasnienia)}</td></tr></tfoot>
    </table></div>
    <p class="uwagaMala">Ponadwymiarowe do wypłaty: suma tygodni zaokrąglona (do 0,5 w dół, powyżej w górę — art. 35 ust. 3h KN). IND, KKZ i doraźne zastępstwa są rozliczane osobno, poza pensum.</p>`;
}

function widokNauczyciele() {
  const lista = Object.entries(stan.nauczyciele).sort((a, b) => a[1].nazwa.localeCompare(b[1].nazwa, "pl"));
  return `<div class="tabela"><table class="konf">
    <thead><tr><th>Nauczyciel</th><th>Tryb</th><th>Pensum</th><th>Maks. ponadwym./tydz.</th><th>Dni pracy (na nie rozkłada się pensum)</th><th>Godziny dzienne (uśrednienie / stały plan)</th><th>Od</th><th>Do</th><th>Uwagi</th><th></th></tr></thead>
    <tbody>${lista
      .map(
        ([k, n]) => `<tr data-n="${h(k)}">
      <td><input type="text" data-k="nazwa" value="${h(n.nazwa)}"></td>
      <td><select data-k="tryb">${Object.entries(TRYBY).map(([v, t]) => `<option value="${v}" ${n.tryb === v ? "selected" : ""}>${t}</option>`).join("")}</select></td>
      <td><input type="number" step="0.01" min="0" data-k="pensum" value="${n.pensum}"></td>
      <td><input type="number" step="0.01" min="0" data-k="maks" value="${n.maks}"></td>
      <td class="dni">${[1, 2, 3, 4, 5].map((d) => `<label><input type="checkbox" data-k="dzien" data-d="${d}" ${n.dniPracy.includes(d) ? "checked" : ""}>${DNI[d]}</label>`).join("")}</td>
      <td class="dzienne">${n.tryb === "tematy" ? "—" : [1, 2, 3, 4, 5].map((d) => `<input type="number" step="0.01" min="0" title="${DNI[d]}" data-k="dzienne" data-d="${d}" value="${n.dzienne?.[d] ?? 0}">`).join("")}</td>
      <td><input type="date" data-k="od" value="${n.od ?? ""}"></td>
      <td><input type="date" data-k="do" value="${n.do ?? ""}"></td>
      <td><input type="text" data-k="uwagi" value="${h(n.uwagi ?? "")}"></td>
      <td><button type="button" data-usun="${h(k)}" title="Usuń z rozliczenia">✕</button></td></tr>`,
      )
      .join("")}</tbody></table></div>
    <div class="pasek" style="margin-top:12px"><label>Dodaj osobę <input type="text" id="nowaOsoba" placeholder="Nazwisko Imię"></label><button type="button" data-akcja="dodajOsobe">Dodaj</button></div>
    <p class="uwagaMala">Maks. = przydzielone godziny ponadwymiarowe w tygodniu (z arkusza organizacyjnego). Przy wicedyrektorach dni pracy to dni z lekcjami — pensum po zniżce dzieli się na te dni. Prywatny dzień wolny nie obniża pensum (art. 35 ust. 3f KN w brzmieniu od 1.01.2026).</p>`;
}

function widokKalendarz() {
  const daty = Object.keys(stan.kalendarz).sort();
  return `<div class="tabela"><table class="konf"><thead><tr><th>Data</th><th>Dzień</th><th>Opis</th><th>Wolne tylko dla części klas</th><th></th></tr></thead><tbody>${daty
    .map((d) => {
      const k = stan.kalendarz[d];
      return `<tr data-kal="${d}"><td>${d}</td><td>${DNI[dzienTygodnia(d)] ?? ""}</td><td><input type="text" data-kk="opis" value="${h(k.opis)}"></td><td><input type="checkbox" data-kk="czesciowy" ${k.czesciowy ? "checked" : ""}></td><td><button type="button" data-usunkal="${d}">✕</button></td></tr>`;
    })
    .join("")}</tbody></table></div>
    <div class="pasek" style="margin-top:12px"><label>Data <input type="date" id="kalData"></label><label>Opis <input type="text" id="kalOpis" placeholder="np. dzień dyrektorski"></label><button type="button" data-akcja="dodajKal">Dodaj dzień wolny</button></div>
    <p class="uwagaMala">Dzień wolny dla całej szkoły odlicza się wszystkim automatycznie (pensum −1/5). Dzień wolny tylko dla części klas (egzaminy, praktyki) trafia do wyjaśnienia: zdecydujesz osobno dla każdego nauczyciela.</p>`;
}

const RODZAJE_ZRODEL = { tematy: "tematy", zestawienie: "zestawienie zmian", zastepstwa: "informacje o zastępstwach", przeniesienia: "informacje o przeniesieniach" };

function widokZrodla() {
  return `<h3>Wczytane pliki</h3>${
    stan.zrodla.length
      ? `<div class="tabela"><table class="konf"><thead><tr><th>Rodzaj</th><th>Plik</th><th>Zakres</th><th>Wczytano</th></tr></thead><tbody>${stan.zrodla
          .slice()
          .reverse()
          .map((z) => `<tr><td>${h(RODZAJE_ZRODEL[z.rodzaj] ?? z.rodzaj)}</td><td>${h(z.plik)}</td><td>${z.od ? `${z.od} – ${z.do}` : ""}</td><td>${h(z.wczytano.slice(0, 16).replace("T", " "))}</td></tr>`)
          .join("")}</tbody></table></div>`
      : `<p class="uwagaMala">Brak.</p>`
  }
    <h3>Plany lekcji</h3>${stan.plany.map((p) => `<p>od <b>${p.od}</b> — ${h(p.zrodlo)} (${Object.keys(p.plan).length} nauczycieli)</p>`).join("") || `<p class="uwagaMala">Brak.</p>`}
    <button type="button" data-akcja="planSerwis">Pobierz aktualny plan z serwisu nauczyciela</button>
    <p class="uwagaMala">Plik rozliczenia (.json) zawiera dane osobowe i powody nieobecności. Trzymaj go w folderze OneDrive kadry kierowniczej; nie wysyłaj i nie wrzucaj do repozytorium. Ponowne wgranie eksportu za ten sam okres zastępuje poprzednie dane z tego okresu.</p>`;
}

// ——— okno dnia ———
function oknoDnia(osoba, data) {
  const n = stan.nauczyciele[osoba];
  const a = analizaDnia(stan, osoba, data);
  const d = a.decyzja ?? {};
  const zPlanuGodz = new Set([...a.tematy, ...(a.plan ?? [])]).size;
  const tryb = d.odliczenie ? "odl" : d.zPlanu ? "plan" : d.godziny != null ? "reczne" : "auto";
  const lista = (xs) => (xs?.length ? xs.join(", ") : "—");
  const dlg = $("#dialog");
  dlg.innerHTML = `<form method="dialog" id="formDnia">
    <h2>${h(n.nazwa)} — ${DNI[dzienTygodnia(data)]} ${data}</h2>
    <dl>
      ${n.tryb === "tematy" ? `<dt>Plan lekcji</dt><dd>${a.plan ? lista(a.plan) : "brak planu na ten dzień"}</dd><dt>Tematy (lekcje)</dt><dd>${lista(a.tematy)}</dd>` : `<dt>Tryb</dt><dd>${h(TRYBY[n.tryb])}: ${liczba(n.dzienne?.[dzienTygodnia(data)] ?? 0)} h</dd>`}
      ${a.zastepstwa.length ? `<dt>Zastępstwa</dt><dd>${a.zastepstwa.map((z) => `lekcja ${z.lekcja}: ${h(z.forma ?? "forma nieznana")}${z.zaKogo ? ` (za ${h(z.zaKogo)}${z.oddzial ? `, ${h(z.oddzial)}` : ""})` : ""}`).join("<br>")}</dd>` : ""}
      ${a.bezTematu.length ? `<dt>Zastępstwa bez tematu</dt><dd>${a.bezTematu.map((z) => `lekcja ${z.lekcja}: ${h(z.forma)}`).join(", ")}</dd>` : ""}
      ${a.ind ? `<dt>IND</dt><dd>${a.ind}</dd>` : ""}
      ${a.nieobecnosc ? `<dt>Nieobecność</dt><dd>${h(a.nieobecnosc.powody.join(", "))}${a.nieobecnosc.lekcje.length ? ` — lekcje ${a.nieobecnosc.lekcje.join(", ")}` : ""}</dd>` : ""}
      ${a.kalendarz ? `<dt>Kalendarz</dt><dd>${h(a.kalendarz.opis)}</dd>` : ""}
      ${a.uwagi.length ? `<dt>Do sprawdzenia</dt><dd>${a.uwagi.map(h).join("<br>")}</dd>` : ""}
    </dl>
    ${a.podpowiedz ? `<div class="podpowiedz"><span>Podpowiedź: <b>${h(a.podpowiedz.odliczenie ? `odlicz dzień — ${POWODY_ODLICZENIA[a.podpowiedz.odliczenie]}` : "licz lekcje z planu")}</b><br><small>${h(a.podpowiedz.uwaga)}</small></span><button type="button" id="zastosujPodp">Zastosuj</button></div>` : ""}
    <fieldset><legend>Godziny tego dnia</legend>
      <label><input type="radio" name="tryb" value="auto" ${tryb === "auto" ? "checked" : ""}> automatycznie: <b>${liczba(n.tryb === "tematy" ? a.godzinyAuto : (n.dzienne?.[dzienTygodnia(data)] ?? 0))}</b> h${n.tryb === "tematy" ? " (tematy + „godzina do zliczenia”)" : ""}</label>
      <label><input type="radio" name="tryb" value="odl" ${tryb === "odl" ? "checked" : ""}> odlicz dzień (pensum −1/${n.dniPracy.length === 4 ? 4 : 5}, godziny 0):
        <select name="odliczenie">${Object.entries(POWODY_ODLICZENIA).filter(([k]) => k !== "innyMiesiac").map(([k, t]) => `<option value="${k}" ${(d.odliczenie ?? a.podpowiedz?.odliczenie ?? "nieobecnosc") === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${n.tryb === "tematy" ? `<label><input type="radio" name="tryb" value="plan" ${tryb === "plan" ? "checked" : ""}> licz odwołane lekcje z planu (przyczyny po stronie szkoły, art. 35 ust. 3e): <b>${zPlanuGodz}</b> h</label>` : ""}
      <label><input type="radio" name="tryb" value="reczne" ${tryb === "reczne" ? "checked" : ""}> wpisz godziny: <input type="number" name="godziny" step="0.5" min="0" value="${d.godziny ?? a.godziny}"></label>
    </fieldset>
    <fieldset><legend>Poza pensum (puste = automatycznie)</legend>
      <label>IND <input type="number" name="ind" step="1" min="0" value="${d.ind ?? ""}" placeholder="${a.ind}"> KKZ <input type="number" name="kkz" step="1" min="0" value="${d.kkz ?? ""}" placeholder="0"> doraźne <input type="number" name="dorazne" step="1" min="0" value="${d.dorazne ?? ""}" placeholder="${a.dorazne}"></label>
    </fieldset>
    <label>Uwaga / uzasadnienie <input type="text" name="uwaga" style="width:100%" value="${h(d.uwaga ?? "")}" placeholder="np. zmiana w planie, decyzja dyrektora, wycieczka 2TFA"></label>
    <div class="przyciski">
      ${a.decyzja ? `<button type="button" class="lewo" id="usunDec">Usuń decyzję</button>` : ""}
      <button value="anuluj">Anuluj</button>
      <button value="ok" class="primary">Zapisz decyzję</button>
    </div></form>`;
  const f = $("#formDnia");
  $("#zastosujPodp")?.addEventListener("click", () => {
    ustawDecyzje(stan, osoba, data, a.podpowiedz);
    dlg.close();
    zmieniono();
  });
  $("#usunDec")?.addEventListener("click", () => {
    ustawDecyzje(stan, osoba, data, null);
    dlg.close();
    zmieniono();
  });
  f.addEventListener("submit", (e) => {
    if (e.submitter?.value !== "ok") return;
    const v = Object.fromEntries(new FormData(f));
    const dec = {};
    if (v.tryb === "odl") dec.odliczenie = v.odliczenie;
    if (v.tryb === "plan") dec.zPlanu = true;
    if (v.tryb === "reczne") dec.godziny = Number(v.godziny);
    for (const k of ["ind", "kkz", "dorazne"]) if (v[k] !== "") dec[k] = Number(v[k]);
    if (v.uwaga.trim()) dec.uwaga = v.uwaga.trim();
    ustawDecyzje(stan, osoba, data, Object.keys(dec).length ? dec : null);
    zmieniono();
  });
  dlg.showModal();
}

function oknoDniaWszystkich(data) {
  const dlg = $("#dialog");
  const ile = Object.keys(stan.nauczyciele).filter((o) => stan.decyzje[o]?.[data]).length;
  dlg.innerHTML = `<form method="dialog" id="formAll">
    <h2>${DNI[dzienTygodnia(data)]} ${data} — wszyscy nauczyciele</h2>
    <p class="uwagaMala">Decyzja trafi do każdego nauczyciela, który w tym dniu nie ma jeszcze własnej decyzji${ile ? ` (już ma ją ${ile})` : ""}.</p>
    <fieldset><legend>Co się działo</legend>
      <label><input type="radio" name="co" value="plan" checked> lekcje odwołane z przyczyn szkoły (święto szkoły, apel, egzamin) — liczyć z planu (art. 35 ust. 3e)</label>
      <label><input type="radio" name="co" value="wolne"> dzień wolny od zajęć dla wszystkich — dodaj do kalendarza (pensum −1/5)</label>
      <label><input type="radio" name="co" value="usun"> usuń decyzje wszystkich z tego dnia</label>
    </fieldset>
    <label>Opis <input type="text" name="opis" style="width:100%" placeholder="np. Święto Szkoły — lekcje po 13:30 odwołane"></label>
    <div class="przyciski"><button value="anuluj">Anuluj</button><button value="ok" class="primary">Zastosuj</button></div></form>`;
  $("#formAll").addEventListener("submit", (e) => {
    if (e.submitter?.value !== "ok") return;
    const v = Object.fromEntries(new FormData(e.target));
    if (v.co === "wolne") stan.kalendarz[data] = { opis: v.opis || "dzień wolny od zajęć" };
    for (const o of Object.keys(stan.nauczyciele)) {
      if (v.co === "usun") ustawDecyzje(stan, o, data, null);
      else if (v.co === "plan" && !stan.decyzje[o]?.[data] && stan.nauczyciele[o].tryb === "tematy") ustawDecyzje(stan, o, data, { zPlanu: true, ...(v.opis && { uwaga: v.opis }) });
    }
    zmieniono();
  });
  dlg.showModal();
}

function zastosujPodpowiedzi() {
  const pn = ui.tydzien;
  const lista = [];
  for (const o of Object.keys(stan.nauczyciele))
    for (let i = 0; i < 5; i++) {
      const data = dodajDni(pn, i);
      if (!data.startsWith(ui.miesiac)) continue;
      const a = analizaDnia(stan, o, data);
      if (a.podpowiedz) lista.push([o, data, a.podpowiedz]);
    }
  if (!lista.length) return alert("W tym tygodniu nie ma podpowiedzi.");
  const opis = lista.slice(0, 15).map(([o, d, p]) => `${stan.nauczyciele[o].nazwa} ${dm(d)}: ${p.odliczenie ? "odliczenie" : "z planu"} (${p.uwaga})`).join("\n");
  if (!confirm(`Zastosować ${lista.length} podpowiedzi?\n\n${opis}${lista.length > 15 ? "\n…" : ""}`)) return;
  for (const [o, d, p] of lista) ustawDecyzje(stan, o, d, p);
  zmieniono();
}

// ——— zdarzenia ———
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-akcja],[data-widok],[data-osoba],[data-dzienall],[data-usun],[data-usunkal],[data-dowyj],[data-raport]");
  if (!t) return;
  if (t.dataset.raport) {
    ui.widok = "raport";
    ui.raport = t.dataset.raport;
    return render();
  }
  if (t.dataset.widok) {
    ui.widok = t.dataset.widok;
    return render();
  }
  if (t.dataset.osoba) return oknoDnia(t.dataset.osoba, t.dataset.data);
  if (t.dataset.dzienall) return oknoDniaWszystkich(t.dataset.dzienall);
  if (t.dataset.dowyj) {
    ui.widok = "tydzien";
    ui.szukaj = stan.nauczyciele[t.dataset.dowyj].nazwa;
    ui.tylkoWyj = true;
    const w = rozliczWszystkich(stan, ui.miesiac).find((x) => x.osoba === t.dataset.dowyj);
    ui.tydzien = w.tygodnie.find((tt) => tt.dni.some((d) => d.data.startsWith(ui.miesiac) && w.dni[d.data].doWyjasnienia))?.poniedzialek ?? ui.tydzien;
    return render();
  }
  if (t.dataset.usun) {
    if (confirm(`Usunąć ${stan.nauczyciele[t.dataset.usun].nazwa} z rozliczenia? Decyzje tej osoby zostaną.`)) {
      delete stan.nauczyciele[t.dataset.usun];
      zmieniono();
    }
    return;
  }
  if (t.dataset.usunkal) {
    delete stan.kalendarz[t.dataset.usunkal];
    return zmieniono();
  }
  switch (t.dataset.akcja) {
    case "wybierz":
      return $("#wyborPlikow").click();
    case "zapisz":
      return zapisz();
    case "otworz":
      return otworz();
    case "nowy":
      if (zmiany && !confirm("Są niezapisane zmiany. Zacząć nowe rozliczenie?")) return;
      stan = nowyStan();
      uchwyt = null;
      nazwaPliku = null;
      zmiany = false;
      return render();
    case "zamknijKom":
      ui.komunikaty = [];
      return render();
    case "planSerwis":
      return pobierzPlanZSerwisu();
    case "podpowiedzi":
      return zastosujPodpowiedzi();
    case "drukuj":
      return window.print();
    case "xlsx": {
      const bajty = await eksportMiesiaca(stan, ui.miesiac, rozliczWszystkich(stan, ui.miesiac));
      return pobierz(new Blob([bajty], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `rozliczenie-godzin-${ui.miesiac}.xlsx`);
    }
    case "dodajBrakujacych": {
      const klucze = Object.keys(stan.nauczyciele);
      for (const k of Object.keys(stan.realizacja))
        if (!znajdzOsobe(k, klucze)) {
          const nazwa = k.replace(/(^|[\s-])\p{L}/gu, (m) => m.toLocaleUpperCase("pl"));
          stan.nauczyciele[k] = { nazwa, tryb: "tematy", pensum: 18, dniPracy: [1, 2, 3, 4, 5], maks: 0, uwagi: "dodano z tematów — uzupełnij pensum i limit" };
        }
      return zmieniono();
    }
    case "dodajOsobe": {
      const nazwa = $("#nowaOsoba").value.trim();
      if (!nazwa) return;
      stan.nauczyciele[kluczOsoby(nazwa)] = { nazwa, tryb: "tematy", pensum: 18, dniPracy: [1, 2, 3, 4, 5], maks: 0 };
      return zmieniono();
    }
    case "dodajKal": {
      const d = $("#kalData").value;
      if (!d) return;
      stan.kalendarz[d] = { opis: $("#kalOpis").value.trim() || "dzień wolny od zajęć" };
      return zmieniono();
    }
  }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.pole) {
    ui[t.dataset.pole] = t.type === "checkbox" ? t.checked : t.value;
    if (t.dataset.pole === "miesiac") ui.tydzien = null;
    return render();
  }
  const wiersz = t.closest("tr[data-n]");
  if (wiersz && t.dataset.k) {
    const n = stan.nauczyciele[wiersz.dataset.n];
    const k = t.dataset.k;
    if (k === "dzien") n.dniPracy = [...wiersz.querySelectorAll("[data-k=dzien]")].filter((x) => x.checked).map((x) => Number(x.dataset.d));
    else if (k === "dzienne") (n.dzienne ??= {})[t.dataset.d] = Number(t.value);
    else if (["pensum", "maks"].includes(k)) n[k] = Number(t.value);
    else if (["od", "do"].includes(k)) t.value ? (n[k] = t.value) : delete n[k];
    else n[k] = t.value;
    if (!n.dniPracy.length) n.dniPracy = [1, 2, 3, 4, 5];
    return zmieniono();
  }
  const kal = t.closest("tr[data-kal]");
  if (kal && t.dataset.kk) {
    const k = stan.kalendarz[kal.dataset.kal];
    if (t.dataset.kk === "czesciowy") t.checked ? (k.czesciowy = true) : delete k.czesciowy;
    else k.opis = t.value;
    return zmieniono();
  }
  if (t.id === "wyborPlikow" || t.id === "wyborStanu") {
    wczytajPliki([...t.files]);
    t.value = "";
  }
});

document.addEventListener("input", (e) => {
  if (e.target.dataset.pole === "szukaj") {
    ui.szukaj = e.target.value;
    const poz = e.target.selectionStart;
    render();
    const pole = $("[data-pole=szukaj]");
    pole.focus();
    pole.setSelectionRange(poz, poz);
  }
});

for (const typ of ["dragenter", "dragover"])
  document.addEventListener(typ, (e) => {
    e.preventDefault();
    $("#drop")?.classList.add("nad");
  });
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) $("#drop")?.classList.remove("nad");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  $("#drop")?.classList.remove("nad");
  wczytajPliki([...e.dataTransfer.files]);
});
window.addEventListener("beforeunload", (e) => {
  if (zmiany) e.preventDefault();
});

render();

// Zaświadczenia o frekwencji. Wszystko dzieje się w przeglądarce: eksport
// z dziennika jest czytany lokalnie i trzymany tylko w pamięci strony.
// W localStorage zostaje wyłącznie przypisanie rodzajów wpisów — żadnych
// danych uczniów.
import { readWorkbook } from "../src/xlsx.mjs";
import { dekoduj, czytajCsv, czytajHtml } from "../src/tabele.mjs";
import LOGO from "./zsz5-logo.png"; // build.mjs wbudowuje jako data: URL
import { RODZAJE, ROLE, rozpoznajTabele, ukladTabeli, czytajWpisy, rozpoznajMacierz, czytajMacierz, parametryZestawienia, domyslneRodzaje, polaczWpisy, listaUczniow, zakresDat, frekwencjaUcznia, kluczUcznia } from "../src/frekwencja.mjs";

const $ = (s) => document.querySelector(s);
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const MIESIACE = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const MIESIACA = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
const okresyTekst = (okresy) => okresy.map((o) => `${dmr(o.od)}–${dmr(o.do)}`).join(", ");
const slownie = (iso) => `${Number(iso.slice(8, 10))} ${MIESIACA[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`; // jak w szablonie: „21 października 2026”
const dmr = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const pr = (x) => (x == null ? "—" : `${x.toFixed(2).replace(".", ",")}%`);
const liczba = (x) => String(Math.round(x * 100) / 100).replace(".", ",");
const dodajDzien = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dzis = () => new Date().toLocaleDateString("sv-SE");
const ostatniDzien = (m) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate()).padStart(2, "0")}`;

function pamiec(klucz, wartosc) {
  try {
    if (wartosc === undefined) return JSON.parse(localStorage.getItem(klucz) ?? "null");
    localStorage.setItem(klucz, JSON.stringify(wartosc));
  } catch {
    return null;
  }
}

const pliki = []; // [{nazwa, arkusze, arkusz, tabela, wpisy}]
let wpisy = [];
let rodzaje = {}; // etykieta → klucz RODZAJE
const wybraneRodzaje = pamiec("frekwencja.rodzaje") ?? {}; // to, co użytkownik ustawił ręcznie
const ustawienia = { numer: "", cel: "", data: dzis(), przedmioty: false };
const ui = { klucz: null, od: "", do: "", szukaj: "", komunikaty: [] };

function komunikat(tekst, rodzaj = "") {
  ui.komunikaty.unshift({ tekst, rodzaj });
  ui.komunikaty = ui.komunikaty.slice(0, 4);
}

// ——— pliki ———
async function arkuszeZPliku(f) {
  const bajty = new Uint8Array(await f.arrayBuffer());
  if (bajty[0] === 0x50 && bajty[1] === 0x4b) return (await readWorkbook(bajty, DOMParser)).sheets;
  if (bajty[0] === 0xd0 && bajty[1] === 0xcf) throw Error("to stary format Excela (.xls). Otwórz plik w Excelu i zapisz jako .xlsx albo CSV.");
  const tekst = dekoduj(bajty);
  if (/<table/i.test(tekst)) return czytajHtml(tekst, DOMParser);
  return { CSV: czytajCsv(tekst) };
}

const rozpoznaj = (wiersze) => rozpoznajMacierz(wiersze) ?? rozpoznajTabele(wiersze);
const pustaTabela = () => ({ wiersz: 0, kolumny: {}, sumy: [], uklad: null });

function przelicz() {
  for (const p of pliki) {
    const wiersze = p.arkusze[p.arkusz];
    const surowe = p.tabela.uklad === "macierz" ? czytajMacierz(wiersze, p.tabela) : p.tabela.uklad ? czytajWpisy(wiersze, p.tabela) : [];
    // Wpis bez daty dostaje okres eksportu z „Opisu parametrów”, jeśli plik go podaje.
    p.wpisy = surowe.map((w) => ({ ...w, zrodlo: p.nazwa, ...(!w.data && p.okres && { okres: p.okres }) }));
  }
  wpisy = polaczWpisy(pliki.map((p) => p.wpisy));
  const etykiety = [...new Set(wpisy.map((w) => w.etykieta))];
  const sumy = pliki.some((p) => p.tabela.uklad === "sumy");
  rodzaje = domyslneRodzaje(etykiety, sumy ? "sumy" : "wpisy", pliki.flatMap((p) => p.tabela.pozaPodstawa ?? []));
  for (const e of etykiety) if (wybraneRodzaje[e]) rodzaje[e] = wybraneRodzaje[e];
  if (ui.klucz && !wpisy.some((w) => kluczUcznia(w) === ui.klucz)) ui.klucz = null;
}

async function wczytajPliki(lista) {
  for (const f of lista) {
    try {
      const arkusze = await arkuszeZPliku(f);
      let arkusz = null;
      let tabela = null;
      for (const [nazwa, wiersze] of Object.entries(arkusze)) {
        tabela = rozpoznaj(wiersze);
        if (tabela) {
          arkusz = nazwa;
          break;
        }
      }
      const { okres, dziennik } = parametryZestawienia(arkusze);
      const p = { nazwa: f.name, arkusze, arkusz: arkusz ?? Object.keys(arkusze)[0], tabela: tabela ?? pustaTabela(), okres, wpisy: [] };
      const i = pliki.findIndex((x) => x.nazwa === f.name);
      if (i >= 0) pliki[i] = p;
      else pliki.push(p);
      przelicz();
      if (!tabela) komunikat(`${f.name}: nie rozpoznano kolumn. Wskaż je niżej w „Kolumny w plikach”.`, "uwaga");
      else if (tabela.uklad === "macierz")
        komunikat(`${f.name}: zestawienie frekwencji VULCAN${dziennik ? ` — ${dziennik}` : ""}, ${okres ? `okres ${dmr(okres.od)}–${dmr(okres.do)}` : "bez okresu w opisie parametrów"}, ${listaUczniow(p.wpisy).length} uczniów, ${tabela.bloki.filter((b) => !b.razem).length} przedmiotów.`);
      else {
        const z = zakresDat(p.wpisy);
        komunikat(`${f.name}: ${p.wpisy.length} ${tabela.uklad === "wpisy" ? "wpisów" : "pozycji z sumami"}, ${listaUczniow(p.wpisy).length} uczniów${z ? `, ${dmr(z.od)}–${dmr(z.do)}` : ", bez dat"}.`);
      }
    } catch (e) {
      komunikat(`${f.name}: ${e.message}`, "blad");
    }
  }
  Object.assign(ui, zakresDat(wpisy) ?? { od: "", do: "" });
  render();
}

// ——— widok ———
function render() {
  const otworzMape = Object.values(rodzaje).some((r) => !r);
  const otworzKolumny = pliki.some((p) => !p.tabela.uklad);
  $("#app").innerHTML = `
    <div class="drop" id="drop">
      <p><b>Wgraj eksport frekwencji z dziennika</b> (przeciągnij tutaj albo wybierz): <i>ZestawienieFrekwencjeNaLekcjachPrzedmiotow</i> z VULCAN. Ma ono same sumy za „Badany okres”, więc okres zaświadczenia składa się z wgranych eksportów i ich różnic: np. eksport 01.09–21.10 i eksport za wrzesień dają też 01.10–21.10. Najwygodniej: eksporty od 1 września do końca każdego miesiąca albo eksporty miesięczne. Działa też XLSX, CSV albo HTML z kolumnami uczeń, data i wpis frekwencji (jeden wiersz = jedna lekcja). Kilka plików (np. po jednym na oddział) łączy się; ten sam plik wgrany drugi raz zastępuje poprzedni.</p>
      <button type="button" data-akcja="wybierz">Wybierz pliki…</button>
      ${pliki.length ? `<button type="button" data-akcja="wyczysc">Usuń wczytane dane</button>` : ""}
    </div>
    ${ui.komunikaty.length ? `<ul class="komunikaty">${ui.komunikaty.map((k) => `<li class="${k.rodzaj}">${h(k.tekst)}</li>`).join("")}</ul>` : ""}
    ${pliki.length ? panelKolumn(otworzKolumny) : ""}
    ${Object.keys(rodzaje).length ? panelRodzajow(otworzMape) : ""}
    ${wpisy.length ? `<div class="uklad">
      <section class="panel"><h2>Uczeń</h2>
        <input type="search" id="szukaj" placeholder="szukaj: nazwisko albo klasa" value="${h(ui.szukaj)}" style="width:100%">
        <select id="uczniowie" size="14"></select>
      </section>
      <section class="panel"><h2>Okres</h2>
        <div class="pasek">
          <label>od <input type="date" id="od" value="${ui.od}"></label>
          <label>do <input type="date" id="do" value="${ui.do}"></label>
        </div>
        <div class="pasek" style="margin-top:8px">${presety()}</div>
        <div id="wynik"></div>
      </section>
    </div>
    <section class="panel"><h2>Zaświadczenie</h2>
      <div class="formularz">
        <label>Data wystawienia<input type="date" data-u="data" value="${h(ustawienia.data)}"></label>
        <label>Numer (opcjonalnie)<input type="text" data-u="numer" value="${h(ustawienia.numer)}" placeholder="np. 12/2026"></label>
        <label>Cel wydania (opcjonalnie)<input type="text" data-u="cel" value="${h(ustawienia.cel)}" placeholder="np. przedłożenia w MOPS"></label>
        <label class="wiersz"><input type="checkbox" data-u="przedmioty" ${ustawienia.przedmioty ? "checked" : ""}> frekwencja z podziałem na przedmioty</label>
      </div>
      <div class="pasek" style="margin:12px 0"><button type="button" class="primary" data-akcja="drukuj">Drukuj / zapisz jako PDF</button><span class="uwagaMala" style="margin:0">W oknie drukowania wybierz „Zapisz jako PDF”, żeby zachować plik.</span></div>
      <div id="druk"></div>
    </section>` : ""}`;
  renderListy();
  renderWyniku();
}

function presety() {
  const z = zakresDat(wpisy);
  if (!z) return `<span class="uwagaMala">Plik nie zawiera dat — wynik obejmuje okres, za który zrobiono eksport.</span>`;
  const eksporty = [...new Set(wpisy.filter((w) => w.okres).map((w) => `${w.okres.od}|${w.okres.do}`))].map((k) => k.split("|"));
  // różnice eksportów o wspólnym początku albo końcu (jak w frekwencjaUcznia)
  const roznice = eksporty.flatMap(([aOd, aDo]) =>
    eksporty.flatMap(([bOd, bDo]) => {
      if (aOd > bOd || bDo > aDo || (aOd === bOd && aDo === bDo)) return [];
      if (aOd === bOd) return [[dodajDzien(bDo, 1), aDo]];
      return aDo === bDo ? [[aOd, dodajDzien(bOd, -1)]] : [];
    }),
  );
  const okresy = [...new Set([...eksporty, ...roznice].map((o) => o.join("|")))].sort().map((k) => k.split("|"));
  const miesiace = [...new Set(wpisy.map((w) => w.data?.slice(0, 7)).filter(Boolean))].sort();
  return `<button type="button" class="maly" data-od="${z.od}" data-do="${z.do}">wszystkie dane</button>${okresy
    .map(([od, d]) => `<button type="button" class="maly" data-od="${od}" data-do="${d}">${dmr(od)}–${dmr(d)}</button>`)
    .join("")}${miesiace
    .map((m) => `<button type="button" class="maly" data-od="${m}-01" data-do="${ostatniDzien(m)}">${MIESIACE[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</button>`)
    .join("")}`;
}

function panelKolumn(otwarty) {
  return `<details class="panel" ${otwarty ? "open" : ""}><summary>Kolumny w plikach</summary>${pliki
    .map((p, n) => {
      const naglowek = p.arkusze[p.arkusz]?.[p.tabela.wiersz] ?? [];
      const opcje = (wybrana) => `<option value="">—</option>${naglowek.map((c, i) => (String(c).trim() ? `<option value="${i}" ${wybrana === i ? "selected" : ""}>${h(c)}</option>` : "")).join("")}`;
      const macierz = p.tabela.uklad === "macierz";
      return `<div style="margin-bottom:12px"><b>${h(p.nazwa)}</b> — ${macierz ? `zestawienie VULCAN (uczeń × przedmiot × symbol wpisu)${p.okres ? `, okres ${dmr(p.okres.od)}–${dmr(p.okres.do)}` : ""}; przedmioty: ${p.tabela.bloki.map((b) => h(b.przedmiot)).join(", ")}` : p.tabela.uklad === "wpisy" ? "jeden wiersz = jedna lekcja" : p.tabela.uklad === "sumy" ? `sumy w kolumnach: ${p.tabela.sumy.map((i) => h(naglowek[i])).join(", ")}` : `<span class="mapa"><span class="brak">nie rozpoznano tabeli</span></span>`}
        <div class="pasek" style="margin-top:6px">
          ${Object.keys(p.arkusze).length > 1 ? `<label>Arkusz <select data-plik="${n}" data-pole="arkusz">${Object.keys(p.arkusze).map((a) => `<option ${a === p.arkusz ? "selected" : ""}>${h(a)}</option>`).join("")}</select></label>` : ""}
          ${macierz ? "" : `<label>Wiersz nagłówka <input type="number" min="1" style="width:64px" data-plik="${n}" data-pole="wiersz" value="${p.tabela.wiersz + 1}"></label>
          ${Object.entries(ROLE).map(([r, { nazwa }]) => `<label>${nazwa} <select data-plik="${n}" data-rola="${r}">${opcje(p.tabela.kolumny[r])}</select></label>`).join("")}`}
        </div></div>`;
    })
    .join("")}<p class="uwagaMala">Uczeń: jedna kolumna „nazwisko i imię” albo osobno nazwisko i imię. Bez kolumny „Wpis frekwencji” liczbowe kolumny tabeli są czytane jako sumy (np. „Obecności”, „Nieobecności usprawiedliwione”).</p></details>`;
}

function panelRodzajow(otwarty) {
  const ile = {};
  for (const w of wpisy) ile[w.etykieta] = (ile[w.etykieta] ?? 0) + w.n;
  const etykiety = Object.keys(rodzaje).sort((a, b) => ile[b] - ile[a]);
  const brak = etykiety.filter((e) => !rodzaje[e]).length;
  return `<details class="panel" ${otwarty ? "open" : ""}><summary>Jak liczone są wpisy (${etykiety.length})${brak ? ` — <span style="color:var(--warn)">${brak} bez przypisania</span>` : ""}</summary>
    <div class="mapa">${etykiety
      .map((e) => `<span ${rodzaje[e] ? "" : `class="brak"`}>${h(e)}</span><span class="uwagaMala" style="margin:0">${liczba(ile[e])}</span><select data-etykieta="${h(e)}"><option value="">— wybierz —</option>${Object.entries(RODZAJE).map(([k, t]) => `<option value="${k}" ${rodzaje[e] === k ? "selected" : ""}>${t}</option>`).join("")}</select>`)
      .join("")}</div>
    <p class="uwagaMala">Frekwencja = obecności ÷ (obecności + nieobecności) × 100. Spóźnienie i nieobecność z przyczyn szkolnych (konkurs, wycieczka) liczą się jak obecność, zwolnienie jak nieobecność usprawiedliwiona. „Nie liczyć” — wpis poza rachunkiem (np. zwolniony z zajęć wychowania fizycznego); w zestawieniu VULCAN tak są ustawione symbole, które VULCAN liczy poza frekwencją (bez kolumny %). Przy zestawieniu VULCAN wynik jest porównywany z jego „% frekwencji”.</p></details>`;
}

function renderListy() {
  const sel = $("#uczniowie");
  if (!sel) return;
  const q = ui.szukaj.toLocaleLowerCase("pl");
  const lista = listaUczniow(wpisy).filter((u) => !q || `${u.uczen} ${u.oddzial}`.toLocaleLowerCase("pl").includes(q));
  sel.innerHTML = lista.map((u) => `<option value="${h(u.klucz)}" ${u.klucz === ui.klucz ? "selected" : ""}>${h(u.uczen)}${u.oddzial ? ` — ${h(u.oddzial)}` : ""}</option>`).join("") || `<option disabled>brak uczniów</option>`;
}

function renderWyniku() {
  const cel = $("#wynik");
  if (!cel) return;
  const druk = $("#druk");
  const u = listaUczniow(wpisy).find((x) => x.klucz === ui.klucz);
  if (!u) {
    cel.innerHTML = `<p class="uwagaMala">Wybierz ucznia z listy.</p>`;
    druk.innerHTML = "";
    return;
  }
  const f = frekwencjaUcznia(wpisy, u.klucz, ui, rodzaje);
  const z = zakresDat(wpisy);
  const uwagi = [];
  if (ui.od && ui.do && ui.od > ui.do) uwagi.push(["blad", "Data „od” jest późniejsza niż „do”."]);
  const vulcan = wpisy.some((w) => w.okres);
  if (z && !vulcan && ui.do > z.do) uwagi.push(["uwaga", `Dane w plikach kończą się ${dmr(z.do)} — późniejsze dni nie są uwzględnione.`]);
  if (z && !vulcan && ui.od < z.od) uwagi.push(["uwaga", `Dane w plikach zaczynają się ${dmr(z.od)} — wcześniejsze dni nie są uwzględnione.`]);
  if (f.nieprzypisane) uwagi.push(["uwaga", `${liczba(f.nieprzypisane)} wpisów bez przypisanego rodzaju (${f.nieprzypisaneEtykiety.join(", ")}) nie jest liczonych — ustaw je w „Jak liczone są wpisy”.`]);
  if (f.bezDat) uwagi.push(["uwaga", "Część danych nie ma dat — liczą się za cały okres eksportu, bez względu na wybrane daty."]);
  for (const o of f.niespojne)
    uwagi.push(["uwaga", `Eksportów ${o.zrodlo} nie da się odjąć (okres ${okresyTekst([o])}): dane w dzienniku zmieniły się między eksportami. Zrób oba eksporty jeszcze raz, tego samego dnia.`]);
  if (f.luki.length)
    uwagi.push([
      f.zajecia ? "uwaga" : "blad",
      [
        "Zestawienie VULCAN ma tylko sumy za cały „Badany okres” — część okresu da się policzyć tylko z innego eksportu albo z różnicy dwóch eksportów o wspólnym początku lub końcu.",
        f.luki.length ? `Brak danych za: ${okresyTekst(f.luki)}.` : "",
        f.poza.length ? `Eksport ${okresyTekst(f.poza)} wychodzi poza wybrane daty, więc nie jest liczony.` : "",
        `Zaświadczenie obejmie ${f.okresy.length ? `tylko: ${okresyTekst(f.okresy)}` : "0 dni"}.`,
        ui.od && ui.do ? `Żeby zaświadczyć ${dmr(ui.od)}–${dmr(ui.do)}, wygeneruj w VULCAN „Zestawienie frekwencji na lekcjach przedmiotów” z badanym okresem ${dmr(ui.od)}–${dmr(ui.do)} (albo eksporty za brakujące miesiące) i wgraj je tutaj.` : "",
      ].filter(Boolean).join(" "),
    ]);
  if (f.procentVulcan != null && f.frekwencja !== f.procentVulcan) uwagi.push(["blad", `VULCAN podaje dla tego eksportu ${pr(f.procentVulcan)} frekwencji, a tu wychodzi ${pr(f.frekwencja)} — sprawdź „Jak liczone są wpisy”.`]);
  cel.innerHTML = `
    ${uwagi.length ? `<ul class="komunikaty" style="margin-top:12px">${uwagi.map(([k, t]) => `<li class="${k}">${h(t)}</li>`).join("")}</ul>` : ""}
    <div class="kafle">
      <div class="kafel glowny"><div class="l">Frekwencja</div><div class="v">${pr(f.frekwencja)}</div></div>
      <div class="kafel"><div class="l">Nieobecności nieusprawiedliwione</div><div class="v">${liczba(f.nieusprawiedliwiona)} h <small>${pr(f.procentNieusprawiedliwionych)}</small></div></div>
      <div class="kafel"><div class="l">Nieobecności usprawiedliwione</div><div class="v">${liczba(f.usprawiedliwiona)} h <small>${pr(f.procentUsprawiedliwionych)}</small></div></div>
      <div class="kafel"><div class="l">Zajęcia (obecności)</div><div class="v">${liczba(f.zajecia)} <small>(${liczba(f.obecny)})</small></div></div>
    </div>
    <p class="uwagaMala">${f.procentVulcan != null && f.frekwencja === f.procentVulcan ? `<b style="color:var(--ok)">✓ zgodne z „% frekwencji” w zestawieniu VULCAN.</b> ` : ""}${f.tylkoOkresy ? `Okres z eksportów: ${f.eksporty.map((o) => `${dmr(o.od)}–${dmr(o.do)} (${o.roznica ? `różnica: ${h(o.zrodlo)}` : h(o.zrodlo)})`).join(", ")}.` : f.dane ? `Wpisy ucznia w okresie: ${dmr(f.dane.od)}–${dmr(f.dane.do)}.` : ""} Procent nieobecności = godziny ÷ wszystkie zajęcia z wpisem frekwencji × 100.${f.pomin ? ` Poza rachunkiem („nie liczyć”): ${liczba(f.pomin)}.` : ""}</p>
    ${f.przedmioty.length ? `<details><summary>Z podziałem na przedmioty (${f.przedmioty.length})</summary>${tabelaPrzedmiotow(f)}</details>` : ""}`;
  druk.innerHTML = zaswiadczenie(u, f);
  dopasujNaglowek(druk);
}

/** Bez kroju Aptos (szablon) tekst nagłówka bywa szerszy niż kolumna — zmniejsza go, aż się zmieści. */
function dopasujNaglowek(kartka) {
  for (const el of kartka.querySelectorAll(".papier .nazwa, .papier .kol")) {
    let px = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && px > 6) el.style.fontSize = `${(px -= 0.25)}px`;
  }
}

function tabelaPrzedmiotow(f) {
  return `<table class="przedmioty"><thead><tr><th>Przedmiot</th><th>Zajęcia</th><th>Obecności</th><th>Uspraw.</th><th>Nieuspraw.</th><th>Frekwencja</th></tr></thead><tbody>${f.przedmioty
    .map((p) => `<tr><td>${h(p.przedmiot)}</td><td>${liczba(p.zajecia)}</td><td>${liczba(p.obecny)}</td><td>${liczba(p.usprawiedliwiona)}</td><td>${liczba(p.nieusprawiedliwiona)}</td><td>${pr(p.frekwencja)}</td></tr>`)
    .join("")}</tbody><tfoot><tr class="suma"><td>Razem</td><td>${liczba(f.zajecia)}</td><td>${liczba(f.obecny)}</td><td>${liczba(f.usprawiedliwiona)}</td><td>${liczba(f.nieusprawiedliwiona)}</td><td>${pr(f.frekwencja)}</td></tr></tfoot></table>`;
}

function zaswiadczenie(u, f) {
  const s = ustawienia;
  // Przy zestawieniach VULCAN okres to okresy wybranych eksportów, nie wpisane daty (mogą być szersze).
  const okres = f.bezDat
    ? "okres objęty eksportem z dziennika"
    : f.tylkoOkresy
      ? f.okresy.map((o) => `od ${dmr(o.od)} do ${dmr(o.do)}`).join(" oraz ")
      : `od ${dmr(ui.od)} do ${dmr(ui.do)}`;
  return `<div class="kartka">
    <div class="papier">
      <img class="logo" src="${LOGO}" alt="ZSZ5 we Wrocławiu">
      <div class="nazwa">Zespół Szkół Zawodowych nr 5</div>
      <div class="kol szkoly"><span>Technikum nr 5 im. Jana Kilińskiego</span><span>Branżowa Szkoła I stopnia nr 5 im. Jana Kilińskiego</span><span>Branżowa Szkoła II stopnia nr 5 im. Jana Kilińskiego</span></div>
      <div class="kol kontakt"><span>ul. Jana Wł. Dawida 5, 50-527 Wrocław</span><span>tel. 71 798 69 34, www.zsz5.edupage.org</span><span>sekretariat.zsz5@wroclawskaedukacja.pl</span></div>
      <div class="linia"></div>
    </div>
    <div class="tresc">
      <p class="miejsce">Wrocław, ${s.data ? slownie(s.data) : ""}</p>
      <h3>ZAŚWIADCZENIE O FREKWENCJI</h3>
      <p class="numer">${s.numer ? `nr ${h(s.numer)}` : "&nbsp;"}</p>
      <dl><dt>Nazwisko i imię</dt><dd>${h(u.uczen)}</dd>${u.oddzial ? `<dt>Oddział (klasa)</dt><dd>${h(u.oddzial)}</dd>` : ""}<dt>Okres</dt><dd>${okres}</dd></dl>
      <p>Zaświadcza się, że w podanym okresie frekwencja na zajęciach lekcyjnych ze wszystkich przedmiotów wyniosła <b>${pr(f.frekwencja)}</b>, a liczba godzin nieobecności nieusprawiedliwionych — <b>${liczba(f.nieusprawiedliwiona)}</b>, tj. <b>${pr(f.procentNieusprawiedliwionych)}</b> wszystkich zajęć.</p>
      <table><tbody>
        <tr><td>Liczba godzin zajęć</td><td>${liczba(f.zajecia)}</td><td></td></tr>
        <tr><td>Obecności (w tym spóźnienia)</td><td>${liczba(f.obecny)}</td><td>${pr(f.frekwencja)}</td></tr>
        <tr><td>Nieobecności usprawiedliwione</td><td>${liczba(f.usprawiedliwiona)}</td><td>${pr(f.procentUsprawiedliwionych)}</td></tr>
        <tr class="suma"><td>Nieobecności nieusprawiedliwione</td><td>${liczba(f.nieusprawiedliwiona)}</td><td>${pr(f.procentNieusprawiedliwionych)}</td></tr>
      </tbody></table>
      ${s.przedmioty && f.przedmioty.length ? tabelaPrzedmiotow(f) : ""}
      ${s.cel ? `<p>Zaświadczenie wydaje się w celu ${h(s.cel)}.</p>` : ""}
      <div class="stopka">Na podstawie wpisów w dzienniku elektronicznym.</div>
    </div>
  </div>`;
}

// ——— zdarzenia ———
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-akcja],[data-od]");
  if (!t) return;
  if (t.dataset.od) {
    ui.od = t.dataset.od;
    ui.do = t.dataset.do;
    $("#od").value = ui.od;
    $("#do").value = ui.do;
    return renderWyniku();
  }
  if (t.dataset.akcja === "wybierz") return $("#wyborPlikow").click();
  if (t.dataset.akcja === "drukuj") return window.print();
  if (t.dataset.akcja === "wyczysc") {
    pliki.length = 0;
    Object.assign(ui, { klucz: null, od: "", do: "", komunikaty: [] });
    przelicz();
    return render();
  }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "wyborPlikow") {
    wczytajPliki([...t.files]);
    t.value = "";
  } else if (t.id === "uczniowie") {
    ui.klucz = t.value;
    renderWyniku();
  } else if (t.id === "od" || t.id === "do") {
    ui[t.id] = t.value;
    renderWyniku();
  } else if (t.dataset.etykieta != null) {
    wybraneRodzaje[t.dataset.etykieta] = t.value || undefined;
    pamiec("frekwencja.rodzaje", wybraneRodzaje);
    rodzaje[t.dataset.etykieta] = t.value || null;
    render();
  } else if (t.dataset.plik != null) {
    const p = pliki[Number(t.dataset.plik)];
    if (t.dataset.pole === "arkusz") {
      p.arkusz = t.value;
      p.tabela = rozpoznaj(p.arkusze[p.arkusz]) ?? pustaTabela();
    } else {
      // ręczny wybór kolumn albo wiersza nagłówka
      const kolumny = { ...p.tabela.kolumny };
      let wiersz = p.tabela.wiersz;
      if (t.dataset.pole === "wiersz") wiersz = Math.max(0, Number(t.value) - 1);
      else if (t.value === "") delete kolumny[t.dataset.rola];
      else kolumny[t.dataset.rola] = Number(t.value);
      const uczen = kolumny.uczen != null || (kolumny.nazwisko != null && kolumny.imie != null);
      p.tabela = { wiersz, kolumny, sumy: [], uklad: null, ...(uczen && ukladTabeli(p.arkusze[p.arkusz], wiersz, kolumny)) };
    }
    przelicz();
    Object.assign(ui, zakresDat(wpisy) ?? { od: "", do: "" });
    render();
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "szukaj") {
    ui.szukaj = t.value;
    renderListy();
  } else if (t.dataset.u) {
    ustawienia[t.dataset.u] = t.type === "checkbox" ? t.checked : t.value;
    renderWyniku();
  }
});

// Strzałki w polu wyszukiwania przechodzą po liście, Enter wybiera pierwszego ucznia.
document.addEventListener("keydown", (e) => {
  if (e.target.id !== "szukaj" || !["Enter", "ArrowDown"].includes(e.key)) return;
  const sel = $("#uczniowie");
  if (!sel.options.length || sel.options[0].disabled) return;
  e.preventDefault();
  if (sel.selectedIndex < 0) sel.selectedIndex = 0;
  ui.klucz = sel.value;
  if (e.key === "ArrowDown") sel.focus();
  renderWyniku();
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

render();

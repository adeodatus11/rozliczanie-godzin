// Rozliczenie na podstawie stanu: analiza każdego dnia (plan, tematy,
// zastępstwa, nieobecności, decyzje) i miesiąc nauczyciela.
import { rozliczMiesiac, tygodnieMiesiaca, dodajDni, dzienTygodnia, r2 } from "./silnik.mjs";
import { planNaDzien } from "./stan.mjs";
import { znajdzOsobe } from "./wejscie.mjs";

/** Formy płatności zastępstw (VULCAN) i ich skutek dla rozliczenia. */
export const FORMY = {
  "Godzina do zliczenia": "doSumy", // zastępca miał wtedy własną lekcję, która odpadła — art. 42 ust. 2cb
  "Dodatkowo płatne": "dorazne", // doraźne zastępstwo, płatne osobno
  Bezpłatne: "nic", // złączenie grup, biblioteka
};

const POWODY_ODLICZ = /lekarsk|urlop|opiek|krwi|okoliczno|sił[ay] wyższ|szkoleni/i;
const POWODY_3E = /wycieczk|wyjazd służbowy|delegac|zawody|konkurs/i;

const opisZast = (z) => `lekcja ${z.lekcja}${z.zaKogo ? ` za ${z.zaKogo}` : ""}${z.oddzial ? `, ${z.oddzial}` : ""} (${z.forma ?? "bez formy płatności"})`;
const zbior = (...xs) => [...new Set(xs.flat())].sort((a, b) => a - b);

/** Dopasowanie kluczy osób między źródłami (inne zapisy nazwisk), z pamięcią na czas jednego przeliczenia. */
function dopasuj(pamiec, klucz, slownik) {
  if (!pamiec.has(slownik)) pamiec.set(slownik, new Map());
  const m = pamiec.get(slownik);
  if (!m.has(klucz)) m.set(klucz, znajdzOsobe(klucz, Object.keys(slownik)));
  return m.get(klucz);
}

export function analizaDnia(stan, osoba, data, pamiec = new Map()) {
  const n = stan.nauczyciele[osoba];
  const dt = dzienTygodnia(data);
  const kal = stan.kalendarz[data] ?? null;
  const decyzja = stan.decyzje[osoba]?.[data] ?? null;
  const planOsob = planNaDzien(stan, data);
  const kPlan = planOsob ? dopasuj(pamiec, osoba, planOsob) : null;
  const planBazowy = kPlan ? (planOsob[kPlan][dt] ?? []) : planOsob ? [] : null;
  const przen = stan.informacje.przeniesienia[dopasuj(pamiec, osoba, stan.informacje.przeniesienia)]?.[data] ?? null;
  // Plan dnia po przeniesieniach: lekcje przeniesione z tego dnia odpadają, przeniesione na ten dzień dochodzą.
  const plan = planBazowy && przen ? zbior(planBazowy.filter((p) => !przen.z.includes(p)), przen.na) : planBazowy;
  const r = stan.realizacja[dopasuj(pamiec, osoba, stan.realizacja)]?.[data] ?? null;
  const nieob = stan.zestawienie.nieobecnosci[dopasuj(pamiec, osoba, stan.zestawienie.nieobecnosci)]?.[data] ?? null;
  const zast = stan.zestawienie.zastepstwa[dopasuj(pamiec, osoba, stan.zestawienie.zastepstwa)]?.[data] ?? [];
  const brakDanych = n.tryb === "tematy" && !stan.zrodla.some((z) => z.rodzaj === "tematy" && z.od <= data && z.do >= data);
  const wczytano = (rodzaj) => stan.zrodla.some((z) => z.rodzaj === rodzaj && z.od <= data && z.do >= data);
  const zestawienieWczytane = wczytano("zestawienie") || wczytano("zastepstwa");
  const zastInfo = stan.informacje.zastepstwa[dopasuj(pamiec, osoba, stan.informacje.zastepstwa)]?.[data] ?? [];
  // Formy płatności: ze zbiorczego zestawienia, a za dni bez niego — z „Informacji o zastępstwach”.
  const zastDnia = wczytano("zestawienie") ? zast : zastInfo;

  // Zastępstwa z tematów („Zastępstwo = Tak”) i ich forma płatności z zestawienia zmian.
  const zastepstwa = (r?.zastepstwa ?? []).map((lekcja) => {
    const z = zastDnia.find((x) => x.lekcja === lekcja);
    return { lekcja, forma: z?.forma ?? null, zaKogo: z?.zaKogo ?? null, oddzial: z?.oddzial ?? null };
  });
  // Ta sama lekcja z innymi formami płatności w obu raportach VULCAN — do wyjaśnienia. Porównanie
  // zbiorów form dla lekcji (zastępca może w tej samej godzinie mieć dwie grupy z różnymi formami).
  const formyLekcji = (lista, lekcja) => lista.filter((x) => x.lekcja === lekcja).map((x) => x.forma).sort();
  const rozneFormy = zastDnia === zast && zastInfo.length
    ? zbior(zast.map((z) => z.lekcja), zastInfo.map((z) => z.lekcja))
        .map((lekcja) => ({ lekcja, zestawienie: formyLekcji(zast, lekcja), informacje: formyLekcji(zastInfo, lekcja) }))
        .filter((x) => x.zestawienie.join("|") !== x.informacje.join("|"))
    : [];
  const doSumy = zastepstwa.filter((z) => FORMY[z.forma] === "doSumy").map((z) => z.lekcja);
  const dorazneZast = zastepstwa.filter((z) => FORMY[z.forma] === "dorazne").length;
  const nieznane = zastepstwa.filter((z) => !z.forma);
  const obcaForma = zastepstwa.filter((z) => z.forma && !FORMY[z.forma]); // forma spoza FORMY nie jest liczona — trzeba zdecydować
  // Zastępstwa ze zmian, do których nie ma tematu. Bezpłatne (złączenie grup, biblioteka) nie zmieniają rozliczenia — tylko uwaga.
  const zastBezTematu = !wczytano("tematy") ? [] : zastDnia.filter((z) => !(r?.zastepstwa ?? []).includes(z.lekcja) && !(r?.lekcje ?? []).includes(z.lekcja));
  const bezTematu = zastBezTematu.filter((z) => FORMY[z.forma] !== "nic");
  const bezTematuBezplatne = zastBezTematu.filter((z) => FORMY[z.forma] === "nic");

  const tematy = r?.lekcje ?? [];
  const godzinyAuto = zbior(tematy, doSumy).length;
  let godziny;
  if (n.tryb !== "tematy") godziny = n.dzienne?.[dt] ?? 0;
  else godziny = godzinyAuto;
  if (decyzja?.zPlanu) godziny = zbior(tematy, doSumy, plan ?? []).length;
  if (decyzja?.godziny != null) godziny = decyzja.godziny;

  // Lekcje z planu bez tematu, poza tymi, na których nauczyciel był nieobecny, to lekcje odwołane (np. nieobecny
  // oddział). „Godzin do zliczenia” ma być tyle, ile odwołanych lekcji — nie więcej (art. 42 ust. 2cb).
  const sprawdzPlan = plan && n.tryb === "tematy" && !brakDanych && !(kal && !kal.czesciowy);
  const odwolane = sprawdzPlan ? plan.filter((p) => !tematy.includes(p) && !nieob?.lekcje.includes(p)) : [];
  const niepokryte = Math.max(0, odwolane.length - doSumy.length);
  const nadmiarDoZliczenia = sprawdzPlan ? Math.max(0, doSumy.length - odwolane.length) : 0;
  const brakujace = niepokryte ? odwolane : [];
  const brakujacePrzeniesione = brakujace.filter((p) => przen?.na.includes(p) && !planBazowy.includes(p));
  const brakujaceZPlanu = brakujace.filter((p) => !brakujacePrzeniesione.includes(p));
  const pokrycie = doSumy.length && niepokryte ? ` (odwołanych ${odwolane.length}, „godzin do zliczenia” ${doSumy.length} — brakuje ${niepokryte})` : "";
  const uwagi = [];
  if (nieob) uwagi.push(`nieobecność: ${nieob.powody.join(", ")}${nieob.lekcje.length ? ` (lekcje ${nieob.lekcje.join(",")})` : ""}`);
  if (brakujaceZPlanu.length) uwagi.push(`bez tematu lekcje z planu: ${brakujaceZPlanu.join(",")}${brakujacePrzeniesione.length ? "" : pokrycie}`);
  if (brakujacePrzeniesione.length) uwagi.push(`bez tematu lekcje przeniesione na ten dzień: ${brakujacePrzeniesione.join(",")}${pokrycie}`);
  if (nadmiarDoZliczenia) uwagi.push(`„godzin do zliczenia” ${doSumy.length} (lekcje ${doSumy.join(",")}), a odwołanych lekcji z planu ${odwolane.length}${odwolane.length ? ` (${odwolane.join(",")})` : ""} — ${nadmiarDoZliczenia} ponad odwołane: sprawdź formę płatności`);
  if (nieznane.length && zestawienieWczytane) uwagi.push(`zastępstwo bez formy płatności w zestawieniu: lekcja ${nieznane.map((z) => z.lekcja).join(",")}`);
  if (nieznane.length && !zestawienieWczytane) uwagi.push(`zastępstwo — forma płatności nieznana (wgraj zestawienie zmian): lekcja ${nieznane.map((z) => z.lekcja).join(",")}`);
  if (obcaForma.length) uwagi.push(`zastępstwo z nieznaną formą płatności: ${obcaForma.map((z) => `lekcja ${z.lekcja} „${z.forma}”`).join(", ")}`);
  if (bezTematu.length) uwagi.push(`zastępstwo bez tematu w dzienniku: ${bezTematu.map(opisZast).join("; ")}`);
  if (bezTematuBezplatne.length) uwagi.push(`zastępstwo bezpłatne bez tematu w dzienniku (nie zmienia rozliczenia): ${bezTematuBezplatne.map(opisZast).join("; ")}`);
  const formy = (xs) => (xs.length ? xs.map((f) => `„${f}”`).join(" + ") : "brak");
  if (rozneFormy.length) uwagi.push(`różne formy płatności w raportach VULCAN: ${rozneFormy.map((z) => `lekcja ${z.lekcja} — zestawienie ${formy(z.zestawienie)}, informacje ${formy(z.informacje)}`).join("; ")}`);
  if (przen && (przen.z.length || przen.na.length)) uwagi.push(`przeniesienia: ${[przen.z.length ? `z lekcji ${przen.z.join(",")}` : "", przen.na.length ? `na lekcje ${przen.na.join(",")}` : ""].filter(Boolean).join(", ")}`);
  if (kal?.czesciowy) uwagi.push(`kalendarz: ${kal.opis}`);

  // Przy uśrednieniu i stałym planie godziny liczą się same; decyzji wymaga tylko nieobecność, która może odliczyć dzień.
  const nieobIstotna = nieob && (n.tryb === "tematy" || POWODY_ODLICZ.test(nieob.powody.join(" ")));
  let podpowiedz = null;
  if (!decyzja) {
    if (nieob && n.tryb === "tematy" && POWODY_3E.test(nieob.powody.join(" "))) podpowiedz = { zPlanu: true, uwaga: `${nieob.powody.join(", ")} — lekcje z planu płatne (art. 35 ust. 3e)` };
    else if (nieob && POWODY_ODLICZ.test(nieob.powody.join(" ")) && (godzinyAuto === 0 || n.tryb !== "tematy")) podpowiedz = { odliczenie: "nieobecnosc", uwaga: nieob.powody.join(", ") };
    else if (kal?.czesciowy && godzinyAuto === 0) podpowiedz = { odliczenie: "bezZajec", uwaga: kal.opis };
  }
  const odliczonyKalendarzem = kal && !kal.czesciowy;
  const zatrudniony = (!n.od || data >= n.od) && (!n.do || data <= n.do);
  const doWyjasnienia = !decyzja && !odliczonyKalendarzem && zatrudniony && (Boolean(nieobIstotna) || brakujace.length > 0 || nadmiarDoZliczenia > 0 || (nieznane.length > 0 && zestawienieWczytane) || obcaForma.length > 0 || rozneFormy.length > 0 || bezTematu.length > 0 || Boolean(kal?.czesciowy));
  return {
    data,
    plan,
    tematy,
    ind: decyzja?.ind ?? r?.ind ?? 0,
    kkz: decyzja?.kkz ?? 0,
    dorazne: decyzja?.dorazne ?? dorazneZast,
    zastepstwa,
    bezTematu,
    nieobecnosc: nieob,
    szkoly: r?.szkoly ?? {},
    godzinyAuto,
    godziny: r2(godziny),
    decyzja,
    podpowiedz,
    uwagi,
    doWyjasnienia,
    kalendarz: kal,
    bezFormy: zestawienieWczytane ? 0 : nieznane.length,
    brakDanych,
  };
}

/** Miesiąc nauczyciela: tygodnie z silnika + IND, KKZ i doraźne zastępstwa poza pensum. */
export function rozliczNauczyciela(stan, osoba, miesiac, pamiec = new Map()) {
  const n = stan.nauczyciele[osoba];
  const dni = {};
  const decyzje = {};
  const kalendarz = {};
  for (const pn of tygodnieMiesiaca(miesiac))
    for (let i = 0; i < 5; i++) {
      const data = dodajDni(pn, i);
      const a = analizaDnia(stan, osoba, data, pamiec);
      dni[data] = a;
      if (a.kalendarz && !a.kalendarz.czesciowy) kalendarz[data] = "wolne";
      decyzje[data] = a.decyzja?.odliczenie ? { odliczenie: a.decyzja.odliczenie } : { godziny: a.godziny };
    }
  const m = rozliczMiesiac(n, { miesiac, kalendarz, decyzje });
  const wMiesiacu = Object.values(dni).filter((a) => a.data.startsWith(miesiac));
  // IND, KKZ i doraźne tylko z dni nieodliczonych (także poza okresem zatrudnienia).
  const odliczone = new Set(m.tygodnie.flatMap((t) => t.dni).filter((d) => d.odliczenie).map((d) => d.data));
  const liczone = wMiesiacu.filter((a) => !odliczone.has(a.data));
  const suma = (pole) => r2(liczone.reduce((s, a) => s + (a[pole] || 0), 0));
  const dodatkowe = { ind: suma("ind"), kkz: suma("kkz"), dorazne: suma("dorazne") };
  return {
    osoba,
    ...m,
    dni,
    ...dodatkowe,
    razem: r2(m.doWyplaty + dodatkowe.ind + dodatkowe.kkz + dodatkowe.dorazne),
    doWyjasnienia: wMiesiacu.filter((a) => a.doWyjasnienia).length,
  };
}

export function rozliczWszystkich(stan, miesiac) {
  const pamiec = new Map();
  return Object.keys(stan.nauczyciele)
    .sort((a, b) => stan.nauczyciele[a].nazwa.localeCompare(stan.nauczyciele[b].nazwa, "pl"))
    .map((o) => rozliczNauczyciela(stan, o, miesiac, pamiec));
}

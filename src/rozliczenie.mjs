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
  const plan = kPlan ? (planOsob[kPlan][dt] ?? []) : planOsob ? [] : null;
  const r = stan.realizacja[dopasuj(pamiec, osoba, stan.realizacja)]?.[data] ?? null;
  const nieob = stan.zestawienie.nieobecnosci[dopasuj(pamiec, osoba, stan.zestawienie.nieobecnosci)]?.[data] ?? null;
  const zast = stan.zestawienie.zastepstwa[dopasuj(pamiec, osoba, stan.zestawienie.zastepstwa)]?.[data] ?? [];
  const brakDanych = n.tryb === "tematy" && !stan.zrodla.some((z) => z.rodzaj === "tematy" && z.od <= data && z.do >= data);
  const zestawienieWczytane = stan.zrodla.some((z) => z.rodzaj === "zestawienie" && z.od <= data && z.do >= data);

  // Zastępstwa z tematów („Zastępstwo = Tak”) i ich forma płatności z zestawienia zmian.
  const zastepstwa = (r?.zastepstwa ?? []).map((lekcja) => {
    const z = zast.find((x) => x.lekcja === lekcja);
    return { lekcja, forma: z?.forma ?? null, zaKogo: z?.zaKogo ?? null, oddzial: z?.oddzial ?? null };
  });
  const doSumy = zastepstwa.filter((z) => FORMY[z.forma] === "doSumy").map((z) => z.lekcja);
  const dorazneZast = zastepstwa.filter((z) => FORMY[z.forma] === "dorazne").length;
  const nieznane = zastepstwa.filter((z) => !z.forma);
  const bezTematu = brakDanych ? [] : zast.filter((z) => FORMY[z.forma] !== "nic" && !(r?.zastepstwa ?? []).includes(z.lekcja) && !(r?.lekcje ?? []).includes(z.lekcja));

  const tematy = r?.lekcje ?? [];
  const godzinyAuto = zbior(tematy, doSumy).length;
  let godziny;
  if (n.tryb !== "tematy") godziny = n.dzienne?.[dt] ?? 0;
  else godziny = godzinyAuto;
  if (decyzja?.zPlanu) godziny = zbior(tematy, doSumy, plan ?? []).length;
  if (decyzja?.godziny != null) godziny = decyzja.godziny;

  const brakujace = plan && n.tryb === "tematy" && !brakDanych ? plan.filter((p) => !tematy.includes(p) && !doSumy.includes(p)) : [];
  const uwagi = [];
  if (nieob) uwagi.push(`nieobecność: ${nieob.powody.join(", ")}${nieob.lekcje.length ? ` (lekcje ${nieob.lekcje.join(",")})` : ""}`);
  if (brakujace.length) uwagi.push(`bez tematu lekcje z planu: ${brakujace.join(",")}`);
  if (nieznane.length && zestawienieWczytane) uwagi.push(`zastępstwo bez formy płatności w zestawieniu: lekcja ${nieznane.map((z) => z.lekcja).join(",")}`);
  if (nieznane.length && !zestawienieWczytane) uwagi.push(`zastępstwo — forma płatności nieznana (wgraj zestawienie zmian): lekcja ${nieznane.map((z) => z.lekcja).join(",")}`);
  if (bezTematu.length) uwagi.push(`zastępstwo bez tematu w dzienniku: lekcja ${bezTematu.map((z) => z.lekcja).join(",")}`);
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
  const doWyjasnienia = !decyzja && !odliczonyKalendarzem && (Boolean(nieobIstotna) || brakujace.length > 0 || (nieznane.length > 0 && zestawienieWczytane) || bezTematu.length > 0 || Boolean(kal?.czesciowy));
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
  const liczone = wMiesiacu.filter((a) => !a.decyzja?.odliczenie && !kalendarz[a.data]);
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

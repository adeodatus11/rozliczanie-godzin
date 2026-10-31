// Rozdziały klasyfikacji budżetowej godzin (jak w arkuszu PLANOWE, „planowe rozl. wg rozdziałów”):
//   80115 — technikum (oddziały „1TFA”, „2TH”…),
//   80117 — branżowa szkoła I stopnia (F, C, K, W, S…),
//   80118 — branżowa szkoła II stopnia (oddziały „B”), przedmioty ogólnokształcące,
//   KKZ   — branżowa szkoła II stopnia, przedmioty zawodowe; także oddziały i szkoły KKZ.

export const ROZDZIALY = ["80115", "80117", "80118", "KKZ"];
export const NIEPRZYPISANE = "?";

const OGOLNE = /^(język (?!.*zawodow)|matematyka|biologia|chemia|fizyka|geografia|historia|informatyka|wychowanie|edukacja|biznes|wiedza o|podstawy przedsiębiorczości|filozofia|plastyka|muzyka|etyka|religia|zajęcia z wychowawcą)/i;

/** Przedmiot ogólnokształcący (nie zawodowy). */
export const przedmiotOgolny = (przedmiot) => OGOLNE.test(String(przedmiot ?? "").trim());

/** Rozdział lekcji z nazwy szkoły (eksport tematów), oddziału i przedmiotu; null, gdy nie da się ustalić. */
export function rozdzialLekcji({ szkola = "", oddzial = "", przedmiot = "" }) {
  const s = String(szkola);
  const o = String(oddzial).trim();
  if (/KKZ|kwalifikacyjn/i.test(s) || /KKZ/i.test(o)) return "KKZ";
  const typ = /technikum/i.test(s) ? "T" : /II stopnia/i.test(s) ? "B2" : /I stopnia/i.test(s) ? "B1" : /^\d+\s*T/i.test(o) ? "T" : /^\d+\s*B/i.test(o) ? "B2" : /^\d+\s*[A-Z]/i.test(o) ? "B1" : null;
  if (typ === "T") return "80115";
  if (typ === "B1") return "80117";
  if (typ === "B2") return przedmiotOgolny(przedmiot) ? "80118" : "KKZ";
  return null;
}

/** Dzieli całe godziny proporcjonalnie do wag metodą największych reszt (części sumują się do całości). */
export function podzielProporcjonalnie(godziny, wagi) {
  const klucze = Object.keys(wagi).filter((k) => wagi[k] > 0);
  const suma = klucze.reduce((s, k) => s + wagi[k], 0);
  if (!suma || !godziny) return {};
  const calkowite = Number.isInteger(godziny);
  const surowe = klucze.map((k) => [k, (godziny * wagi[k]) / suma]);
  if (!calkowite) return Object.fromEntries(surowe.map(([k, v]) => [k, Math.round(v * 100) / 100]));
  const wynik = Object.fromEntries(surowe.map(([k, v]) => [k, Math.floor(v)]));
  let reszta = godziny - Object.values(wynik).reduce((s, v) => s + v, 0);
  for (const [k] of surowe.slice().sort((a, b) => (b[1] % 1) - (a[1] % 1) || wagi[b[0]] - wagi[a[0]])) {
    if (reszta <= 0) break;
    wynik[k]++;
    reszta--;
  }
  return wynik;
}

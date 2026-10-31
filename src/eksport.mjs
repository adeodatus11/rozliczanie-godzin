// Eksport rozliczenia miesiąca do XLSX (bez bibliotek: XML arkuszy + zip.mjs).
import { writeZip } from "./zip.mjs";
import { POWODY_ODLICZENIA } from "./silnik.mjs";

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
const kol = (i) => {
  let s = "";
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

function arkusz(wiersze, szerokosci = []) {
  const cols = szerokosci.length ? `<cols>${szerokosci.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const rows = wiersze
    .map((w, r) => {
      const cells = w
        .map((v, c) => {
          if (v == null || v === "") return "";
          const ref = `${kol(c)}${r + 1}`;
          const s = r === 0 ? ' s="1"' : "";
          return typeof v === "number" ? `<c r="${ref}"${s}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export async function xlsx(arkusze) {
  const enc = (s) => new TextEncoder().encode(s);
  const nazwy = Object.keys(arkusze);
  const pliki = [
    { name: "[Content_Types].xml", bytes: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${nazwy.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`) },
    { name: "_rels/.rels", bytes: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", bytes: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nazwy.map((n, i) => `<sheet name="${esc(n.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", bytes: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nazwy.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${nazwy.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", bytes: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`) },
    ...nazwy.map((n, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, bytes: enc(arkusz(arkusze[n].wiersze, arkusze[n].szerokosci)) })),
  ];
  return writeZip(pliki);
}

const DNI = ["", "pn", "wt", "śr", "czw", "pt"];
const dm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export function opisDecyzji(d) {
  if (!d) return "";
  const czesci = [];
  if (d.odliczenie) czesci.push(`odliczony: ${POWODY_ODLICZENIA[d.odliczenie] ?? d.odliczenie}`);
  if (d.zPlanu) czesci.push("lekcje z planu (art. 35 ust. 3e)");
  if (d.godziny != null) czesci.push(`godziny wpisane: ${d.godziny}`);
  if (d.ind != null) czesci.push(`IND: ${d.ind}`);
  if (d.kkz != null) czesci.push(`KKZ: ${d.kkz}`);
  if (d.dorazne != null) czesci.push(`doraźne: ${d.dorazne}`);
  return czesci.join("; ");
}

/** Skoroszyt miesiąca: zestawienie, tygodnie, dni i decyzje. */
export function eksportMiesiaca(stan, miesiac, wyniki) {
  const naz = (o) => stan.nauczyciele[o].nazwa;
  const tygodnie = wyniki[0]?.tygodnie.map((t) => `od ${dm(t.poniedzialek)}`) ?? [];
  const zestawienie = [
    ["Nauczyciel", "Tryb", "Pensum", "Maks. ponadwym./tydz.", ...tygodnie, "Suma tygodni", "Ponadwymiarowe do wypłaty", "IND", "KKZ", "Doraźne zastępstwa", "Razem godzin", "Dni do wyjaśnienia"],
    ...wyniki.map((w) => {
      const n = stan.nauczyciele[w.osoba];
      return [n.nazwa, n.tryb, n.pensum, n.maks, ...w.tygodnie.map((t) => t.doRozliczenia), w.suma, w.doWyplaty, w.ind, w.kkz, w.dorazne, w.razem, w.doWyjasnienia];
    }),
  ];
  const tyg = [["Nauczyciel", "Tydzień od", "Suma godzin", "Pensum", "Nad pensum", "Maks.", "Do rozliczenia"]];
  const dni = [["Nauczyciel", "Data", "Dzień", "Godziny", "Plan (lekcje)", "Tematy (lekcje)", "IND", "KKZ", "Doraźne", "Decyzja", "Uwaga do decyzji", "Uwagi automatyczne"]];
  const decyzje = [["Nauczyciel", "Data", "Decyzja", "Uwaga", "Zapisano"]];
  const uwagi = [["Data", "Nauczyciel", "Godziny", "Status", "Uwagi automatyczne"]];
  for (const w of wyniki) {
    for (const t of w.tygodnie) tyg.push([naz(w.osoba), t.poniedzialek, t.suma, t.pensum, t.nadPensum, t.maks, t.doRozliczenia]);
    for (const t of w.tygodnie)
      for (const d of t.dni) {
        if (!d.data.startsWith(miesiac)) continue;
        const a = w.dni[d.data];
        const odl = d.odliczenie ? `odliczony: ${POWODY_ODLICZENIA[d.odliczenie] ?? d.odliczenie}` : "";
        if (a.uwagi.length || a.doWyjasnienia) uwagi.push([d.data, naz(w.osoba), d.godziny, a.decyzja ? `decyzja: ${opisDecyzji(a.decyzja)}` : a.doWyjasnienia ? "do wyjaśnienia" : "informacja", a.uwagi.join("; ")]);
        dni.push([naz(w.osoba), d.data, DNI[new Date(d.data + "T12:00:00Z").getUTCDay() || 7] ?? "", d.godziny, a.plan ? a.plan.join(",") : "", a.tematy.join(","), a.ind || "", a.kkz || "", a.dorazne || "", a.decyzja ? opisDecyzji(a.decyzja) : odl, a.decyzja?.uwaga ?? "", a.uwagi.join("; ")]);
      }
    for (const [data, d] of Object.entries(stan.decyzje[w.osoba] ?? {}).sort())
      if (data.startsWith(miesiac)) decyzje.push([naz(w.osoba), data, opisDecyzji(d), d.uwaga ?? "", d.kiedy?.slice(0, 16).replace("T", " ") ?? ""]);
  }
  return xlsx({
    [`Zestawienie ${miesiac}`]: { wiersze: zestawienie, szerokosci: [30, 9, 8, 10, ...tygodnie.map(() => 10), 10, 12, 7, 7, 10, 10, 10] },
    Tygodnie: { wiersze: tyg, szerokosci: [30, 12, 10, 10, 10, 10, 12] },
    Dni: { wiersze: dni, szerokosci: [30, 12, 6, 9, 16, 16, 6, 6, 8, 40, 30, 60] },
    Decyzje: { wiersze: decyzje, szerokosci: [30, 12, 50, 40, 18] },
    Uwagi: { wiersze: [uwagi[0], ...uwagi.slice(1).sort((x, y) => x[0].localeCompare(y[0]) || x[1].localeCompare(y[1], "pl"))], szerokosci: [12, 30, 9, 30, 100] },
  });
}

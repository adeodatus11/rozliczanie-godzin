// Skopiowane z repozytorium zastepstwa (src/lib/update/xlsx.mjs).
// Odczyt arkuszy XLSX do tablic tekstów. Parser XML jest wstrzykiwany:
// w przeglądarce natywny DOMParser, w testach @xmldom/xmldom.
import { readZip } from "./zip.mjs";

const text = (bytes) => new TextDecoder().decode(bytes);
const byTag = (node, tag) => Array.from(node.getElementsByTagName(tag));

/** Tekst komórki jak w openpyxl: runy <t>, bez wymowy fonetycznej <rPh>. */
function stringItem(node) {
  return byTag(node, "t")
    .filter((t) => t.parentNode.nodeName !== "rPh")
    .map((t) => t.textContent)
    .join("");
}

function column(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** {files, sheets: {nazwa: string[][]}} — files zostają do zapisu po oczyszczeniu. */
export async function readWorkbook(input, DOMParser) {
  const files = await readZip(input);
  const get = (name) => files.find((f) => f.name === name);
  const parse = (name) =>
    new DOMParser().parseFromString(text(get(name).bytes), "application/xml");
  if (!get("xl/workbook.xml"))
    throw Error("To nie jest skoroszyt Excela (brak xl/workbook.xml).");
  const rels = {};
  for (const r of byTag(parse("xl/_rels/workbook.xml.rels"), "Relationship"))
    rels[r.getAttribute("Id")] = r
      .getAttribute("Target")
      .replace(/^\/?(xl\/)?/, "xl/");
  const shared = get("xl/sharedStrings.xml")
    ? byTag(parse("xl/sharedStrings.xml"), "si").map(stringItem)
    : [];
  const sheets = {};
  for (const s of byTag(parse("xl/workbook.xml"), "sheet")) {
    const rows = [];
    for (const row of byTag(parse(rels[s.getAttribute("r:id")]), "row")) {
      const r = Number(row.getAttribute("r")) - 1;
      const cells = (rows[r] = []);
      for (const c of byTag(row, "c")) {
        const t = c.getAttribute("t"),
          v = byTag(c, "v")[0]?.textContent ?? "";
        cells[column(c.getAttribute("r"))] =
          t === "s"
            ? (shared[Number(v)] ?? "")
            : t === "inlineStr"
              ? stringItem(c)
              : v;
      }
    }
    sheets[s.getAttribute("name")] = Array.from(rows, (r) =>
      Array.from(r ?? [], (v) => v ?? ""),
    );
  }
  return { files, sheets };
}

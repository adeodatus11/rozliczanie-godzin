// Odczyt tabel z plików innych niż XLSX: CSV (średnik, przecinek, tabulator)
// i „.xls” zapisany jako HTML (tak eksportują niektóre zestawienia). Bajty
// zamienia na tekst sam: UTF-8, a gdy to się nie uda — windows-1250.

export function dekoduj(bajty) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bajty).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1250").decode(bajty);
  }
}

/** CSV → wiersze. Separator wybierany po pierwszej linii; cudzysłowy jak w Excelu. */
export function czytajCsv(tekst) {
  const pierwsza = tekst.split(/\r?\n/, 1)[0];
  const sep = [";", "\t", ","].sort((a, b) => pierwsza.split(b).length - pierwsza.split(a).length)[0];
  const wiersze = [];
  let wiersz = [];
  let pole = "";
  let wCudz = false;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    if (wCudz) {
      if (c === '"' && tekst[i + 1] === '"') {
        pole += '"';
        i++;
      } else if (c === '"') wCudz = false;
      else pole += c;
    } else if (c === '"') wCudz = true;
    else if (c === sep) {
      wiersz.push(pole);
      pole = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && tekst[i + 1] === "\n") i++;
      wiersz.push(pole);
      wiersze.push(wiersz);
      wiersz = [];
      pole = "";
    } else pole += c;
  }
  if (pole || wiersz.length) wiersze.push([...wiersz, pole]);
  return wiersze;
}

/** Tabele HTML → {„Tabela 1”: wiersze, …}; komórki z colspan są powielane, żeby kolumny się zgadzały. */
export function czytajHtml(tekst, DOMParser) {
  const doc = new DOMParser().parseFromString(tekst, "text/html");
  const out = {};
  Array.from(doc.getElementsByTagName("table")).forEach((t, n) => {
    out[`Tabela ${n + 1}`] = Array.from(t.getElementsByTagName("tr")).map((tr) =>
      Array.from(tr.childNodes)
        .filter((td) => /^t[dh]$/i.test(td.nodeName))
        .flatMap((td) => Array(Number(td.getAttribute("colspan")) || 1).fill(td.textContent.replace(/\s+/g, " ").trim())),
    );
  });
  return out;
}

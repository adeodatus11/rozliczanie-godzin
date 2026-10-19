// Składa aplikację w jeden plik HTML (bez serwera i bez zależności w sieci):
//   dist/index.html — publikacja na GitHub Pages,
//   z --do-onedrive także ../aplikacja/rozliczanie-godzin.html (kopia do otwierania z dysku).
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const wynik = await build({
  entryPoints: [fileURLToPath(new URL("app/app.mjs", import.meta.url))],
  bundle: true,
  format: "iife",
  target: "es2022",
  charset: "utf8",
  write: false,
  legalComments: "none",
});
const js = wynik.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = (await fs.readFile(new URL("app/index.html", import.meta.url), "utf8")).replace('<script type="module" src="app.mjs"></script>', () => `<script>\n${js}</script>`);

const cele = [new URL("dist/index.html", import.meta.url)];
if (process.argv.includes("--do-onedrive")) cele.push(new URL("../aplikacja/rozliczanie-godzin.html", import.meta.url));
for (const cel of cele) {
  await fs.mkdir(new URL(".", cel), { recursive: true });
  await fs.writeFile(cel, html);
  console.log(`Zapisano ${fileURLToPath(cel)} (${Math.round(html.length / 1024)} KB)`);
}

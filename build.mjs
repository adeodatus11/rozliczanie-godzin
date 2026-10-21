// Składa aplikacje w pojedyncze pliki HTML (bez serwera i bez zależności w sieci):
//   dist/index.html      — rozliczanie godzin (GitHub Pages),
//   dist/frekwencja.html — zaświadczenia o frekwencji,
//   z --do-onedrive także kopie w ../aplikacja/ (do otwierania z dysku).
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const APLIKACJE = [
  { html: "app/index.html", js: "app.mjs", dist: "dist/index.html", onedrive: "../aplikacja/rozliczanie-godzin.html" },
  { html: "app/frekwencja.html", js: "frekwencja.mjs", dist: "dist/frekwencja.html", onedrive: "../aplikacja/frekwencja.html" },
];

for (const a of APLIKACJE) {
  const wynik = await build({
    entryPoints: [fileURLToPath(new URL(`app/${a.js}`, import.meta.url))],
    bundle: true,
    format: "iife",
    target: "es2022",
    charset: "utf8",
    write: false,
    legalComments: "none",
    loader: { ".png": "dataurl" },
  });
  const js = wynik.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const szablon = await fs.readFile(new URL(a.html, import.meta.url), "utf8");
  const znacznik = `<script type="module" src="${a.js}"></script>`;
  if (!szablon.includes(znacznik)) throw Error(`${a.html}: brak ${znacznik}`);
  const html = szablon.replace(znacznik, () => `<script>\n${js}</script>`);

  const cele = [new URL(a.dist, import.meta.url)];
  if (process.argv.includes("--do-onedrive")) cele.push(new URL(a.onedrive, import.meta.url));
  for (const cel of cele) {
    await fs.mkdir(new URL(".", cel), { recursive: true });
    await fs.writeFile(cel, html);
    console.log(`Zapisano ${fileURLToPath(cel)} (${Math.round(html.length / 1024)} KB)`);
  }
}

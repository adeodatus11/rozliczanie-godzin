# Rozliczanie godzin ponadwymiarowych

Aplikacja dla dyrekcji ZSZ nr 5 do tygodniowego rozliczania godzin ponadwymiarowych i doraźnych zastępstw z eksportów dziennika VULCAN. Liczy według art. 35 ust. 3e, 3f i 3h Karty Nauczyciela w brzmieniu ustawy z 21.11.2025 (Dz.U. 2025 poz. 1849).

Cała aplikacja to jedna strona. Wszystko dzieje się w przeglądarce: wgrane pliki nie są nigdzie wysyłane, a stan rozliczenia zapisuje się do pliku `.json` wskazanego przez użytkownika, np. w OneDrive kadry kierowniczej. **To repozytorium zawiera wyłącznie kod — bez danych nauczycieli ani uczniów.**

## Jak pracować

1. **Na start, raz:**
   - wgraj dotychczasowy arkusz ROZLICZONE (przeniesie pensum, limity, uśrednienia, specjalistów) i sprawdź zakładkę „Nauczyciele”,
   - w „Źródłach” pobierz aktualny plan lekcji z serwisu nauczyciela.
2. **Co tydzień:** wgraj eksport tematów (`ZestawienieTematowZrealizowanych`) i `ZbiorczeZestawienieZmian`. Ponowne wgranie tego samego okresu zastępuje stare dane.
3. **Dni podświetlone na żółto** (do wyjaśnienia): kliknij dzień i zdecyduj. Możesz:
   - odliczyć dzień (pensum −1/5),
   - liczyć lekcje z planu (art. 35 ust. 3e),
   - wpisać godziny ręcznie z uzasadnieniem.

   Nagłówek dnia ustawia decyzję wszystkim naraz.
4. **Zapisz** plik rozliczenia. Pozostałe osoby otwierają ten sam plik; zmiany zapisuje jedna osoba naraz.
5. **Koniec miesiąca:** zakładka „Miesiąc” → „Pobierz XLSX” (zestawienie, tygodnie, dni, decyzje).

Zasady:
- Do sumy dnia wchodzą lekcje z tematem i zastępstwa „Godzina do zliczenia”.
- „Dodatkowo płatne” to doraźne zastępstwa, liczone osobno.
- IND i KKZ są liczone osobno, poza pensum.
- Prywatny dzień wolny nie obniża pensum.

## Kod

| Plik | Co robi |
|---|---|
| `src/silnik.mjs` | reguły tygodnia i miesiąca: pensum −1/5 (1/4), limit przydziału, zaokrąglenie do wypłaty |
| `src/rozliczenie.mjs` | analiza dnia (plan, tematy, zastępstwa, nieobecności, decyzje, podpowiedzi) i miesiąc nauczyciela |
| `src/wejscie.mjs`, `src/zmiany.mjs` | odczyt eksportów VULCAN i planu aSc; kolumny mogące identyfikować uczniów są pomijane od razu |
| `src/konfiguracja.mjs`, `src/arkusz.mjs` | przeniesienie konfiguracji z dotychczasowego arkusza |
| `src/stan.mjs`, `src/kalendarz.mjs`, `src/eksport.mjs` | plik rozliczenia, kalendarz 2026/27, eksport XLSX |
| `src/xlsx.mjs`, `src/zip.mjs` | czytnik i zapis XLSX bez bibliotek (z repozytorium `zastepstwa`) |
| `app/` | interfejs; `build.mjs` składa go w jeden plik `dist/index.html` |

```sh
npm install
npm test               # przykłady z załączników do szkolenia i przypadki na danych zmyślonych
npm run build          # dist/index.html
npm run aplikacja      # dodatkowo kopia ../aplikacja/rozliczanie-godzin.html
```

Folder `lokalne/` (porównania na prawdziwych danych, raporty) jest wyłączony z repozytorium w `.gitignore`. Nie dodawaj do repozytorium eksportów z dziennika, plików rozliczenia ani raportów.

Push na `main` uruchamia testy i publikację na GitHub Pages (`.github/workflows/pages.yml`).

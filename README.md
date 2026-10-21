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

## Zaświadczenia o frekwencji (`frekwencja.html`)

Druga, osobna strona w tym samym projekcie: zaświadczenie o łącznej frekwencji ucznia ze wszystkich przedmiotów za wybrany okres.

1. Wgraj eksport z VULCAN **„Zestawienie frekwencji na lekcjach przedmiotów”** (`ZestawienieFrekwencjeNaLekcjachPrzedmiotow*.xlsx`). Kilka klas wgrywa się kilkoma plikami. Wynik jest liczony tak jak w VULCAN, a strona porównuje go z „% frekwencji” z pliku.
   - Zestawienie ma same sumy za „Badany okres” ustawiony przy eksporcie, bez dat, więc nie da się z niego wyciąć części. Okres zaświadczenia składa się z wgranych eksportów i z ich różnic. Sumy się odejmują, więc eksport 01.09–21.10 i eksport za wrzesień dają też 01.10–21.10; liczy się różnica dwóch eksportów o wspólnym początku albo końcu. Najwygodniej robić eksporty od 1 września do końca każdego miesiąca albo eksporty miesięczne. Na inny okres (np. 15.09–21.10) zrób eksport dokładnie za ten okres. Eksporty do odejmowania rób tego samego dnia: jeśli dane zmieniły się między nimi (np. później usprawiedliwiono nieobecność), różnica wyjdzie ujemna i strona jej nie użyje.
   - Strona sama dobiera eksporty, które nie zachodzą na siebie, więc nic nie liczy się podwójnie. Pokazuje też, za jakie dni brakuje danych. Na zaświadczeniu jest zawsze okres naprawdę objęty eksportami.
   - Działa też XLSX, CSV albo HTML z jednym wierszem na lekcję (uczeń, data, wpis frekwencji); wtedy okres wybiera się co do dnia. Kolumny rozpoznają się same, a jeśli nie, wskażesz je w „Kolumny w plikach”.
2. Wybierz ucznia (pole wyszukiwania + lista) i okres („od”, „do” albo przyciski eksportów i miesięcy).
3. Wynik:
   - frekwencja = obecności ÷ (obecności + nieobecności) × 100,
   - godziny nieobecności nieusprawiedliwionej i ich procent wszystkich zajęć.
4. „Drukuj / zapisz jako PDF” — zaświadczenie na papierze firmowym ZSZ5 (jak w szablonie `.dotx`), „Wrocław, <data>”, bez miejsca na podpis (pieczątka).

Jak liczone są wpisy, sprawdzisz w „Jak liczone są wpisy”:
- podstawa = symbole, które VULCAN ma z kolumną % (●, ▬, u, s, su, ns, zw, L4, w, um, kw, ind); symbole bez kolumny % (np. p, k, z, ?) są „nie liczyć”,
- obecność: ●, s, su; nieusprawiedliwiona: ▬; usprawiedliwiona: u, L4, zw,
- „Wszystkie wpisy” obejmują też lekcje spoza listy przedmiotów — w podziale na przedmioty to wiersz „inne wpisy”.

Każdy wpis można przestawić. Strona ma zablokowany dostęp do sieci (Content-Security-Policy), a dane uczniów są tylko w pamięci karty. W przeglądarce zapamiętywane jest wyłącznie przypisanie rodzajów wpisów.

## Kod

| Plik | Co robi |
|---|---|
| `src/silnik.mjs` | reguły tygodnia i miesiąca: pensum −1/5 (1/4), limit przydziału, zaokrąglenie do wypłaty |
| `src/rozliczenie.mjs` | analiza dnia (plan, tematy, zastępstwa, nieobecności, decyzje, podpowiedzi) i miesiąc nauczyciela |
| `src/wejscie.mjs`, `src/zmiany.mjs` | odczyt eksportów VULCAN i planu aSc; kolumny mogące identyfikować uczniów są pomijane od razu |
| `src/konfiguracja.mjs`, `src/arkusz.mjs` | przeniesienie konfiguracji z dotychczasowego arkusza |
| `src/stan.mjs`, `src/kalendarz.mjs`, `src/eksport.mjs` | plik rozliczenia, kalendarz 2026/27, eksport XLSX |
| `src/xlsx.mjs`, `src/zip.mjs` | czytnik i zapis XLSX bez bibliotek (z repozytorium `zastepstwa`) |
| `src/frekwencja.mjs`, `src/tabele.mjs` | zaświadczenia: rozpoznanie tabeli frekwencji, rodzaje wpisów, rachunek okresu; odczyt CSV i tabel HTML |
| `app/` | interfejsy; `build.mjs` składa każdy w jeden plik: `dist/index.html` i `dist/frekwencja.html` |

```sh
npm install
npm test               # przykłady z załączników do szkolenia i przypadki na danych zmyślonych
npm run build          # dist/index.html, dist/frekwencja.html
npm run aplikacja      # dodatkowo kopie ../aplikacja/rozliczanie-godzin.html i ../aplikacja/frekwencja.html
```

Folder `lokalne/` (porównania na prawdziwych danych, raporty) jest wyłączony z repozytorium w `.gitignore`. Nie dodawaj do repozytorium eksportów z dziennika, plików rozliczenia ani raportów.

Push na `main` uruchamia testy i publikację na GitHub Pages (`.github/workflows/pages.yml`).

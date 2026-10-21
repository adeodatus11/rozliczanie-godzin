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

1. Wgraj eksport frekwencji z dziennika (XLSX, CSV albo „.xls” zapisany jako HTML). Najlepiej taki, w którym jeden wiersz to jedna lekcja ucznia: uczeń, oddział, data, nr lekcji, przedmiot, wpis frekwencji. Wystarczą kolumny: uczeń, data, wpis. Zadziała też zestawienie z sumami (obecności, nieobecności usprawiedliwione i nieusprawiedliwione), ale wtedy okres jest taki, za jaki zrobiono eksport. Kolumny rozpoznają się same. Jeśli się nie rozpoznają, wskażesz je w „Kolumny w plikach”.
2. Wybierz ucznia (pole wyszukiwania + lista) i okres („od”, „do” albo przyciski miesięcy).
3. Wynik:
   - frekwencja = obecności ÷ (obecności + nieobecności) × 100,
   - godziny nieobecności nieusprawiedliwionej i ich procent wszystkich zajęć.
4. Uzupełnij nagłówek szkoły i kliknij „Drukuj / zapisz jako PDF”.

Jak liczone są wpisy, sprawdzisz w „Jak liczone są wpisy”:
- spóźnienie i nieobecność z przyczyn szkolnych liczą się jak obecność,
- zwolnienie liczy się jak nieobecność usprawiedliwiona,
- wpis oznaczony „nie liczyć” nie wchodzi do rachunku.

Każdy wpis można przestawić. Strona ma zablokowany dostęp do sieci (Content-Security-Policy), a dane uczniów są tylko w pamięci karty. W przeglądarce zapamiętywane są wyłącznie nagłówek szkoły i przypisanie rodzajów wpisów.

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

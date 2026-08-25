# Wzory klauzul i zgód dla szkół

**Wersja zbioru:** 2026-08-20

> **PROJEKT — wymaga weryfikacji przez radcę prawnego.** Zobacz [README](../README.md).

Materiał przeznaczony dla **szkół korzystających z Courtto Academy**. Szkoła jest administratorem danych swoich uczniów i opiekunów — to ona odpowiada za zebranie zgód i wykonanie obowiązku informacyjnego. Wzory mają charakter pomocniczy i wymagają dostosowania do rzeczywistej praktyki szkoły.

## Jak wzory łączą się z aplikacją

Aplikacja przechowuje **aktualną decyzję** (`member_consent`), a historię decyzji — dziennik zdarzeń. Pole `documentVersion` zapisuje, **do jakiego brzmienia klauzuli** odnosi się zgoda. Ma to znaczenie praktyczne: zgoda jest zgodą *na określony cel*, więc po zmianie treści klauzuli stara zgoda przestaje ją pokrywać i trzeba zapytać ponownie.

Identyfikatory wersji do wpisania w polu `documentVersion`:

| Zgoda | `CONSENT_TYPES` | Identyfikator wersji |
|---|---|---|
| Wizerunek | `image` | `wizerunek-2026-08-20` |
| Marketing | `marketing` | `marketing-2026-08-20` |

## Czego tu celowo nie ma

**Nie ma „zgody na przetwarzanie danych osobowych" i nie powinno jej być.**

Prowadzenie zajęć, na które rodzic zapisał dziecko, odbywa się na podstawie **umowy** (art. 6 ust. 1 lit. b RODO), a nie zgody. Odbieranie zgody na coś, co i tak wykonujesz na podstawie umowy, jest błędem o realnych konsekwencjach: zgodę można wycofać w każdej chwili (art. 7 ust. 3 RODO), a wtedy trzeba by przerwać prowadzenie zajęć w trakcie opłaconego semestru. Podstawy prawnej nie wolno też zamieniać po fakcie.

Dlatego zgody dotyczą wyłącznie tego, co bez nich naprawdę byłoby niedopuszczalne: **wizerunku** i **marketingu**. Rozliczenia, obecności i kontakt w sprawach organizacyjnych opierają się na umowie i na prawnie uzasadnionym interesie.

---

# 1. Klauzula informacyjna dla ucznia i opiekuna (art. 13 RODO)

> Do przekazania przy zapisie na zajęcia. Wypełnij nawiasy kwadratowe.

**Informacja o przetwarzaniu danych osobowych**

1. Administratorem danych osobowych uczestnika zajęć oraz jego opiekunów jest **[NAZWA SZKOŁY]**, [adres], NIP [NIP], e-mail: [e-mail], telefon: [telefon].
2. Dane przetwarzamy w następujących celach:
   - organizacja i prowadzenie zajęć, w tym prowadzenie ewidencji zapisów i obecności — na podstawie art. 6 ust. 1 lit. b RODO (wykonanie umowy), a w przypadku uczestnika małoletniego — umowy zawartej z jego opiekunem;
   - rozliczenia finansowe i wystawianie dokumentów księgowych — art. 6 ust. 1 lit. c RODO (obowiązek prawny);
   - kontakt w sprawach organizacyjnych, w tym powiadomienia o odwołaniu i zmianie terminu zajęć — art. 6 ust. 1 lit. f RODO (nasz prawnie uzasadniony interes polegający na sprawnej organizacji zajęć);
   - zapewnienie bezpieczeństwa uczestników podczas zajęć — art. 6 ust. 1 lit. f RODO;
   - ustalenie, dochodzenie i obrona roszczeń — art. 6 ust. 1 lit. f RODO;
   - publikacja wizerunku — **wyłącznie na podstawie odrębnej zgody** (art. 6 ust. 1 lit. a RODO);
   - przesyłanie informacji o ofercie — **wyłącznie na podstawie odrębnej zgody**.
3. Podanie danych wskazanych jako obowiązkowe jest warunkiem zapisania uczestnika na zajęcia. Podanie danych do celów objętych zgodą jest dobrowolne.
4. Dane przechowujemy przez czas uczestnictwa w zajęciach, a następnie: dokumentację księgową — 5 lat od końca roku obrotowego (art. 74 ust. 2 ustawy o rachunkowości); pozostałe dane — do upływu terminu przedawnienia roszczeń; dane objęte zgodą — do jej wycofania.
5. Odbiorcami danych są: dostawca systemu do zarządzania szkołą [NAZWA PODMIOTU COURTTO], operator płatności Stripe Payments Europe Ltd, biuro rachunkowe oraz podmioty uprawnione na podstawie przepisów prawa.
6. Dane nie są przekazywane poza Europejski Obszar Gospodarczy.
7. Przysługuje prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia, wniesienia sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie oraz wycofania zgody w każdym czasie — bez wpływu na zgodność z prawem przetwarzania dokonanego przed wycofaniem.
8. Przysługuje prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa.
9. Dane nie są wykorzystywane do zautomatyzowanego podejmowania decyzji, w tym profilowania.

---

# 2. Klauzula informacyjna dla opiekuna (art. 14 RODO)

> **Do przekazania opiekunowi, którego dane szkoła otrzymała od kogoś innego** — najczęściej gdy dane rodzica podaje drugi rodzic albo pełnoletni uczestnik wskazuje osobę kontaktową. To odrębny obowiązek: opiekun nie podał danych osobiście, więc nie wie, że je macie. Termin: **w rozsądnym terminie, najpóźniej w ciągu miesiąca** od pozyskania danych, a jeżeli dane służą komunikacji z tą osobą — **najpóźniej przy pierwszym kontakcie**.

**Informacja o przetwarzaniu Pani/Pana danych osobowych**

1. Administratorem Pani/Pana danych osobowych jest **[NAZWA SZKOŁY]**, [adres], e-mail: [e-mail], telefon: [telefon].
2. **Pani/Pana dane otrzymaliśmy od [imię i nazwisko uczestnika albo drugiego opiekuna]** w związku z uczestnictwem [imię i nazwisko uczestnika] w zajęciach organizowanych przez naszą szkołę.
3. Przetwarzamy następujące kategorie Pani/Pana danych: imię i nazwisko, stopień pokrewieństwa z uczestnikiem, numer telefonu, adres e-mail.
4. Dane przetwarzamy w celu:
   - kontaktu w sprawach dotyczących uczestnictwa dziecka w zajęciach, w tym powiadomień o zmianach terminów i sytuacjach wymagających pilnego kontaktu — na podstawie art. 6 ust. 1 lit. f RODO (prawnie uzasadniony interes polegający na zapewnieniu bezpieczeństwa i sprawnej organizacji zajęć);
   - rozliczeń za zajęcia, jeżeli jest Pani/Pan osobą dokonującą płatności — art. 6 ust. 1 lit. b oraz lit. c RODO.
5. Dane przechowujemy przez czas uczestnictwa dziecka w zajęciach, a następnie przez okres przedawnienia roszczeń. Dane rozliczeniowe — 5 lat od końca roku obrotowego.
6. Odbiorcami danych są: dostawca systemu do zarządzania szkołą [NAZWA PODMIOTU COURTTO], operator płatności Stripe Payments Europe Ltd oraz biuro rachunkowe.
7. Dane nie są przekazywane poza Europejski Obszar Gospodarczy.
8. Przysługuje Pani/Panu prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia oraz **wniesienia sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie**.
9. Przysługuje prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.

---

# 3. Zgoda na wykorzystanie wizerunku

**Identyfikator wersji:** `wizerunek-2026-08-20`

> Podstawa podwójna: art. 81 ustawy o prawie autorskim i prawach pokrewnych (rozpowszechnianie wizerunku) oraz art. 6 ust. 1 lit. a RODO (przetwarzanie danych).
>
> **W przypadku uczestnika małoletniego zgodę wyraża opiekun.** Aplikacja weryfikuje to na podstawie daty urodzenia i nie pozwoli zapisać zgody małoletniego udzielonej przez niego samego.
>
> Zgoda musi być **dobrowolna** — odmowa nie może skutkować odmową przyjęcia na zajęcia. Zgoda **zbiorcza dołączona do umowy jako jej element** jest wadliwa; musi być odrębnym, samodzielnie zaznaczanym oświadczeniem.

---

Ja, niżej podpisana/podpisany **[imię i nazwisko]**, działając [we własnym imieniu / jako przedstawiciel ustawowy uczestnika **[imię i nazwisko dziecka]**, ur. **[data urodzenia]**],

wyrażam zgodę na nieodpłatne utrwalanie i rozpowszechnianie wizerunku [mojego / mojego dziecka] przez **[NAZWA SZKOŁY]**, [adres], w postaci fotografii i nagrań wykonanych podczas zajęć, turniejów i wydarzeń organizowanych przez szkołę.

Zgoda obejmuje rozpowszechnianie wizerunku w następujących kanałach — **zaznacz wybrane**:

- [ ] strona internetowa szkoły
- [ ] profile szkoły w mediach społecznościowych (Facebook, Instagram)
- [ ] materiały drukowane: plakaty, ulotki, kroniki
- [ ] relacje z turniejów przekazywane mediom lokalnym

Zgoda nie obejmuje wykorzystania wizerunku w sposób naruszający dobra osobiste, w kontekście ośmieszającym ani w reklamie produktów podmiotów trzecich.

Przyjmuję do wiadomości, że:

1. wyrażenie zgody jest **dobrowolne**, a odmowa nie wpływa na możliwość uczestnictwa w zajęciach ani na sposób traktowania uczestnika;
2. zgodę mogę **wycofać w każdym czasie**, kontaktując się ze szkołą pod adresem [e-mail] — bez podawania przyczyny i bez żadnych negatywnych konsekwencji;
3. wycofanie zgody nie wpływa na zgodność z prawem rozpowszechniania dokonanego przed wycofaniem, a szkoła usunie wizerunek z kanałów pozostających pod jej kontrolą niezwłocznie, nie później niż w terminie 14 dni; **szkoła nie ma technicznej możliwości usunięcia materiałów już rozpowszechnionych przez osoby trzecie ani wydrukowanych**;
4. zapoznałam/zapoznałem się z klauzulą informacyjną szkoły.

Miejscowość i data: ....................  Podpis: ....................

---

# 4. Zgoda na otrzymywanie informacji handlowych

**Identyfikator wersji:** `marketing-2026-08-20`

> Podstawa: art. 6 ust. 1 lit. a RODO oraz art. 398 ustawy Prawo komunikacji elektronicznej (dawny art. 10 ustawy o świadczeniu usług drogą elektroniczną i art. 172 Prawa telekomunikacyjnego).
>
> Zgoda musi być **odrębna dla każdego kanału**. Nie łącz jej ze zgodą na wizerunek ani z akceptacją regulaminu — zgoda „w pakiecie" jest nieważna.

---

Wyrażam zgodę na otrzymywanie od **[NAZWA SZKOŁY]** informacji o ofercie zajęć, turniejach, promocjach i wydarzeniach:

- [ ] pocztą elektroniczną na adres: ....................
- [ ] wiadomościami SMS na numer: ....................

Przyjmuję do wiadomości, że:

1. wyrażenie zgody jest dobrowolne i nie jest warunkiem uczestnictwa w zajęciach;
2. zgodę mogę wycofać w każdym czasie — pisząc na adres [e-mail] albo korzystając z odnośnika rezygnacji zamieszczonego w każdej wiadomości;
3. wycofanie zgody nie wpływa na zgodność z prawem wysyłki dokonanej przed wycofaniem.

Miejscowość i data: ....................  Podpis: ....................

---

# 5. Wskazówki wdrożeniowe dla szkoły

1. **Zgody zbieraj osobno od umowy.** Zgoda wpisana w treść umowy jako jeden z jej punktów nie jest dobrowolna — nie da się jej odmówić bez odmowy zawarcia umowy. Osobna kartka albo osobne, samodzielnie zaznaczane pole.
2. **Nie zaznaczaj pól z góry.** Domyślnie zaznaczone pole nie jest zgodą (motyw 32 RODO).
3. **Zapisz każdą zgodę w aplikacji od razu**, wraz z identyfikatorem wersji z tabeli na początku dokumentu. Bez tego nie wykażesz, na co dokładnie zgoda została udzielona.
4. **Wycofanie zgody honoruj natychmiast i nie pytaj o powód.** W aplikacji wycofanie zajmuje jedno kliknięcie i nie usuwa daty udzielenia — to celowe, bo ta data jest dowodem, że w danym okresie przetwarzanie było legalne.
5. **Brak zgody to nie odmowa.** Aplikacja rozróżnia „nigdy nie zapytano" od „wycofano". Pierwsze jest zaległością do nadrobienia, drugie — decyzją do uszanowania. Raport zgodności celowo pokazuje wyłącznie to pierwsze.
6. **Nie wpisuj informacji o zdrowiu do pól notatek** — ani przy uczestniku, ani przy opiekunie. To dane szczególnej kategorii, wymagające odrębnej podstawy prawnej i węższego dostępu, których pola notatek nie zapewniają. Zobacz Załącznik nr 1 pkt 4 do umowy powierzenia.
7. **Zgoda udzielona przez opiekuna nie odnawia się z chwilą uzyskania pełnoletności przez uczestnika.** Po ukończeniu 18 lat warto zapytać ponownie — zwłaszcza o wizerunek. Aplikacja pokazuje wiek, ale nie przypomina o tym automatycznie.

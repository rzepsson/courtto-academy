# Dokumentacja prawna Courtto Academy

> [!WARNING]
> **To są projekty dokumentów, a nie dokumenty wiążące.** Nie zostały zweryfikowane przez radcę prawnego, zawierają placeholdery w nawiasach kwadratowych i nie obowiązują żadnej ze stron — produkt nie działa jeszcze komercyjnie.
>
> Są w publicznym repozytorium jako część kodu: pokazują, jak zamodelowana została warstwa zgodności (role administrator/procesor, podstawy prawne, retencja), a nie jako wzory gotowe do użycia. **Nie kopiuj ich do własnego produktu** — zakres powierzenia i podstawa przetwarzania zależą od konkretnego przypadku, a pomyłka w tym miejscu kosztuje naprawdę.

Źródło prawdy dla wszystkich dokumentów prawnych produktu. Pliki w tym katalogu są **wersjonowane w gicie** i renderowane w aplikacji — nie edytuj treści prawnej gdzie indziej.

## Zasada wersjonowania

Każdy dokument ma wersję w formacie `RRRR-MM-DD` zadeklarowaną w [`shared/legal.ts`](../../shared/legal.ts). To jedyne miejsce, w którym numer wersji istnieje w kodzie; strony `/terms` i `/privacy` oraz zapis akceptacji przy rejestracji czytają go stamtąd.

**Kiedy podbić wersję:** przy każdej zmianie merytorycznej (zakres usługi, podstawa prawna, retencja, podprocesor, odpowiedzialność). Literówka i formatowanie — nie.

**Co się dzieje po podbiciu:** użytkownicy, których ostatnia akceptacja dotyczy starszej wersji, mają `needsReacceptance === true`. Zgodnie z art. 8 ust. 3 ustawy o świadczeniu usług drogą elektroniczną zmiana regulaminu wymaga poinformowania usługobiorcy; przy umowie ciągłej (abonament) — z wyprzedzeniem i z prawem wypowiedzenia. Podbicie wersji nie zwalnia z wysłania powiadomienia.

## Zawartość

| Plik | Co to jest | Strony umowy |
|---|---|---|
| [`pl/regulamin.md`](pl/regulamin.md) | Regulamin świadczenia usług drogą elektroniczną (uśude art. 8) | Courtto ↔ Szkoła |
| [`pl/polityka-prywatnosci.md`](pl/polityka-prywatnosci.md) | Obowiązek informacyjny (RODO art. 13/14) + cookies | Courtto → posiadacz konta |
| [`pl/umowa-powierzenia.md`](pl/umowa-powierzenia.md) | Umowa powierzenia przetwarzania (RODO art. 28) + 3 załączniki | Szkoła (administrator) ↔ Courtto (procesor) |
| [`pl/wzory-zgod.md`](pl/wzory-zgod.md) | Wzory do użytku **przez szkołę**: zgoda na wizerunek, zgoda marketingowa, klauzula dla opiekunów (art. 14) | Szkoła ↔ uczeń/opiekun |
| [`en/terms-of-service.md`](en/terms-of-service.md) | Tłumaczenie pomocnicze regulaminu | — |
| [`en/privacy-policy.md`](en/privacy-policy.md) | Tłumaczenie pomocnicze polityki | — |

**Wersja polska jest wiążąca.** Angielska ma charakter informacyjny — zapisano to w § 19 regulaminu i w sekcji 12 polityki.

## Dwie role Courtto — fundament całej konstrukcji

To rozróżnienie przechodzi przez wszystkie dokumenty i przez schemat bazy. Pomylenie go jest najczęstszym błędem w dokumentacji SaaS-ów B2B:

- **Courtto jako ADMINISTRATOR** — dane osób, które zakładają konto w aplikacji (`user`, `session`, `account`, `notification`, `subscription`, `user_agreement`, `user_consent`). Cel: świadczenie usługi na rzecz tej osoby, rozliczenie abonamentu, bezpieczeństwo. Reguluje to **polityka prywatności**.
- **Courtto jako PODMIOT PRZETWARZAJĄCY** — dane, które szkoła wprowadza o swoich uczniach i ich opiekunach (`member_profile`, `member_guardian`, `member_consent`, `enrollment`, `attendance`, `audit_log`, `payment_audit`). Administratorem jest **szkoła**; Courtto przetwarza wyłącznie na jej udokumentowane polecenie. Reguluje to **umowa powierzenia**.

Ta sama osoba może występować w obu rolach jednocześnie — trener ma konto (rola 1) i jest członkiem szkoły (rola 2). To nie jest sprzeczność; to dwa różne zbiory danych o tej samej osobie, z dwiema różnymi podstawami i dwoma różnymi administratorami.

## Cookies — dlaczego nie ma bannera

Stan na dziś (zweryfikowany w kodzie): aplikacja ustawia wyłącznie ciasteczko sesji Better Auth (wraz z podpisanym `cookieCache`) i `courtto_locale`. Brak analityki, pikseli, zewnętrznych czcionek (`@nuxt/fonts` hostuje je lokalnie) i zewnętrznych skryptów. Wszystkie ciasteczka są **niezbędne albo funkcjonalne**, więc art. 398 Prawa komunikacji elektronicznej nie wymaga zgody — wystarcza informacja, którą zawiera sekcja 8 polityki prywatności.

**To stan do utracenia jednym commitem.** Dodanie Google Analytics, Meta Pixel, Hotjara, mapy Google, osadzonego YouTube albo czcionki z CDN natychmiast rodzi obowiązek zgody (banner z realnym „odrzuć", nie samym „ok"). Jeśli taki dodatek kiedyś wejdzie — wróć tu i do sekcji 8 polityki.

## BLOKUJĄCE: eksport danych Organizacji nie istnieje

Regulamin obiecuje go w **trzech miejscach** — § 11 ust. 7 („Szkoła może w każdym czasie wyeksportować dane Organizacji"), § 16 ust. 5 i 9 (dostępność eksportu po rozwiązaniu i przy zaprzestaniu usługi) — a umowa powierzenia opiera na nim § 10 ust. 2 (realizację art. 28 ust. 3 lit. g RODO, czyli zwrot danych).

W aplikacji istnieją dziś **tylko dwa eksporty**, żaden z nich nie jest eksportem Organizacji:

- `GET /api/account/export` — dane **posiadacza konta**, nie szkoły;
- `GET /api/school/members/export` — lista członków w CSV, bez zajęć, obecności, zapisów, opiekunów, zgód i rozliczeń.

Brakuje kompletu: `lessonSeries`, `lessonSession`, `enrollment`, `attendance`, `memberGuardian`, `memberConsent`, `court`, `courtZone`, `reservation`, `paymentAudit`, `auditLog`, `orgProfile`.

**Nie publikuj dokumentów przed rozstrzygnięciem tej pozycji.** Do wyboru:

1. **Zbudować eksport Organizacji** (rekomendowane) — jedno pobranie ZIP/JSON obejmujące wszystkie tabele scoped po `organizationId`. Wzorzec istnieje: `exportAccountData` w `services/account.ts` robi dokładnie to samo dla konta, zapytaniami zbiorczymi. To jednocześnie realizacja art. 28 ust. 3 lit. g i jedyne realne zabezpieczenie z § 16 ust. 11.
2. **Osłabić klauzule** do stanu faktycznego — wtedy § 16 ust. 11 („jedynym skutecznym zabezpieczeniem jest samodzielne pobieranie kopii") staje się pusty, bo nie ma czego pobierać, a przy sprzedaży do większego klienta zostanie to wychwycone.

Argument za (1): klauzule o niewypłacalności są warte dokładnie tyle, ile eksport, na którym się opierają. Obietnica ciągłości bez działającego eksportu to najgorszy z możliwych wariantów — zobowiązanie umowne bez pokrycia technicznego.

## Do zatwierdzenia przed publikacją

Dokumenty są **projektami**. Poniższe pozycje wymagają decyzji lub weryfikacji przez prawnika — są w tekstach oznaczone nawiasami kwadratowymi:

1. **Oznaczenie podmiotu** — forma prawna, nazwa, adres, NIP/KRS. Do uzupełnienia po decyzji JDG vs sp. z o.o.
2. **Adres e-mail do spraw danych osobowych** — proponowany `privacy@courtto.pl`.
3. **Inspektor Ochrony Danych** — projekt zakłada, że **nie został wyznaczony**. Zweryfikuj: art. 37 ust. 1 lit. b RODO nakazuje wyznaczenie IOD, gdy główna działalność polega na przetwarzaniu wymagającym *regularnego i systematycznego monitorowania na dużą skalę*. Argument za brakiem obowiązku: Courtto jest procesorem i nie monitoruje osób. Argument za wyznaczeniem: skala rośnie z liczbą szkół, a dane dotyczą dzieci. Przy pierwszych kilkudziesięciu szkołach obowiązku raczej nie ma — **potwierdź z prawnikiem, bo to ocena, nie fakt.**
4. **Dostawca hostingu i bazy** — załącznik 2 umowy powierzenia ma placeholder. Ustalono: **wyłącznie regiony UE**. Rozważany OVHcloud (VPS). Prawnie region niemiecki jest równoważny polskiemu — EOG to jeden obszar, a żaden przepis nie narzuca tej aplikacji lokalizacji krajowej; region warszawski OVH bywa jednak łatwiejszy w rozmowie z klientem publicznym (kluby dotowane przez gminę). Kontraktować z **OVH SAS**, nie z OVHcloud US, który podlega CLOUD Act.
   - **Uwaga o obecnym stanie:** `.env` wskazuje Supabase. Supabase Inc. jest spółką amerykańską — nawet przy regionie w UE zdalny dostęp wsparcia z USA stanowi według EDPB przekazanie, wymagające standardowych klauzul umownych i oceny skutków przekazania. **Dopóki tak jest, sekcja 6 polityki („nie przekazujemy danych poza EOG") jest nieprawdziwa.** Przejście na własnego Postgresa na VPS w UE usuwa problem u źródła; alternatywa z zarządzaną bazą w pełni unijną to np. Aiven albo OVH Managed Databases.
   - Przy VPS-ie: załącznik 3 deklaruje kopie zapasowe, RPO 24 h / RTO 8 h, szyfrowanie w spoczynku i monitoring. Na gołym VPS-ie **nic z tego nie dzieje się samo** — to pozycje do wdrożenia, nie do zadeklarowania.
5. **Depozyt kodu źródłowego (escrow)** — § 16 ust. 15 regulaminu jest opcjonalny i oznaczony nawiasem. Decyzja: zostawić jako ofertę dla klientów wymagających podwyższonych gwarancji, czy usunąć do czasu, aż taki klient się pojawi. Realny koszt to kilka tysięcy złotych rocznie u powiernika, więc zwykle wprowadza się to dopiero pod konkretny kontrakt.
6. **Okresy retencji** — patrz niżej. Dziś nie są zaimplementowane.
7. **Limit odpowiedzialności** w § 14 regulaminu — kwota do decyzji biznesowej.
8. **Ubezpieczenie OC zawodowe / cyber** — nie jest wymogiem prawnym, ale § 14 czyta się zupełnie inaczej, gdy polisa istnieje.

## Proponowane okresy retencji (DO ZATWIERDZENIA I WDROŻENIA)

Polityka prywatności i umowa powierzenia **muszą** podawać okresy przechowywania. Poniższa tabela to propozycja z uzasadnieniem — nie odzwierciedla stanu kodu, bo dziś żadna tabela nie ma polityki usuwania (luka #11 w `CLAUDE.md`). Do wdrożenia zadaniem cyklicznym w `server/tasks/` (wzorzec już istnieje).

| Dane | Okres | Uzasadnienie |
|---|---|---|
| Konto (`user`, `account`) | Do usunięcia przez użytkownika + 30 dni | Bufor na cofnięcie omyłkowego usunięcia |
| Sesje (`session`) | Wygaśnięcie tokenu; usuwanie wygasłych co 30 dni | Brak celu po wygaśnięciu |
| Dane szkoły i uczniów | Czas trwania umowy + 30 dni na eksport, potem usunięcie | Art. 28 ust. 3 lit. g RODO |
| Dane rozliczeniowe (`payment_audit`, faktury) | **5 lat** od końca roku obrotowego | Art. 74 ust. 2 ustawy o rachunkowości |
| Zgody (`member_consent`, `user_consent`) | Czas obowiązywania + **3 lata** po wycofaniu | Art. 7 ust. 1 RODO — dowód legalności; 3 lata = termin przedawnienia roszczeń (art. 118 KC) |
| Dziennik zdarzeń (`audit_log`) | **3 lata** | Rozliczalność (art. 5 ust. 2) vs zasada ograniczenia przechowywania |
| Obecności (`attendance`) | Czas trwania umowy + 1 rok | Dane o dzieciach — krótko, bo cel wygasa z zakończeniem zajęć |
| Powiadomienia (`notification`) | **12 miesięcy** | Wartość operacyjna wygasa |

Uwaga do wiersza „dane rozliczeniowe": 5-letni obowiązek księgowy **będzie kolidował** z żądaniem usunięcia danych. To nie jest konflikt do rozstrzygnięcia w kodzie — art. 17 ust. 3 lit. b RODO wprost wyłącza prawo do usunięcia, gdy przetwarzanie jest niezbędne do wypełnienia obowiązku prawnego. Rozwiązanie: **anonimizacja zamiast usunięcia** (zachowaj kwotę, walutę i identyfikator Stripe, usuń imię i nazwisko). Struktura `payment_audit` już to umożliwia — kolumny są zdenormalizowane, bez kluczy obcych.

## Znane ryzyko wymagające decyzji produktowej

**Pola `notes` przyjmują dane o zdrowiu.** `member_profile.notes` i `member_guardian.notes` to wolny tekst. Trener wpisze tam „astma", „alergia na orzechy", „uraz kolana — bez serwisu". To dane szczególnej kategorii (art. 9 RODO), których przetwarzanie jest **zakazane**, chyba że zachodzi jeden z wyjątków z ust. 2 — przy szkole sportowej realnie tylko wyraźna zgoda (lit. a) albo ochrona żywotnych interesów (lit. c, wyłącznie w sytuacji nagłej).

Dokumenty rozwiązują to **umownie**: § 11 ust. 4 regulaminu zakazuje wprowadzania takich danych do pól opisowych, a załącznik 1 do umowy powierzenia wyłącza je z zakresu powierzenia. To przenosi odpowiedzialność na szkołę i jest zgodne z prawem, ale **nie powstrzyma nikogo przed wpisaniem**.

Rozwiązanie docelowe (rekomendowane, poza zakresem tej zmiany): osobne pole `medicalNotes` z własną podstawą (wyraźna zgoda opiekuna, nowy wpis w `CONSENT_TYPES`), węższym dostępem niż zwykłe `notes` i ostrzeżeniem w UI. Wtedy dane są tam, gdzie i tak trafią, ale w reżimie, który art. 9 dopuszcza.

## Czego te dokumenty NIE załatwiają

- **Ocena skutków dla ochrony danych (DPIA, art. 35)** — obowiązek ciąży na **szkole**, nie na Courtto. Przetwarzanie danych dzieci na dużą skalę znajduje się na liście UODO wymagającej DPIA. Szkoła bez wsparcia tego nie zrobi. Materiał pomocniczy dla szkół to osobny, wart zrobienia asset sprzedażowy.
- **Rejestr czynności przetwarzania (art. 30)** — Courtto potrzebuje własnego: rejestru czynności (jako administrator) i rejestru kategorii czynności (jako procesor). Do przygotowania osobno; załącznik 1 umowy powierzenia zawiera większość materiału.
- **Umowy z podprocesorami** — Stripe, Brevo i dostawca hostingu mają własne DPA, które trzeba **zaakceptować** (u Stripe i Brevo to zwykle checkbox w panelu). Nieakceptowany DPA podprocesora to luka w łańcuchu powierzenia.
- **Regulamin dla ucznia i opiekuna** — uczeń korzysta z `/my` na podstawie umowy ze **szkołą**, nie z Courtto. Jeśli kiedyś powstanie panel rodzica z osobnym logowaniem (luka #7), trzeba będzie zdecydować, czy rodzic zawiera umowę z Courtto — i wtedy dojdzie **regulamin konsumencki**, z zupełnie innym reżimem (prawo odstąpienia, klauzule niedozwolone, UOKiK).

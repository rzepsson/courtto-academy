# Courtto Academy

*[English](README.md)*

Multi-tenant SaaS dla szkół tenisa i innych sportów rakietowych: grafik, listy uczniów, obecności i płatności w jednym miejscu. Każda szkoła to osobny tenant.

Projekt poboczny, robiony sam. Zauważyłem brak takiego oprogramowania w mojej szkole tenisa, więc postanowiłem spróbować swoich sił i zbudować je w celach rozwojowych. Dodatkowo zrobiłem je jako system multi-tenant.

**Stack:** Nuxt 4 · Nuxt UI 4 (Tailwind v4) · Drizzle ORM + PostgreSQL · Better Auth (plugin organization) · Stripe · i18n (en/pl)

## Zrzuty ekranu

Kalendarz zajęć. W widoku tygodnia kolumnami są dni, w widoku dnia korty; lekcje przenosi się przeciągnięciem, a kliknięcie pustego miejsca otwiera formularz.

![Kalendarz zajęć](docs/screenshots/schedule.png)

Panel właściciela: stan osobowy, co się dzieje dzisiaj i jak obłożone były korty w tym tygodniu.

![Panel właściciela](docs/screenshots/dashboard.png)

Korty pogrupowane po strefach. Każdy narysowany zgodnie ze swoją dyscypliną — układ linii wynika z dyscypliny, zapisany jest tylko kolor nawierzchni.

![Korty](docs/screenshots/courts.png)

<details>
<summary>Logowanie</summary>

![Logowanie](docs/screenshots/login.png)

</details>

## Uruchomienie

```bash
pnpm install
cp .env.example .env    # wymaga tylko DATABASE_URL i BETTER_AUTH_SECRET
pnpm db:migrate
pnpm seed               # dwie przykładowe szkoły i inne przykładowe dane
pnpm dev
```

Seed wypisuje tabelę kont, hasło do każdego to `courtto123`. Stripe, S3 i SMTP są opcjonalne. Bez nich aplikacja pokazuje komunikat zamiast się wywalać, więc całość działa na samym Postgresie.

## Co zawiera aplikacja?

- **Multi-tenancy** - szkoła to organizacja w Better Auth. Każde zapytanie jest zawężone do id organizacji, a izolacja jest pokryta testami.
- **Role i obszary** - owner / admin / coach / student, każdy ma własną część aplikacji (`/school`, `/coach`, `/my`), pilnowaną i po stronie klienta, i serwera.
- **Grafik** - zajęcia cykliczne, gdzie czas jest trzymany jako godzina zegarowa plus strefa IANA i rozwiązywany osobno dla każdego wystąpienia, więc „w każdy poniedziałek o 17:00" zostaje 17:00 także po zmianie czasu.
- **Blokada kolizji** - podwójna rezerwacja kortu albo trenera jest blokowana przez postgresowe ograniczenia `EXCLUDE USING gist`, a nie tylko przez sprawdzenie w kodzie. Jeden z testów pisze prosto do tabeli, żeby udowodnić, że to baza jest realnym zabezpieczeniem.
- **Zapisy i obecności** - limit miejsc jest egzekwowany pod blokadą wiersza, więc dwa równoległe zapisy nie zajmą tego samego ostatniego miejsca. Nadmiar trafia na listę rezerwową, z której ktoś awansuje po rezygnacji.
- **Płatności** - dwa osobne przepływy: szkoły płacą abonament Courtto, a rodzice płacą szkołom za zajęcia przez Stripe Connect (płatności bezpośrednie, więc sprzedawcą jest szkoła i to ona wystawia fakturę).
- **RODO** - opiekunowie osób niepełnoletnich, zgody ze śladem audytowym i raport pokazujący, przy których uczniach czegoś jeszcze brakuje.

## Kilka decyzji, o których warto wspomnieć

**Wzorzec serwisów.** Każde zapytanie Drizzle siedzi w `server/utils/services/*`, a handlery API tylko wołają serwisy. Autoryzacja i zawężanie do tenanta zostają w jednym miejscu, zamiast rozłazić się po plikach routingu, co ma znaczenie, kiedy pominięte sprawdzenie oznacza jedną szkołę czytającą dane drugiej.

**Wspólna logika domenowa.** Schematy walidacji, uprawnienia i liczenie czasu leżą w `shared/` i są importowane i przez klienta, i przez serwer. Formularz nie rozjedzie się ze swoim endpointem, jeśli oba powstają z tego samego schematu.

**Wyliczane, nie zapisywane.** Zapisana flaga staje się nieaktualna w dniu urodzin, więc uprawnienie z subskrypcji, kompletność profilu i to, czy uczeń jest niepełnoletni, są liczone przy odczycie.

**Rdzeń oddzielony od Academy.** Korty, rezerwacje, organizacje i rozliczenia nie odwołują się do zajęć w żadnym miejscu. Na tym samym backendzie planuje kiedyś postawić bliźniaczy produkt - Courtto, w którym będzie można rezerwować np. wynajęcie kortu.

## Testy

```bash
pnpm test          # jednostkowe
pnpm test:server   # integracyjne
pnpm test:e2e      # Playwright
```

## Status

W trakcie rozwoju. Stripe nie jest podpięty do żywego konta, więc przepływy płatnicze działają na obiektach testowych.

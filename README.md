# TradingApp

Știri pentru zece companii mari listate în SUA, cu interfață română/engleză, rezumate AI și cercetare financiară generală. Node.js 24+, fără etapă de build frontend.

## Pornire

```sh
npm ci
npm run dev
```

`npm start` pornește fără watch, implicit pe `0.0.0.0:3000`. `PORT`, `HOST` și `DATA_PATH` sunt configurabile. Folosește checkout-ul existent în mediul cloud; nu este necesar un Git worktree. Pentru un cache npm inscriptibil: `npm ci --cache /workspace/.npm-cache`.

Fără chei API, știrile continuă prin Google News RSS, iar secțiunile neconfigurate explică lipsa datelor. Aplicația nu inventează rezumate, tranzacții sau recomandări. Modul demo se activează explicit și afișează exemple fictive.

## Funcții

- Selector RO/EN sus; preferința se păstrează în browser. Titlurile se traduc când există o generare validă; altfel sunt marcate ca fiind în limba sursei.
- Căutare după nume/simbol (`/` pentru focalizare), ordonare și filtre pe subiect.
- Rezumate în pagină, bazate exclusiv pe descrierile furnizate de API. Nu se pretinde acces la articolul integral. Pentru un titlu fără text, rezumatul este indisponibil.
- Fonduri urmărite: Berkshire Hathaway, Pershing Square și Bridgewater, prin raportări SEC 13F. Comparăm două perioade; ajustăm split-urile când datele sunt disponibile. Fără ajustări verificate afișăm numai deținerile brute și nu deducem direcția schimbării. Modificările de dețineri nu sunt tranzacții observate în timp real; alte operațiuni corporative pot necesita verificare manuală.
- Insideri: până la 12 raportări recente Form 4 / 4-A pentru fiecare companie. Codurile P/S sunt distincte de acordări, exercitări și alte operațiuni. Raportările rectificative sunt marcate, fără însumarea netă a originalelor și rectificărilor. Instrumentele derivate au un contor separat.
- Opinie AI generală „Cumpără / Păstrează / Vinde”, orizont 6–12 luni, cu argumente, riscuri și surse. Nu folosește portofoliul personal și nu execută tranzacții. Când datele sunt insuficiente sau vechi, verdictul devine „Date insuficiente”.

Nu există integrare XTB, autentificare, ordine de bursă sau prețuri în timp real garantate.

## Furnizori și configurare

Vezi [deploy/runtime.env.example](deploy/runtime.env.example) pentru numele variabilelor. Nu include valori reale în Git sau în frontend.

| Serviciu | Configurare | Utilizare |
|---|---|---|
| Finnhub | `FINNHUB_API_KEY`, `DATA_PROVIDER_TERMS_ACCEPTED=true` | Știri cu descrieri, cotații, indicatori și split-uri |
| OpenAI Responses API | `AI_API_KEY`, `AI_MODEL`, prețurile input/output | Rezumate bilingve și analiză generală |
| SEC EDGAR | `SEC_USER_AGENT` cu nume aplicație și email real de contact | Raportări 13F și Form 4 |

Folosește Finnhub numai cu un plan care permite accesul la endpoint-urile respective și afișarea datelor în aplicația ta. Nu se achiziționează automat abonamente. Endpoint-urile neincluse în plan sunt tratate ca indisponibile, fără înlocuirea lor cu date simulate. Documentație: [Finnhub](https://finnhub.io/docs/api), [SEC](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [OpenAI pricing](https://openai.com/api/pricing/).

AI este **dezactivat** până când există cheia și ambele prețuri pozitive `AI_INPUT_USD_PER_MILLION` / `AI_OUTPUT_USD_PER_MILLION`. Verifică prețurile oficiale curente pentru modelul ales (implicit `gpt-5-mini`) înainte de activare și la schimbarea lor. Sunt prețuri USD pentru UN MILION de tokeni; aplicația nu descarcă automat tarifele.

Pe VM, creează `/opt/tradingapp/runtime.env` pe baza exemplului, cu permisiuni `600`, deținut de utilizatorul care rulează Compose. Completează valorile securizat și aplică:

```sh
cd /opt/tradingapp
docker compose up -d --force-recreate --wait --wait-timeout 90
```

`runtime.env` este opțional pentru pornirea aplicației și nu este suprascris de deploy. Nu folosi `.env` pentru aceste chei: scriptul de deploy regenerează `.env` pentru imagine și port.

În dezvoltare, poți folosi `node --env-file=/cale/protejata/runtime.env server.js`; `npm start` citește variabilele deja exportate, nu încarcă implicit un fișier cu secrete.

## Actualizări, costuri și persistență

Un worker din server pornește după o secundă și verifică sarcinile o dată pe minut. Numai el face cereri către Finnhub și AI; vizitarea paginii sau schimbarea limbii nu generează costuri AI.

- Știri Finnhub: actualizare la șase ore pentru toate cele zece companii. Google News RSS de rezervă este preluat la cerere, cu cache de cinci minute și deduplicarea cererilor simultane.
- Rezumate: cel mult trei încercări noi pe companie/zi UTC, pentru primele trei descrieri prioritare; o generare produce ambele limbi. Alte articole pot rămâne fără rezumat. Rezumatele gata sunt reutilizate.
- Date SEC și analiză: actualizare zilnică. SEC este accesat serial, la cel mult patru cereri pe secundă, cu cache de o zi. Scanarea folosește raportările din lista `recent`; dacă nu sunt disponibile două perioade complete, nu inventează o comparație.
- Analiza cere o cotație de maximum cinci zile, un trimestru financiar de maximum 200 de zile și cel puțin trei indicatori numerici. Aceste praguri permit weekenduri și raportări trimestriale; nu reprezintă feed bursier în timp real. Analiza mai veche de două zile este marcată și verdictul activ este retras.
- `AI_MONTHLY_LIMIT_USD` poate micșora plafonul, dar nu îl poate crește peste **8 USD/lună UTC**, lăsând marjă în bugetul de 10 USD. Limitarea este pentru apelurile AI ale acestei aplicații; abonamentele furnizorilor și consumul altor aplicații cu aceeași cheie trebuie gestionate separat.
- Costul maxim estimat este rezervat tranzacțional înainte de apel, pe baza numărului de bytes, plafonului de output și tarifelor configurate. Utilizarea raportată ajustează rezervarea. La timeout fără utilizare confirmată, rezervarea rămâne și aceeași generare nu se repetă în aceeași zi. Plafonul depinde de corectitudinea tarifelor configurate; setează și notificările de facturare ale furnizorului.

SQLite păstrează snapshot-urile, cache-urile și registrul consumului. Local: `.local/tradingapp.sqlite`; în Docker: `/data/tradingapp.sqlite`, într-un volum numit `tradingapp_data`. Deploy-ul și rollback-ul păstrează volumul. Nu executa `docker compose down -v`: ar șterge inclusiv evidența bugetului. Pentru backup consistent, oprește aplicația și salvează întregul volum, inclusiv fișierele SQLite WAL/SHM dacă există. Versiunea inițială de schemă este aditivă.

## API

Toate endpoint-urile sunt GET. `ticker` este limitat la universul din `companies.js`, implicit `AAPL`. `lang` acceptă `ro` (implicit) sau `en`; valori invalide returnează 400.

- `/api/companies`: lista companiilor.
- `/api/news?ticker=AAPL&lang=ro`: articole, titlu original, rezumat localizat și stări `ready`, `no_text`, `not_configured`, `pending`, `budget_limited`, `unavailable`.
- `/api/investors?ticker=AAPL&lang=ro`: date brute cu coduri stabile, fonduri, insideri, linkuri și date de raportare; etichetele sunt traduse în browser.
- `/api/analysis?ticker=AAPL&lang=ro`: verdict stabil `buy|hold|sell|insufficient`, explicații localizate, dovezi, perioada financiară și timestamp-uri. Fără date configurate răspunde 200 cu starea explicită, nu cu un verdict inventat.
- `/api/health`: numai starea serverului; nu verifică accesul la furnizori.

## Rețea și validare live

Sunt necesare destinațiile HTTPS `news.google.com`, `finnhub.io`, `api.openai.com`, `data.sec.gov`, `www.sec.gov`. Proxy-urile moștenite și verificarea TLS rămân active. În mediul cloud curent accesul la documentația furnizorilor este refuzat de proxy; permite domeniile păstrând regulile existente. Acest lucru nu dovedește că VM-ul Hetzner are aceeași restricție.

Testele automate folosesc răspunsuri controlate și nu demonstrează accesul live ori drepturile unui abonament. După configurarea VM-ului, verifică logurile, rezultatele endpoint-urilor și sursele afișate. Prima actualizare SEC poate dura câteva minute; un eșec produce o stare explicită sau păstrează datele vechi marcate. Nicio cheie nu este returnată de API sau scrisă în loguri.

## Teste și deploy

```sh
npm test
npm run test:browser
npm audit
```

Playwright folosește `/usr/bin/chromium`, dacă există; alternativ `npx playwright install --with-deps chromium`. `CHROMIUM_PATH` selectează un browser existent.

Testele acoperă RSS, AI invalid/indisponibil, buget persistent și cereri concurente, date financiare expirate, raportări rectificative SEC, split-uri, XSS, limbă persistentă, rezumate și cercetare pe desktop/mobil. CI rulează testele, construiește containerul și verifică sănătatea lui înainte de deploy.

[Deploy pe Hetzner](deploy/README.md): push pe `main` după testare declanșează deploy-ul când `DEPLOY_ENABLED=true`. Cheile API se configurează separat pe VM. Nu este necesar un domeniu pentru configurația HTTP existentă.

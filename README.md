# TradingApp

Știri pentru zece companii mari listate în SUA și crypto (piața generală, Bitcoin, Ethereum, Solana), cu interfață română/engleză, fragmente din descrierile surselor și semnale explicabile pe indicatori financiari. Node.js 24+, fără etapă de build frontend.

## Pornire

```sh
npm ci
npm run dev
```

`npm start` pornește fără watch, implicit pe `0.0.0.0:3000`. `PORT`, `HOST` și `DATA_PATH` sunt configurabile. Folosește checkout-ul existent în mediul cloud; nu este necesar un Git worktree. Pentru un cache npm inscriptibil: `npm ci --cache /workspace/.npm-cache`.

Fără chei API, știrile continuă prin Google News RSS, iar secțiunile neconfigurate explică lipsa datelor. Aplicația afișează știri din surse reale și marchează explicit lipsa datelor. Modul demo se activează explicit și afișează exemple fictive.

## Funcții

- Selector RO/EN sus; preferința se păstrează în browser. Titlurile se traduc când există o generare validă; altfel sunt marcate ca fiind în limba sursei.
- Căutare după nume/simbol (`/` pentru focalizare), ordonare și filtre pe subiect.
- Titluri și fragmente din descrierile surselor, în limba originală. Fiecare listă afișează maximum zece știri relevante din ultimele 24 de ore, clasate după subiect și recență.
- Articolele despre același eveniment sunt grupate într-un card cu surse secundare. Clasarea include tipul sursei și importanța evenimentului.
- Grafice pe 1 zi, 1 săptămână și 1 lună, cu linkuri către evenimente pe axa timpului. Serverul păstrează până la 30 de zile de cotații Finnhub înregistrate orar. Graficul încorporat TradingView oferă istoricul în intervalele pentru care aplicația încă nu are suficiente cotații și afișează capitalizarea totală pentru secțiunea Crypto.
- Favoritele și tipurile de alerte sunt salvate în browser. Alertele noi sunt afișate în aplicație când aceasta este deschisă.
- Filtrul după publicație este salvat în browser. Aplicarea lui reface selecția și gruparea știrilor, cu preluare RSS suplimentară când sursele excluse lasă puține rezultate.
- Calendarul afișează evenimente pe următoarele 90 de zile pentru simbolul selectat, favorite sau întreaga listă. Rezultatele estimate vin din Finnhub. Dividendele confirmate sunt preluate din anunțurile Microsoft și NVIDIA. Calendarul crypto folosește programările publicate de Bitcoin Core, Ethereum Consensus Specs și Anza.
- Fonduri urmărite: Berkshire Hathaway, Pershing Square și Bridgewater, prin raportări SEC 13F. Comparăm două perioade; ajustăm split-urile când datele sunt disponibile. Fără ajustări verificate afișăm numai deținerile brute și nu deducem direcția schimbării. Modificările de dețineri nu sunt tranzacții observate în timp real; alte operațiuni corporative pot necesita verificare manuală.
- Insideri: până la 12 raportări recente Form 4 / 4-A pentru fiecare companie. Codurile P/S sunt distincte de acordări, exercitări și alte operațiuni. Raportările rectificative sunt marcate, fără însumarea netă a originalelor și rectificărilor. Instrumentele derivate au un contor separat.
- Semnal „Cumpără / Așteaptă / Evită cumpărarea”, orizont 6–12 luni, calculat prin reguli transparente. Afișează indicatorii, punctele, pragurile și sursa. Nu folosește portofoliul personal și nu execută tranzacții. Când datele sunt insuficiente sau vechi, verdictul devine „Date insuficiente”.

Nu există integrare XTB, autentificare, ordine de bursă sau prețuri în timp real garantate.

## Furnizori și configurare

Vezi [deploy/runtime.env.example](deploy/runtime.env.example) pentru numele variabilelor. Nu include valori reale în Git sau în frontend.

| Serviciu | Configurare | Utilizare |
|---|---|---|
| Finnhub | `FINNHUB_API_KEY`, `DATA_PROVIDER_TERMS_ACCEPTED=true` | Știri cu descrieri, cotații, indicatori și split-uri |
| SEC EDGAR | `SEC_USER_AGENT` cu nume aplicație și email real de contact | Raportări 13F și Form 4 |

Folosește Finnhub numai cu un plan care permite accesul la endpoint-urile respective și afișarea datelor în aplicația ta. Nu se achiziționează automat abonamente. Endpoint-urile neincluse în plan sunt tratate ca indisponibile, fără înlocuirea lor cu date simulate. Documentație: [Finnhub](https://finnhub.io/docs/api), [SEC](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).



Pe VM, creează `/opt/tradingapp/runtime.env` pe baza exemplului, cu permisiuni `600`, deținut de utilizatorul care rulează Compose. Completează valorile securizat și aplică:

```sh
cd /opt/tradingapp
docker compose up -d --force-recreate --wait --wait-timeout 90
```

`runtime.env` este opțional pentru pornirea aplicației și nu este suprascris de deploy. Nu folosi `.env` pentru aceste chei: scriptul de deploy regenerează `.env` pentru imagine și port.

În dezvoltare, poți folosi `node --env-file=/cale/protejata/runtime.env server.js`; `npm start` citește variabilele deja exportate, nu încarcă implicit un fișier cu secrete.

## Actualizări și persistență

Un worker din server verifică sarcinile o dată pe minut și preia știrile o dată pe oră.

- Finnhub furnizează știri pentru companii și crypto. Fluxurile RSS servesc ca rezervă și sunt preluate cel mult o dată pe oră după o preluare reușită. Comunicatele NVIDIA Newsroom sunt incluse în lista Nvidia.
- Datele SEC și semnalul financiar au actualizare zilnică. Pagina verifică automat starea analizei la 15 secunde cât timp datele sunt în pregătire. SEC este accesat serial, la cel mult patru cereri pe secundă, cu cache de o zi.
- Analiza cere o cotație de maximum cinci zile, un trimestru financiar de maximum 200 de zile și cel puțin trei indicatori numerici. Aceste praguri permit weekenduri și raportări trimestriale; nu reprezintă feed bursier în timp real. Analiza mai veche de două zile este marcată și verdictul activ este retras.

SQLite salvează datele preluate local în `.local/tradingapp.sqlite` și în Docker în `/data/tradingapp.sqlite`, în volumul `tradingapp_data`. Pentru backup consistent, oprește aplicația și salvează întregul volum, inclusiv fișierele SQLite WAL/SHM dacă există.

## API

Toate endpoint-urile sunt GET. `ticker` este limitat la universul din `companies.js`, implicit `AAPL`. `lang` acceptă `ro` (implicit) sau `en`; valori invalide returnează 400.

- `/api/companies`: lista companiilor.
- `/api/news?ticker=AAPL&lang=ro`: cel mult zece articole, cu titlu original și câmpul `sourceExcerpt` când sursa furnizează o descriere.
- `/api/prices?ticker=BTC&period=1d`: cotații înregistrate, evenimente arhivate și simbolul pentru graficul încorporat. Intervale acceptate: `1d`, `1w`, `1m`.
- `/api/news?ticker=AAPL&hide=yahoo&officialOnly=1`: filtre opționale după publicație și tipul sursei. Parametrul `hide` poate fi repetat.
- `/api/calendar?tickers=MSFT,NVDA,CRYPTO`: datele publicate și sursele indisponibile. Calendarul păstrează ultimele date reușite în cache pentru eventuale întreruperi.
- `/api/investors?ticker=AAPL&lang=ro`: date brute cu coduri stabile, fonduri, insideri, linkuri și date de raportare; etichetele sunt traduse în browser.
- `/api/analysis?ticker=AAPL&lang=ro`: `buyDecision=buy|wait|avoid|insufficient`, `engine=rules-v1`, scor, criterii, explicații localizate, surse și timestamp-uri. Câmpul `verdict=buy|hold|sell|insufficient` este păstrat pentru compatibilitate; `sell` din acest filtru înseamnă evitarea unei noi achiziții, nu un ordin de vânzare. Fără date configurate răspunde 200 cu starea explicită, nu cu un verdict inventat.
- `/api/health`: numai starea serverului; nu verifică accesul la furnizori.

## Rețea și validare live

Sursele folosesc HTTPS. Pentru Finnhub și SEC sunt necesare destinațiile `finnhub.io`, `data.sec.gov` și `www.sec.gov`. Fluxurile de știri folosesc `news.google.com`, `nvidianews.nvidia.com`, `www.coindesk.com`, `cointelegraph.com` și `decrypt.co`.

Testele automate folosesc răspunsuri controlate și nu demonstrează accesul live ori drepturile unui abonament. După configurarea VM-ului, verifică logurile, rezultatele endpoint-urilor și sursele afișate. Prima actualizare SEC poate dura câteva minute; un eșec produce o stare explicită sau păstrează datele vechi marcate. Nicio cheie nu este returnată de API sau scrisă în loguri.

## Teste și deploy

```sh
npm test
npm run test:browser
npm audit
```

Playwright folosește `/usr/bin/chromium`, dacă există; alternativ `npx playwright install --with-deps chromium`. `CHROMIUM_PATH` selectează un browser existent.

Testele acoperă fluxurile RSS, selecția știrilor și fragmentele din sursă, datele financiare expirate, raportările SEC și interfața mobilă și desktop. CI rulează testele și verifică sănătatea containerului înainte de deploy.

[Deploy pe Hetzner](deploy/README.md): push pe `main` după testare declanșează deploy-ul când `DEPLOY_ENABLED=true`. Cheile API se configurează separat pe VM. Nu este necesar un domeniu pentru configurația HTTP existentă.

### Dacă lipsesc datele financiare

În `/api/analysis?ticker=AAPL&lang=ro`, starea `not_configured` afișează numele setărilor lipsă. Semnalul cere acces la datele Finnhub și `DATA_PROVIDER_TERMS_ACCEPTED=true`.

`unavailable` include un cod pentru cheia respinsă, acces nepermis, cotă, timeout sau indisponibilitatea furnizorului. Cererile de date financiare eșuate sunt reluate după cinci minute.

Pe VM, după configurarea securizată a `runtime.env`, aplică `docker compose up -d --force-recreate --wait --wait-timeout 90`. Prezența unei variabile nu dovedește că cheia este validă ori că abonamentul permite endpoint-urile; verifică și starea returnată de API.


## Regulile semnalului de cumpărare

Semnalul necesită `FINNHUB_API_KEY` și `DATA_PROVIDER_TERMS_ACCEPTED=true`, cu acces la cotații și Basic Financials. Calculul se actualizează zilnic.

| Indicator | +1 | 0 | −1 |
|---|---|---|---|
| Creșterea anuală a veniturilor | ≥10% | ≥0% și <10% | <0% |
| Creșterea anuală a profitului pe acțiune | ≥10% | ≥0% și <10% | <0% |
| P/E pe ultimele 12 luni | >0 și ≤25 | >25 și ≤40 | >40 |

**Cumpără**: scor ≥+2, fără venituri sau EPS în scădere. **Evită cumpărarea**: scor ≤−2. **Așteaptă**: celelalte scoruri. Scorul nu este o probabilitate de câștig. Datele lipsă, expirate, nefinite sau P/E nepozitiv produc „Date insuficiente”; o companie fără profit nu este declarată automat ieftină.

Aceste praguri sunt o euristică fără validare istorică, nu o strategie completă. Nu iau în calcul datoria, fluxul de numerar, diferențele dintre sectoare, evoluția viitoare sau situația personală. Linkul „Semnal de cumpărare” de lângă companie duce la explicații și tabelul complet, în RO/EN. Rezultatele vechi care conțin indicatori financiari valizi sunt recalculate cu regulile curente pe baza indicatorilor stocați.

## Știri crypto

Secțiunea Crypto folosește Finnhub și, ca rezervă, fluxurile CoinDesk, Cointelegraph, Decrypt și Google News. Când este disponibilă, descrierea sursei este afișată ca fragment în limba originală.

`GET /api/crypto` listează activele; `/api/news?ticker=CRYPTO|BTC|ETH|SOL&lang=ro|en` returnează știrile. Endpoint-urile de analiză și investitori rămân limitate la companii.

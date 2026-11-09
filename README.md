# TradingApp

Prima secțiune a aplicației: știri relevante despre companii mari listate în SUA, cu interfață în română, adaptată pentru desktop și mobil.

## Pornire

Necesită **Node.js 24+** și npm. Nu necesită bază de date sau chei API.

```sh
npm ci
npm run dev
```

Aplicația ascultă pe portul `3000`. `npm start` pornește serverul fără watch. Poți seta `PORT` și `HOST` prin mediul procesului.

Folosește checkout-ul existent în mediul cloud; nu este necesar un Git worktree. Dacă directorul implicit de cache npm nu este inscriptibil, folosește `npm ci --cache /workspace/.npm-cache`.

## Funcționalități

- 10 companii: Apple, Microsoft, NVIDIA, Alphabet, Amazon, Meta, Tesla, JPMorgan Chase, Berkshire Hathaway și Eli Lilly.
- Căutare după companie sau simbol bursier; scurtătura `/` focalizează căutarea.
- Știri din Google News RSS pentru ultimele șapte zile; titlurile rămân în limba sursei.
- Sursă, data publicării și legătură către articol prin Google News, într-o filă nouă.
- Filtre pe subiect și ordonare după importanță sau dată.
- Stări de încărcare, lipsă de rezultate și eroare; reluarea cererii și mod demonstrativ explicit, activat numai de utilizator.

„Importanța” este o euristică transparentă: cuvinte-cheie din titlu pentru rezultate financiare, reglementări, tranzacții și produse, plus un bonus de recență. Nu reprezintă analiză editorială umană, sentiment sau recomandare de tranzacționare. Lista companiilor este o selecție inițială, nu un clasament dinamic după capitalizare.

## Sursa de știri și rețeaua

Serverul trebuie să poată accesa **`https://news.google.com`** pentru RSS. Browserul comunică doar cu serverul aplicației. `undici` respectă variabilele de proxy moștenite și verifică TLS. Nu sunt necesare credențiale.

În mediul cloud inițial, proxy-ul a refuzat această destinație cu HTTP 403 la CONNECT. Permite domeniul `news.google.com` în setările de rețea ale mediului, păstrând regulile existente, apoi repornește serverul și reîncearcă. Linkurile către publicații se deschid în browserul cititorului.

RSS-ul este păstrat în memoria procesului cinci minute pentru fiecare companie. Butonul „Actualizează” reîncarcă datele disponibile, respectând cache-ul. Cererile simultane pentru aceeași companie folosesc aceeași preluare. Dacă sursa eșuează după o preluare reușită, datele păstrate sunt afișate cu avertizare și ora ultimei preluări. Cache-ul dispare la restart. Nu există încă actualizare automată, autentificare, portofoliu, cotații sau tranzacții.

Exemplele din modul demonstrativ sunt fictive, nu au dată de publicare și nu trimit la publicații reale.

## Verificări

```sh
npm test
npm run test:browser
npm audit
```

Testele Node verifică procesarea RSS, deduplicarea, clasificarea, linkurile, datele, eliminarea știrilor fără legătură și API-ul HTTP. Testele Playwright verifică desktop și mobil, căutarea, schimbarea companiei, ordonarea, filtrele, tratarea erorilor și a titlurilor neîncrezute, plus demonstrația.

Playwright folosește Chromium din `/usr/bin/chromium`, dacă există. Altfel instalează-l cu `npx playwright install chromium`; pe Linux poți avea nevoie de `npx playwright install --with-deps chromium`. `CHROMIUM_PATH` permite indicarea unui browser existent. CI este configurat în `.github/workflows/ci.yml`.

Testele de browser folosesc răspunsuri API controlate. Nu demonstrează accesul la sursa RSS live. Pentru verificarea reală după configurarea rețelei, pornește serverul și solicită `/api/news?ticker=AAPL`: răspunsul trebuie să fie HTTP 200 și să conțină articole actuale cu `fetchedAt`, surse și linkuri valide. `/api/health` verifică numai serverul local, nu accesul la furnizor.

## Structură

- `server.js`: server HTTP, API RSS, proxy și cache.
- `news.js`: procesarea și prioritizarea articolelor.
- `companies.js`: universul inițial de companii și termenii de căutare.
- `public/`: interfață HTML, CSS și JavaScript fără framework.
- `test/`: teste Node și Playwright.

Nu există o etapă de build; serverul livrează direct fișierele din `public/`.

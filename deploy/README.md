# Deploy pe un VM Hetzner, fără domeniu

Flux: push pe `main` → teste Node și Playwright → imagine Docker → transfer SSH → Docker Compose. Aplicația este accesibilă la `http://IP_VM` pe portul 80. Nu necesită registry sau token GitHub pe VM. Pe `pull_request` se execută numai testele. Deploy-ul este dezactivat până când variabila `DEPLOY_ENABLED` are valoarea `true`.

## 1. Pregătește VM-ul

Rulează pe VM, ca `andrei`. Aceste comenzi folosesc pachetele Ubuntu și nu adaugă un repository Docker extern, care ar putea să nu suporte încă versiunea Ubuntu instalată.

```bash
sudo apt-get update
apt-cache policy docker.io docker-compose-v2
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker andrei
sudo install -d -m 0750 -o andrei -g andrei /opt/tradingapp
uname -m
```

Deconectează-te și reconectează-te prin SSH pentru activarea grupului, apoi verifică:

```bash
docker version
docker compose version
docker run --rm hello-world
sudo ss -ltnp '( sport = :80 )'
```

Dacă portul 80 este ocupat, păstrează serviciul existent și alege alt port, de exemplu `8080`, prin variabila GitHub `APP_PORT`. Directorul `/opt/FirstApp` nu este modificat: deploy-ul folosește `/opt/tradingapp`.

Apartenența la grupul `docker` oferă privilegii echivalente cu root. Folosește o cheie SSH dedicată numai acestui repository și protejează accesul de scriere pe `main`.

Dacă apt nu oferă un candidat pentru unul dintre pachete, oprește instalarea și verifică repository-urile Ubuntu configurate; nu instala pachete de la altă versiune Ubuntu.

## 2. Creează cheia de deploy

Pe VM, ca `andrei`:

```bash
install -d -m 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/tradingapp_actions -C github-actions-tradingapp
```

Alege o parolă goală pentru această cheie de automatizare. Dacă fișierul există deja, nu îl suprascrie. Adaugă cheia publică și păstrează celelalte chei autorizate:

```bash
cat ~/.ssh/tradingapp_actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Conținutul fișierului `~/.ssh/tradingapp_actions` va fi introdus exclusiv în secretul GitHub `SSH_PRIVATE_KEY`, niciodată în repository sau chat. După salvarea în GitHub, păstrează cheia privată într-un loc sigur și elimină copia de pe VM dacă nu mai este necesară.

Pentru verificarea identității serverului, rulează în sesiunea SSH de încredere sau consola Hetzner, înlocuind `IP_VM` cu IP-ul public:

```bash
awk '{print "IP_VM " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

Rezultatul este cheia PUBLICĂ a serverului, în format `known_hosts`, pentru secretul `SSH_KNOWN_HOSTS`. Nu folosi o cheie privată a serverului. Pentru un port SSH diferit de 22, înlocuiește `IP_VM` din comandă cu `[IP_VM]:PORT_SSH`.

## 3. Configurează GitHub Actions

În repository → **Settings → Secrets and variables → Actions → Secrets**, adaugă:

| Secret | Valoare |
|---|---|
| `SSH_HOST` | IP-ul public IPv4 al VM-ului, fără `http://` |
| `SSH_USER` | `andrei` |
| `SSH_PORT` | Portul SSH; opțional, implicit `22` |
| `SSH_PRIVATE_KEY` | Întreaga cheie privată de deploy, inclusiv liniile BEGIN/END |
| `SSH_KNOWN_HOSTS` | Linia cu IP și cheia publică a serverului, obținută mai sus |

În aceeași pagină → **Variables**, adaugă:

| Variabilă | Valoare |
|---|---|
| `DEPLOY_ENABLED` | `true`, numai după pregătirea VM-ului și secretelor |
| `APP_PORT` | Opțional, implicit `80` |
| `DEPLOY_PLATFORM` | Implicit `linux/amd64` pentru `uname -m` = `x86_64`; setează `linux/arm64` pentru `aarch64` |

Permite portul SSH pentru runner și portul aplicației în firewall-ul Hetzner. Runnerele GitHub standard au IP-uri variabile; dacă SSH este limitat la IP-ul tău, conexiunea Actions nu va funcționa fără o soluție de acces dedicată. Nu dezactiva verificarea cheii serverului. Docker publică porturi prin propriile reguli; nu te baza exclusiv pe UFW pentru a restricționa portul publicat. Nu expune API-ul Docker în rețea.

## 4. Declanșează primul deploy

După setări, un push pe `main` va declanșa deploy-ul. Pentru primul deploy poți crea un commit gol dintr-un checkout local:

```bash
git switch main
git pull --ff-only
git commit --allow-empty -m "Trigger initial Hetzner deployment"
git push origin main
```

Urmărește workflow-ul **Checks**, joburile `test` și `deploy`, în fila **Actions**. Imaginea este etichetată cu SHA-ul commit-ului. Jobul nu rulează pentru alte ramuri sau pull requests. Deploy-urile sunt serializate; nu se întrerupe un deploy în curs la un push nou.

Verificare pe VM:

```bash
cd /opt/tradingapp
docker compose ps
docker compose logs --tail=100
curl --fail http://127.0.0.1/api/health
curl --fail 'http://127.0.0.1/api/news?ticker=AAPL'
```

Dacă ai ales alt port, adaugă-l în URL. În browserul tău deschide `http://IP_VM` (sau `http://IP_VM:8080`). Healthcheck-ul confirmă numai serverul, nu furnizorul RSS. Verifică separat știrile live și accesul outbound HTTPS/DNS către Google News.

## Operare și rollback

Compose pornește aplicația la reboot prin `restart: unless-stopped`; Docker este activat prin systemd. Restartul unei singure instanțe poate produce o scurtă întrerupere. Nu există HTTPS în această configurație pe IP.

Dacă noul container nu trece healthcheck-ul în 90 de secunde, scriptul încearcă restaurarea versiunii anterioare și marchează deploy-ul eșuat. Primul deploy nu are o versiune anterioară. Rollback manual (dacă fișierele există):

```bash
cd /opt/tradingapp
cp .env.previous .env
cp compose.previous.yml compose.yml
docker compose up -d --wait --wait-timeout 90
```

Imaginile vechi nu sunt șterse automat, pentru a permite rollback. Verifică periodic `docker system df` și elimină selectiv versiunile de care nu mai ai nevoie; nu elimina imaginea activă sau cea de rollback. Arhiva transferată este ștearsă după deploy. Dacă transferul SSH se întrerupe înainte de executarea scriptului, pot rămâne directoare `incoming.*` de curățat manual.

Nu adăuga autentificare sau date sensibile pe această conexiune HTTP; configurează HTTPS înainte de acea etapă.

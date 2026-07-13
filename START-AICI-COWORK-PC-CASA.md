# PREDARE către Cowork-ul de pe PC-ul cu casa de marcat

Salut! Acest folder (`zion-bridge`) e aplicația desktop „podul" care leagă aplicația web
**Zion Suite** (online) de **casa fiscală Datecs** și de **imprimantele termice** de bar/bucătărie.
Rulezi pe **PC-ul Windows din restaurant** (același pe care e casa). Mai jos ai exact ce ai de făcut.

---

## 0. Ce trebuie să obții (scopul)
Pod-ul instalat și pornit pe acest PC, conectat la cloud, care:
- scoate automat **bonul fiscal** pe casa Datecs când se închide o notă cu numerar/card;
- tipărește **bonurile de comandă** pe imprimanta de bucătărie și pe cea de bar.

## ⚠️ Foarte important (de citit întâi)
- **NU modifica podul pentru migrarea pe Postgres.** Recent am mutat baza de date a aplicației
  web de pe Netlify Blobs pe Postgres (Neon). Podul **nu are treabă** cu asta — vorbește cu
  **același API** (`https://zion-pay.netlify.app/api/db`), iar endpoint-urile lui
  (`fiscalQueue`, `printQueue`, `fiscalAck`, `printAck`) funcționează exact la fel. Nu schimba cod.
- **ÎNCHIDE orice alt program care vorbește cu casa** (vechiul POS etc.) înainte de teste.
  Portul casei Datecs acceptă **un singur client** — asta e cauza nr.1 de eșec la conectare.
- Podul nu scoate niciodată **bonuri duble** (are memorie anti-duplicare pe disc), deci poți
  reporni aplicația fără grijă.

---

## 1. Precondiții (verifică înainte)
1. PC-ul e pe **aceeași rețea** (LAN/Wi-Fi) cu casa Datecs și cu imprimantele.
2. **DUDE** (Datecs Universal Driver Engine) e instalat pe PC. (Butonul „Detectează DUDE" din pod confirmă.)
3. **BRIDGE_KEY** există în Netlify → site `zion-pay` → Environment variables. E o parolă lungă,
   inventată de proprietar. Dacă **nu** există acolo, podul va fi refuzat („Cheie respinsă").
   → Dacă lipsește, owner-ul o adaugă în Netlify (valoare lungă, aleatorie) și dă redeploy.
   Vei pune **exact aceeași valoare** în Setările podului. (Eu, agentul, NU văd această cheie —
   o introduce un om.)

## 2. Instalare (pas cu pas)
1. **Node.js** — dacă nu e instalat: descarcă LTS de pe https://nodejs.org → Next-Next-Finish.
2. **Dublu-click pe `build.bat`** din acest folder. Prima rulare durează câteva minute
   (descarcă dependențe), apoi produce installer-ul în `dist\`.
3. Rulează **`dist\ZionBridge-Setup-2.0.0.exe`**. Aplicația pornește singură, direct pe **Setări**.
4. Completează Setările (valorile mai jos) → **Salvează**.

> Pentru test rapid fără instalare poți rula `dev.bat` (pornește aplicația direct).
> Update viitor: rulezi noul installer **peste** cel vechi — setările/logurile se păstrează.

## 3. Valori pentru Setări (implicite — confirmă-le la fața locului)
- **BRIDGE_KEY**: aceeași valoare ca în Netlify (vezi precondiția 3). OBLIGATORIE.
- **Adresa aplicației (apiUrl)**: `https://zion-pay.netlify.app/api/db` (deja pusă, las-o așa).
- **Casa fiscală:**
  - Mod: **TCP** (implicit). IP `192.168.0.71`, port `3999`.
  - Operator `1`, parolă `0001`, AMEF `1`.
  - Dacă casa NU e pe rețea ci pe **cablu serial/USB**: schimbă modul pe **Serial** și pune portul
    COM corect (îl vezi în Windows → Device Manager → „Ports (COM & LPT)", ex. COM3), baud `115200`.
- **Imprimante** (ESC/POS, port 9100):
  - `bucatarie` → IP-ul imprimantei de bucătărie (implicit `192.168.0.50`)
  - `bar` → IP-ul imprimantei de bar (implicit `192.168.0.51`)
  - Butonul „Caută imprimante în rețea (9100)" le găsește singur dacă IP-urile diferă.

## 4. Secvența de test (în ordine)
1. **Detectează DUDE** → trebuie să confirme că DUDE e instalat.
2. **Caută casa în rețea** (dacă IP-ul nu e `.71`) → **Test conexiune casă**.
3. **Test bon fiscal** → scoate un bon REAL de `0.01 lei` pe casă. Dacă iese → fiscalul merge.
4. **Test imprimantă** la fiecare stație (bar, bucătărie) → iese câte un bon de probă.
5. **Test end-to-end:** din aplicația web fă o comandă mică (un produs de bar + unul de bucătărie),
   trimite-o la secții → trebuie să iasă **două bonuri de comandă** (fiecare la stația lui).
   Apoi închide nota cu numerar → în câteva secunde trebuie să iasă **bonul fiscal**, iar în
   Status apare „Bonuri azi: 1".

## 5. Depanare rapidă
| Simptom | Cauză probabilă | Fix |
|---|---|---|
| „Cheie respinsă" (cloud roșu) | BRIDGE_KEY ≠ Netlify | pune exact aceeași valoare în Setări |
| „open_Connection a eșuat" | alt program ține portul / IP greșit / casă oprită | închide vechiul POS; „Caută casa în rețea" |
| „parolă greșită" → modul pe pauză | parola operator | corecteaz-o în Setări; se reia singur |
| Imprimantă „refuză conexiunea" | IP/port greșit | „Caută imprimante în rețea (9100)" |
| „DNS eșuat" | internet picat pe PC | verifică conexiunea |

Loguri: tray → „Deschide folderul cu loguri" (`bridge.log`). Pentru detalii: activează
„Log detaliat (debug)" în Setări. Detalii complete: vezi `README.md` din acest folder.

## 6. Ce să raportezi înapoi (după ce termini)
- Casa: mod folosit (TCP sau Serial) și dacă „Test bon fiscal" a ieșit (DA/NU + textul erorii dacă NU).
- Imprimante: ce IP-uri au bucătăria și barul și dacă testele au ieșit.
- Dacă a apărut vreo eroare: copiază textul exact din `bridge.log`.

Singura piesă nevalidată fizic până acum a fost bonul fiscal pe casa reală — restul sistemului
(web + comenzi + Postgres) e testat și funcțional. Succes!

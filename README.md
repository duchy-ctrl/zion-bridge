# Zion Bridge

Aplicația desktop care înlocuiește cele 2 scripturi PowerShell („podul"): ia notele închise
și comenzile din **Zion Suite** (cloud) și le tipărește pe **casa Datecs** (prin DUDE) și pe
**imprimantele termice** de bar/bucătărie. Stă în system tray, repornește singură conexiunile,
nu dublează bonuri.

## Instalare (pe PC-ul din restaurant)

1. **Node.js** — dacă nu e instalat: [nodejs.org](https://nodejs.org), descarcă versiunea **LTS**, Next-Next-Finish.
2. **Dublu-click pe `build.bat`** din acest folder. Prima rulare durează câteva minute
   (descarcă dependențele), apoi produce installerul.
3. Rulează **`dist\ZionBridge-Setup-<versiune>.exe`**. Aplicația pornește singură după instalare.
4. La prima pornire se deschide pe **Setări**: completezi **BRIDGE_KEY (obligatorie —
   aceeași valoare ca în Netlify → Environment variables)**, datele casei,
   IP-urile imprimantelor → **Salvează**.
5. Folosește butoanele **Test conexiune casă**, **Test bon fiscal**, **Test imprimantă** ca să verifici tot.

> Alternativ, pentru testat fără instalare: `dev.bat` (rulează aplicația direct).

## Update la o versiune nouă (fără reconstrucție de la zero)

1. Pe PC-ul unde e codul: rulezi din nou `build.bat`. După prima rulare e **incremental**
   (~1 minut) — dependențele rămân în `node_modules`, nu se descarcă iar.
2. Rulezi noul installer **peste** versiunea veche, pe PC-ul din restaurant. Atât.
   - **Setările, memoria anti-duplicare și logurile se păstrează automat** — sunt în
     `%APPDATA%\zion-bridge`, nu în folderul aplicației.
   - Nu dezinstala versiunea veche înainte; over-install e modul corect.
3. Dacă vrei să schimbi versiunea afișată: editează `"version"` din `package.json` înainte de build.

## Adăugarea unei imprimante noi

Setări → **„+ Adaugă imprimantă"** → completezi numele stației, IP-ul și portul → Salvează → **Test**.
Numele stației trebuie să corespundă cu cel folosit în aplicația web (potrivirea ignoră
diacriticele și majusculele: „Bucătărie" = „bucatarie"). Dacă serverul trimite un job pentru
o stație necunoscută podului, bonul tot se tipărește (IP-ul vine în job) și stația apare
automat în Status.

## Cerințe pe PC

- Windows 10/11, în aceeași rețea cu casa și imprimantele.
- **DUDE** (Datecs Universal Driver Engine) instalat — butonul „Detectează DUDE" verifică.
- Vechiul POS / alte programe care vorbesc cu casa trebuie ÎNCHISE (portul casei acceptă un singur client).

## Cum funcționează (pe scurt)

- Două bucle independente interoghează cloud-ul la ~4s: `fiscalQueue` și `printQueue`.
- Fiecare job primește **mereu** un Ack (reușit/eșuat). Dacă Ack-ul nu ajunge (net picat),
  e salvat pe disc și retrimis — iar jobul e ținut minte ca „procesat", deci **nu se
  retipărește** niciodată dublu, nici după repornirea aplicației.
- Erorile de rețea fac backoff exponențial (4s → 30s) și revin singure.
- Parolă de operator greșită → modulul fiscal **se oprește singur** (casa blochează operatorul
  după încercări repetate) și primești notificare; corectezi în Setări și se reia automat.
- COM-ul DUDE e accesat printr-un proces PowerShell ascuns — fără module native, fără
  Visual Studio, fără ferestre negre.

## Depanare rapidă

| Simptom | Cauză probabilă | Fix |
|---|---|---|
| Cloud roșu: „DNS eșuat" | net picat pe PC | verifică internetul |
| Cloud roșu: „Cheie respinsă" | BRIDGE_KEY diferit de Netlify | corectează în Setări |
| Casă: „open_Connection a eșuat" | casă oprită / IP greșit / **alt program ține portul** | închide vechiul POS; „Caută casa în rețea" |
| Casă: „parolă greșită" → pauză | parolă operator | corecteaz-o, modulul se reia singur |
| Eroare -112001 | parametri comandă invalizi | trimite-mi logul (Diagnostic → folder loguri) |
| Imprimantă: „refuză conexiunea" | port greșit / serviciu RAW oprit | „Caută imprimante în rețea (9100)" |
| Bon dublu | imposibil prin pod (memorie anti-duplicare) | verifică serverul |
| Toast „Bon fiscal eșuat" | produs/total invalid | bonul are ack:false → reapare în app |

Loguri: tray → „Deschide folderul cu loguri" (`bridge.log`, rotație la 2 MB). Pentru detalii
maxime activează „Log detaliat (debug)" în Setări.

## Structura codului

```
src/main/main.js            tray, fereastră, IPC, notificări, autostart
src/main/poller.js          buclă polling cu backoff + anti-suprapunere
src/main/cloud.js           client API (timeout 8s, erori prietenoase)
src/main/state.js           stare live + memorie anti-duplicare persistentă + ack-uri restante
src/main/fiscal/fiscal.js   secvența 48→49→51→53→56, recuperare cu 60
src/main/fiscal/dude.js     punte Node ↔ worker PowerShell COM
src/main/fiscal/dude-worker.ps1  workerul COM (dude.CFD_DUDE)
src/main/printers/          ESC/POS + TCP 9100 + poller comenzi
src/renderer/               interfața (Status / Setări / Diagnostic)
```

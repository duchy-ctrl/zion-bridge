# Zion Bridge (pod) — Auto-update de pe GitHub  ✅ ACTIV din v2.3.0 (13.07.2026)

> Codul e la loc: `package.json` (dependență `electron-updater` + `build.publish` → duchy-ctrl/zion-bridge),
> `src/main/main.js` (`initUpdater` + meniul din tray) și **build automat pe GitHub Actions**
> (`.github/workflows/release.yml`) — instalerul se construiește pe serverele GitHub, NU mai e nevoie
> de niciun PC de build.

Cum funcționează: podul de pe PC-ul casei verifică singur GitHub (la pornire + la fiecare 6 ore + manual
din tray), descarcă noua versiune în fundal și o aplică la repornire — **fără reinstalare manuală**.

---

## A. Setup — O SINGURĂ DATĂ

1. **Creează repo-ul public `duchy-ctrl/zion-bridge`** pe GitHub (public = podurile descarcă fără nicio
   cheie pe ele; codul podului nu conține parole — BRIDGE_KEY stă în setările locale, nu în cod).
2. **Publică folderul `zion-bridge` în repo** (GitHub Desktop: Add local repository → acest folder → Publish).
   `.gitignore`-ul e pregătit (node_modules, dist, backup-uri, chei — nu intră).
3. **Primul release:** în GitHub Desktop fă un tag `v2.3.0` pe ultimul commit (History → click dreapta →
   Create Tag) și dă push cu tot cu tag — SAU deschide pe github.com tab-ul **Actions → release → Run workflow**.
   GitHub construiește singur `ZionBridge-Setup-2.3.0.exe` și publică Release-ul (cu `latest.yml`). Durează ~10 min.
4. **Instalează 2.3.0 o singură dată pe PC-ul casei** (descarci exe-ul din pagina de Release). E ultima
   instalare manuală — de aici încolo podul se actualizează singur.

## B. La FIECARE update viitor (după ce schimbăm ceva în pod)

1. Crește versiunea în `package.json` (ex. `2.3.0` → `2.3.1`). **Obligatoriu mai mare ca înainte.**
2. Commit + push, apoi tag `v2.3.1` + push tag (sau Actions → Run workflow).
3. Gata. Fiecare pod observă noua versiune (la pornire, la 6 ore, sau imediat din tray → „Verifică
   actualizări"), o descarcă în fundal și o aplică **la repornire** — sau pe loc din tray:
   **„⬇ Repornește și actualizează acum"**.

Nu mai construiești și nu mai instalezi nimic manual, pe niciun calculator.

---

## Ce vede omul de la casă
- În tray (lângă ceas), meniul podului are acum: **Versiune X**, **Verifică actualizări**, și — când o
  actualizare e descărcată — **„⬇ Repornește și actualizează acum"**.
- Când e gata un update, apare și o notificare. Dacă nu apasă nimic, se instalează singur la următoarea
  repornire a podului/PC-ului.

## De reținut
- **Versiunea trebuie să crească** la fiecare release, altfel podurile nu văd update.
- Auto-update merge doar pe versiunea **instalată** (din installer), nu în modul `dev.bat`.
- Instalerul e nesemnat (cont fără certificat) → la PRIMA instalare Windows SmartScreen poate avertiza
  („More info → Run anyway"). La auto-update ulterior nu mai întreabă.
- Podul a fost făcut tolerant: dacă `npm install` n-a fost rulat, podul tot pornește (doar fără auto-update) —
  dar rulează `npm install` ca să-l ai.

*Cod: `package.json` (build.publish = github duchy-ctrl/zion-bridge) + `src/main/main.js` (initUpdater, tray).*

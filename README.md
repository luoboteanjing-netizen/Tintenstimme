# 墨声 — Chinesisch Ausspracheübung

Eine reine Browser-App zum Üben der Aussprache von chinesischen Vokabeln und Sätzen:
selbst eingeben, anhören (Sprachausgabe), nachsprechen (Mikrofon) und automatisch
bewerten lassen. Kein Server, kein Build-Schritt, keine laufenden Kosten.

## Funktionsweise (Variante 1 — aktuell aktiv)

- **Sprachausgabe:** Web Speech API (`speechSynthesis`) mit einer chinesischen Stimme
  des Betriebssystems/Browsers.
- **Spracherkennung:** Web Speech API (`SpeechRecognition`) erkennt, was gesagt wurde.
- **Bewertung:** Der erkannte Text wird auf Zeichenebene mit dem Soll-Text verglichen
  (Levenshtein-Distanz) und mit der Erkennungs-Konfidenz zu einem Score 0–100 kombiniert.
  Das ist eine gute Annäherung ("wurde verstanden, was gesagt werden sollte"), aber
  **keine echte Phonem- oder Tonhöhen-Analyse**.
- **Browser-Unterstützung:** `SpeechRecognition` ist derzeit im Wesentlichen nur in
  Chrome und Edge (Desktop und Android) verfügbar, nicht in Firefox oder Safari.
  Die App zeigt einen Hinweis an, wenn der Browser das nicht unterstützt.
- **Bekannte Einschränkung auf Android:** Die Web Speech API hängt vom
  Spracherkennungsdienst des Browsers/Betriebssystems ab. **Brave** blockiert
  diesen Dienst grundsätzlich (Fehlercode `network`) — das ist ein seit Jahren
  bestehendes, ungelöstes Brave-Problem, keine Einstellung in der App selbst.
  Auch **Chrome auf Android** kann je nach Gerät fehlschlagen, wenn keine
  Internetverbindung zum Google-Spracherkennungsdienst besteht oder Google-Dienste
  auf dem Gerät fehlen (z. B. bei manchen Custom-ROMs). Die App zeigt in diesem
  Fall den genauen Fehlercode des Browsers an. Das ist einer der Gründe, warum
  Variante 2 (Azure, siehe unten) langfristig zuverlässiger ist: dort wird die
  Audiodatei direkt an einen Cloud-Dienst geschickt, statt sich auf die
  eingebaute Spracherkennung von Browser/Betriebssystem zu verlassen.
- **Pinyin-Anzeige:** Der erkannte Text wird zusätzlich mit Tonzeichen als Pinyin
  angezeigt, umgewandelt über die Bibliothek [pinyin-pro](https://pinyin-pro.cn)
  (per CDN eingebunden, keine Installation nötig).
- Die Vokabelliste wird im `localStorage` des Browsers gespeichert (pro Gerät/Browser).

## Lokal testen

Einfach `index.html` in Chrome oder Edge öffnen. Für Mikrofonzugriff über `file://`
kann es je nach Browser Einschränkungen geben — im Zweifel lokal einen kleinen
Server starten, z. B.:

```bash
python3 -m http.server 8000
```

und dann `http://localhost:8000` öffnen.

## Hosting auf GitHub Pages (kostenlos)

1. Diesen Ordner als neues Repository auf GitHub hochladen (z. B. `chinesisch-aussprache-app`).
2. Im Repository unter **Settings → Pages**:
   - **Source:** „Deploy from a branch“
   - **Branch:** `main`, Ordner `/ (root)`
3. Speichern — nach kurzer Zeit ist die App unter
   `https://<dein-username>.github.io/chinesisch-aussprache-app/` erreichbar.
4. Wichtig: Mikrofonzugriff funktioniert im Browser nur über **HTTPS** oder
   `localhost` — GitHub Pages liefert automatisch HTTPS, das passt also.

## Upgrade auf Variante 2: Azure Pronunciation Assessment

Für eine deutlich genauere Bewertung (inkl. **Tonhöhen**, Betonung, Vollständigkeit)
bietet Microsoft Azure Speech einen speziellen "Pronunciation Assessment"-Dienst mit
kostenlosem Kontingent. Die App ist bereits so aufgebaut, dass dieses Upgrade **ohne
Umbau der restlichen App** möglich ist:

- `js/recorder.js` nimmt schon jetzt parallel zur Texterkennung die **Rohaudiodatei**
  auf (`audioBlob`) — die wird für Azure gebraucht.
- `js/assessment.js` definiert eine gemeinsame Schnittstelle `PronunciationAssessor`.
  Es gibt bereits ein vorbereitetes Gerüst `AzurePronunciationAssessor`.

Schritte für das Upgrade:

1. Kostenloses Azure-Konto + "Speech"-Ressource anlegen (Free-Tier `F0`, aktuell
   ca. 5 Stunden Audio/Monat gratis, danach nutzungsbasiert und günstig).
2. Einen kleinen **Serverless-Proxy** bauen (z. B. Cloudflare Worker, Vercel Function
   oder GitHub-Actions-gestützte Function), der:
   - eine Audiodatei + Referenztext per POST entgegennimmt,
   - damit die Azure "Pronunciation Assessment"-API aufruft,
   - das Ergebnis als JSON zurückgibt.
   
   So bleibt der Azure-Schlüssel **serverseitig** und landet nicht im öffentlichen
   Frontend-Code (wichtig, da GitHub Pages nur statische Dateien ausliefert).
3. In `js/app.js` die Zeile

   ```js
   const assessor = new WebSpeechAssessor();
   ```

   ersetzen durch:

   ```js
   const assessor = new AzurePronunciationAssessor({
     proxyUrl: 'https://dein-proxy.example.com/assess',
   });
   ```

   (und den Import in `app.js` entsprechend um `AzurePronunciationAssessor` ergänzen).
4. Fertig — der Rest der App (UI, Aufnahme, Vokabelverwaltung) bleibt unverändert,
   weil beide Assessoren dieselbe Schnittstelle (`assess({ expectedText, transcript,
   confidence, audioBlob }) → { score, ... }`) implementieren.

## Vokabeln importieren

Im Tab „Vokabeln“ können mehrere Einträge auf einmal eingefügt werden, ein Eintrag
pro Zeile:

```
你好 | nǐ hǎo | Hallo
谢谢 | xièxie | Danke
今天天气很好 | jīntiān tiānqì hěn hǎo | Heute ist das Wetter schön
```

Pinyin und Übersetzung sind optional.

## Projektstruktur

```
index.html
css/style.css
js/
  app.js          – UI-Logik, verbindet alle Module
  vocab.js        – Vokabelverwaltung (localStorage)
  tts.js          – Sprachausgabe
  recorder.js      – Mikrofonaufnahme + Spracherkennung
  assessment.js    – Bewertungslogik (austauschbar, siehe oben)
```

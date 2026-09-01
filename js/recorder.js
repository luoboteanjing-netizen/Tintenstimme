// recorder.js
//
// Nimmt während einer Aufnahme mehrere Dinge gleichzeitig auf:
//  1. Die Rohaudiodatei über MediaRecorder (für ein späteres Azure-Upgrade).
//  2. Den erkannten Text über die SpeechRecognition-API (nur Chrome/Edge),
//     auf dem die Bewertung in Variante 1 basiert.
//  3. Einen laufenden Lautstärke-Pegel (0..1) über die Web Audio API, damit
//     die UI sichtbar machen kann, dass das Mikrofon tatsächlich Ton empfängt.
//
// Wichtig: SpeechRecognition mit continuous=false stoppt oft von selbst
// (nach der ersten erkannten Äußerung oder nach ein paar Sekunden Stille,
// Fehler "no-speech"), bevor der Nutzer manuell auf "Stop" klickt. Deshalb
// wird der onend-Handler schon in start() gesetzt und der Endzustand in
// einem Flag/Promise festgehalten — stop() wartet dann nur noch darauf,
// falls die Erkennung nicht schon vorher beendet war. Zusätzlich sorgt ein
// Timeout dafür, dass stop() in keinem Fall unbegrenzt hängen bleibt.

export class Recorder {
  constructor({ lang = 'zh-CN' } = {}) {
    this.lang = lang;
    this.mediaRecorder = null;
    this.stream = null;
    this.chunks = [];
    this.recognition = null;
    this._recognitionResult = { transcript: '', confidence: 0, error: null };
    this._recognitionEnded = true;
    this._recognitionEndPromise = Promise.resolve();

    this.audioContext = null;
    this.analyser = null;
    this._levelData = null;
  }

  get supportsRecognition() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  get supportsRecording() {
    return 'mediaDevices' in navigator && 'MediaRecorder' in window;
  }

  async start() {
    if (!this.supportsRecording) {
      throw new Error('Mikrofonaufnahme wird von diesem Browser nicht unterstützt.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this._recognitionResult = { transcript: '', confidence: 0, error: null };

    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();

    this._setupLevelMeter();
    this._setupRecognition();
  }

  _setupRecognition() {
    if (!this.supportsRecognition) {
      this._recognitionEnded = true;
      this._recognitionEndPromise = Promise.resolve();
      return;
    }

    this._recognitionEnded = false;
    let resolveEnd;
    this._recognitionEndPromise = new Promise((resolve) => {
      resolveEnd = resolve;
    });

    const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new Impl();
    this.recognition.lang = this.lang;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event) => {
      const result = event.results[0][0];
      this._recognitionResult = {
        transcript: result.transcript,
        confidence: result.confidence,
      };
    };
    // onerror wird festgehalten (nicht nur geloggt), damit die UI erklären
    // kann, WARUM nichts erkannt wurde — z. B. weil der Browser/das Gerät
    // keinen Zugriff auf den Spracherkennungsdienst hat (u. a. bei Brave
    // und manchen Android-Konfigurationen typisch: Fehlercode "network").
    this.recognition.onerror = (e) => {
      console.warn('Spracherkennung: ', e.error);
      this._recognitionResult = { ...this._recognitionResult, error: e.error };
    };
    // Entscheidend: dieser Handler ist von Anfang an aktiv, egal ob die
    // Erkennung durch stop() oder von selbst (Stille/Timeout) endet.
    this.recognition.onend = () => {
      this._recognitionEnded = true;
      resolveEnd();
    };

    try {
      this.recognition.start();
    } catch (e) {
      console.warn('Spracherkennung konnte nicht gestartet werden:', e);
      this._recognitionEnded = true;
      resolveEnd();
    }
  }

  _setupLevelMeter() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new Ctx();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      source.connect(this.analyser);
      this._levelData = new Uint8Array(this.analyser.frequencyBinCount);
    } catch (e) {
      console.warn('Pegelmessung nicht verfügbar:', e);
      this.analyser = null;
    }
  }

  // Liefert einen groben Lautstärke-Pegel 0..1 für die UI-Anzeige.
  getLevel() {
    if (!this.analyser || !this._levelData) return 0;
    this.analyser.getByteTimeDomainData(this._levelData);
    let sumSquares = 0;
    for (let i = 0; i < this._levelData.length; i++) {
      const v = (this._levelData[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / this._levelData.length);
    // leichte Verstärkung, damit normale Sprechlautstärke gut sichtbar ausschlägt
    return Math.min(1, rms * 4);
  }

  async stop() {
    if (!this.mediaRecorder) {
      throw new Error('Aufnahme wurde nicht gestartet.');
    }

    const stopRecording = new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.chunks, { type: mimeType });
        this.stream.getTracks().forEach((t) => t.stop());
        resolve(audioBlob);
      };
      this.mediaRecorder.stop();
    });

    if (this.recognition && !this._recognitionEnded) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Erkennung war offenbar schon beendet — kein Problem, der
        // onend-Handler aus start() hat das bereits festgehalten.
      }
    }

    // Sicherheits-Timeout: falls "onend" aus irgendeinem Grund nie feuert
    // (z. B. weil der Spracherkennungsdienst auf diesem Gerät/Netzwerk gar
    // nicht antwortet), darf die Auswertung trotzdem nicht für immer hängen
    // bleiben. Etwas großzügiger bemessen (7s), damit langsamere mobile
    // Verbindungen nicht fälschlich als "kein Ergebnis" gewertet werden.
    const recognitionEndedInTime = await Promise.race([
      this._recognitionEndPromise.then(() => true),
      delay(7000).then(() => false),
    ]);

    if (!recognitionEndedInTime && !this._recognitionResult.error) {
      // Weder Ergebnis noch Fehler kam an — das ist selbst eine
      // diagnostisch wertvolle Information, deshalb explizit markiert
      // statt stillschweigend als "nichts erkannt" durchzureichen.
      this._recognitionResult = { ...this._recognitionResult, error: 'timeout' };
    }

    const audioBlob = await stopRecording;

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.analyser = null;
    }

    return { audioBlob, ...this._recognitionResult };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

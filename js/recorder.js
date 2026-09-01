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
    this._recognitionResult = { transcript: '', confidence: 0, error: null, resultReceived: false, noMatch: false };
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
  // Für reine SpeechRecognition brauchen wir keinen Stream-Speicher für MediaRecorder mehr
  this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  this.chunks = [];
  this._recognitionResult = { transcript: '', confidence: 0, error: null, resultReceived: false, noMatch: false };

  // Pegelanzeige (Web Audio API) bleibt aktiv
  this._setupLevelMeter();

  // Spracherkennung direkt starten
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

  // Fallback für Android: Manchmal verlangen mobile Browser explizitere Sprach-Tags
  this.recognition.lang = this.lang || 'zh-CN';
  
  // Wichtig für Android: continuous explizit auf false setzen
  this.recognition.continuous = false;
  this.recognition.interimResults = false;
  this.recognition.maxAlternatives = 1;

  this.recognition.onresult = (event) => {
    const result = event.results[0][0];
    this._recognitionResult = {
      ...this._recognitionResult,
      transcript: result.transcript,
      confidence: result.confidence,
      resultReceived: true,
    };
  };

  this.recognition.onnomatch = () => {
    this._recognitionResult = { ...this._recognitionResult, noMatch: true };
  };

  this.recognition.onerror = (e) => {
    console.warn('Spracherkennung Fehler:', e.error);
    this._recognitionResult = { ...this._recognitionResult, error: e.error };
  };

  this.recognition.onend = () => {
    this._recognitionEnded = true;
    resolveEnd();
  };

  try {
    this.recognition.start();
  } catch (e) {
    console.warn('Spracherkennung konnte nicht gestartet werden:', e);
    this._recognitionResult = { ...this._recognitionResult, error: e.name || 'start-failed' };
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
  // Spracherkennung beenden, falls sie noch läuft
  if (this.recognition && !this._recognitionEnded) {
    try {
      this.recognition.stop();
    } catch (e) {
      // Bereits beendet
    }
  }

  // Warten, bis das finale Ergebnis oder der Timeout eintrifft
  const recognitionEndedInTime = await Promise.race([
    this._recognitionEndPromise.then(() => true),
    delay(7000).then(() => false),
  ]);

  if (!recognitionEndedInTime && !this._recognitionResult.error) {
    this._recognitionResult = { ...this._recognitionResult, error: 'timeout' };
  }

  // Mikrofon-Stream freigeben
  if (this.stream) {
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  // Web Audio Context schließen
  if (this.audioContext) {
    this.audioContext.close().catch(() => {});
    this.audioContext = null;
    this.analyser = null;
  }

  // Kein audioBlob mehr vorhanden (da MediaRecorder aus)
  return { audioBlob: null, ...this._recognitionResult };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

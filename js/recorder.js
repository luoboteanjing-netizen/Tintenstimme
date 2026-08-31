// recorder.js
//
// Nimmt während einer Aufnahme zwei Dinge gleichzeitig auf:
//  1. Die Rohaudiodatei über MediaRecorder (wird für Variante 1 nicht
//     zwingend gebraucht, liegt aber schon bereit für ein späteres
//     Azure-Upgrade, das echte Audiodaten braucht).
//  2. Den erkannten Text über die SpeechRecognition-API (nur Chrome/Edge),
//     auf dem die Bewertung in Variante 1 basiert.

export class Recorder {
  constructor({ lang = 'zh-CN' } = {}) {
    this.lang = lang;
    this.mediaRecorder = null;
    this.stream = null;
    this.chunks = [];
    this.recognition = null;
    this._recognitionResult = { transcript: '', confidence: 0 };
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
    this._recognitionResult = { transcript: '', confidence: 0 };

    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();

    if (this.supportsRecognition) {
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
      // onerror bewusst nur geloggt: Aufnahme soll trotzdem weiterlaufen,
      // die Bewertung fällt dann eben auf "keine Erkennung" zurück.
      this.recognition.onerror = (e) => console.warn('Spracherkennung: ', e.error);
      try {
        this.recognition.start();
      } catch (e) {
        console.warn('Spracherkennung konnte nicht gestartet werden:', e);
      }
    }
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

    const stopRecognition = new Promise((resolve) => {
      if (!this.recognition) {
        resolve();
        return;
      }
      this.recognition.onend = () => resolve();
      try {
        this.recognition.stop();
      } catch (e) {
        resolve();
      }
    });

    const [audioBlob] = await Promise.all([stopRecording, stopRecognition]);
    return { audioBlob, ...this._recognitionResult };
  }
}

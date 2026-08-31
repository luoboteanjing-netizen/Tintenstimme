// tts.js — Sprachausgabe über die Web Speech API (SpeechSynthesis)

export class TTS {
  constructor({ lang = 'zh-CN', rate = 0.85 } = {}) {
    this.lang = lang;
    this.rate = rate;
    this.voice = null;
    this._pickVoice();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this._pickVoice();
    }
  }

  get supported() {
    return 'speechSynthesis' in window;
  }

  _pickVoice() {
    if (!this.supported) return;
    const voices = window.speechSynthesis.getVoices();
    this.voice =
      voices.find((v) => v.lang === this.lang) ||
      voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('zh')) ||
      null;
  }

  speak(text) {
    if (!this.supported) {
      return Promise.reject(new Error('Sprachausgabe wird von diesem Browser nicht unterstützt.'));
    }
    return new Promise((resolve, reject) => {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = this.lang;
      utter.rate = this.rate;
      if (this.voice) utter.voice = this.voice;
      utter.onend = () => resolve();
      utter.onerror = (e) => reject(e.error || e);
      window.speechSynthesis.speak(utter);
    });
  }
}

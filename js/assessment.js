// assessment.js
//
// Definiert eine gemeinsame Schnittstelle für die Aussprachebewertung.
// So kann später eine zweite Implementierung (z. B. Azure Pronunciation
// Assessment) eingesteckt werden, ohne app.js oder recorder.js anzufassen.
//
// Jede Assessor-Implementierung bekommt beim Aufruf von assess():
//   - expectedText: der Soll-Text (Hanzi)
//   - transcript:   der von der Web Speech API erkannte Text (kann leer sein)
//   - confidence:   Konfidenzwert der Erkennung (0..1, falls verfügbar)
//   - audioBlob:    die aufgenommene Rohaudiodatei (für spätere Azure-Nutzung)
//
// und liefert ein Objekt zurück mit mindestens:
//   { score: 0..100, method: 'name-der-methode', ...weitere Details }

export class PronunciationAssessor {
  // eslint-disable-next-line no-unused-vars
  async assess({ expectedText, transcript, confidence, audioBlob }) {
    throw new Error('assess() muss von einer Unterklasse implementiert werden');
  }
}

/**
 * Variante 1: kostenlose Bewertung rein über die Web Speech API.
 * Vergleicht den erkannten Text mit dem Soll-Text (Zeichen-Ebene) und
 * gewichtet das Ergebnis mit der Konfidenz der Spracherkennung.
 *
 * Das ist kein echtes Phonem-/Ton-Scoring, sondern eine Annäherung:
 * "Hat die Spracherkennung verstanden, was gesagt werden sollte?"
 */
export class WebSpeechAssessor extends PronunciationAssessor {
  async assess({ expectedText, transcript, confidence, error }) {
    const expected = normalize(expectedText);
    const got = normalize(transcript);

    if (!got) {
      return {
        score: 0,
        similarity: 0,
        expected,
        transcript: got,
        diff: expected.split('').map((char) => ({ char, matched: false })),
        method: 'webspeech-text-match',
        note: error
          ? recognitionErrorMessage(error)
          : 'Keine Spracherkennung möglich – bitte erneut versuchen oder lauter sprechen.',
      };
    }

    const distance = levenshtein(expected, got);
    const maxLen = Math.max(expected.length, got.length, 1);
    const similarity = Math.max(0, 1 - distance / maxLen);
    const confScore = typeof confidence === 'number' && confidence > 0 ? confidence : 0.75;

    // Ähnlichkeit zählt am meisten, Konfidenz der Erkennung fließt mit ein
    const score = Math.round(Math.min(1, similarity * 0.85 + confScore * 0.15) * 100);

    return {
      score,
      similarity,
      expected,
      transcript: got,
      diff: charDiff(expected, got),
      method: 'webspeech-text-match',
    };
  }
}

/**
 * Variante 2 (Vorbereitung): Azure Pronunciation Assessment.
 * Noch nicht aktiv – siehe README.md, Abschnitt "Upgrade auf Azure".
 *
 * Sendet die Audioaufnahme + den Referenztext an einen selbst gehosteten
 * Proxy (z. B. Cloudflare Worker), der wiederum Azure Speech aufruft.
 * So bleibt der Azure-Key aus dem Frontend-Code heraus.
 */
export class AzurePronunciationAssessor extends PronunciationAssessor {
  constructor({ proxyUrl, language = 'zh-CN' } = {}) {
    super();
    this.proxyUrl = proxyUrl;
    this.language = language;
  }

  async assess({ expectedText, audioBlob }) {
    if (!this.proxyUrl) {
      throw new Error('AzurePronunciationAssessor: proxyUrl ist nicht konfiguriert.');
    }
    const form = new FormData();
    form.append('audio', audioBlob, 'attempt.webm');
    form.append('referenceText', expectedText);
    form.append('language', this.language);

    const res = await fetch(this.proxyUrl, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`Azure-Bewertung fehlgeschlagen (HTTP ${res.status})`);
    }
    const data = await res.json();

    return {
      score: Math.round(data.pronunciationScore ?? 0),
      accuracyScore: data.accuracyScore,
      fluencyScore: data.fluencyScore,
      completenessScore: data.completenessScore,
      toneScore: data.toneScore, // Mandarin-spezifisch
      method: 'azure-pronunciation-assessment',
      raw: data,
    };
  }
}

// ---- Hilfsfunktionen ----

// Übersetzt die von der Web Speech API gemeldeten Fehlercodes in eine
// verständliche, handlungsorientierte Meldung für die Nutzer:innen.
export function recognitionErrorMessage(code) {
  switch (code) {
    case 'network':
      return 'Der Browser konnte den Spracherkennungsdienst nicht erreichen (Fehlercode "network"). ' +
        'Bei Brave ist das ein bekanntes, dauerhaftes Problem, da Brave den Google-Spracherkennungsdienst ' +
        'standardmäßig blockiert – dort hilft nur, testweise Chrome zu verwenden. ' +
        'Bei Chrome kann das an fehlender Internetverbindung oder fehlenden Google-Diensten auf dem Gerät liegen.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Der Zugriff auf die Spracherkennung wurde verweigert (Fehlercode "' + code + '"). ' +
        'Bitte in den Android-Systemeinstellungen prüfen, ob der Browser Mikrofonzugriff hat, und die Seite neu laden.';
    case 'audio-capture':
      return 'Es wurde kein Mikrofon für die Spracherkennung gefunden (Fehlercode "audio-capture").';
    case 'language-not-supported':
      return 'Chinesisch (zh-CN) wird von der Spracherkennung dieses Geräts nicht unterstützt.';
    case 'no-speech':
      return 'Es wurde keine Sprache erkannt — bitte lauter oder direkter ins Mikrofon sprechen.';
    default:
      return code
        ? `Spracherkennung fehlgeschlagen (Fehlercode "${code}").`
        : 'Keine Spracherkennung möglich – bitte erneut versuchen oder lauter sprechen.';
  }
}

function normalize(text) {
  return (text || '')
    .trim()
    .replace(/[\s，。！？、；：""''《》.,!?…—-]/g, '');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Liefert für jedes Zeichen des Soll-Texts, ob es im erkannten Text
// (in ungefähr richtiger Reihenfolge) vorkam – Basis für die farbige
// Hervorhebung in der UI.
function charDiff(expected, got) {
  const m = expected.length;
  const n = got.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        expected[i - 1] === got[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  let i = m;
  let j = n;
  const matched = new Array(m).fill(false);
  while (i > 0 && j > 0) {
    if (expected[i - 1] === got[j - 1]) {
      matched[i - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return expected.split('').map((char, idx) => ({ char, matched: matched[idx] }));
}

import { loadVocab, addVocabItem, removeVocabItem, importVocabText, exportVocabJSON } from './vocab.js';
import { TTS } from './tts.js';
import { Recorder } from './recorder.js';
import { WebSpeechAssessor } from './assessment.js';

// ---------------------------------------------------------------
// Konfiguration: hier steckt der Umschaltpunkt für ein späteres
// Upgrade auf Variante 2 (Azure Pronunciation Assessment).
// Siehe README.md, Abschnitt "Upgrade auf Azure".
// ---------------------------------------------------------------
const assessor = new WebSpeechAssessor();

const tts = new TTS({ lang: 'zh-CN' });
const recorder = new Recorder({ lang: 'zh-CN' });

let vocab = loadVocab();
let currentIndex = 0;
let isRecording = false;
let revealed = false;
let levelRafId = null;
let recordingStartedAt = null;
let recordingTimerId = null;
let lastRecordingUrl = null;
const recordingPlayer = new Audio();

// ---- Elemente ----
const el = {
  browserWarning: document.getElementById('browserWarning'),
  tabs: document.querySelectorAll('.tab-btn'),
  views: document.querySelectorAll('.view'),

  progressCount: document.getElementById('progressCount'),
  hanziDisplay: document.getElementById('hanziDisplay'),
  pinyinLine: document.getElementById('pinyinLine'),
  translationLine: document.getElementById('translationLine'),
  revealToggle: document.getElementById('revealToggle'),

  playBtn: document.getElementById('playBtn'),
  recordBtn: document.getElementById('recordBtn'),
  playRecordingBtn: document.getElementById('playRecordingBtn'),
  retryBtn: document.getElementById('retryBtn'),
  statusLine: document.getElementById('statusLine'),

  levelMeter: document.getElementById('levelMeter'),
  levelFill: document.getElementById('levelFill'),

  resultBox: document.getElementById('resultBox'),
  scoreNum: document.getElementById('scoreNum'),
  resultFeedback: document.getElementById('resultFeedback'),
  diffLine: document.getElementById('diffLine'),
  resultTranscript: document.getElementById('resultTranscript'),

  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),

  newHanzi: document.getElementById('newHanzi'),
  newPinyin: document.getElementById('newPinyin'),
  newTranslation: document.getElementById('newTranslation'),
  addBtn: document.getElementById('addBtn'),
  importText: document.getElementById('importText'),
  importBtn: document.getElementById('importBtn'),
  exportBtn: document.getElementById('exportBtn'),
  vocabList: document.getElementById('vocabList'),
};

// ---- Tabs ----
el.tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    el.tabs.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.view;
    el.views.forEach((v) => v.classList.toggle('active', v.id === `view-${target}`));
    if (target === 'vocab') renderVocabList();
  });
});

// ---- Browser-Fähigkeiten prüfen ----
if (!recorder.supportsRecognition) {
  el.browserWarning.classList.add('show');
}

// ---- Übungsablauf ----

function currentItem() {
  return vocab[currentIndex];
}

function renderPractice() {
  const item = currentItem();
  resetResult();
  revealed = false;
  el.revealToggle.textContent = 'Pinyin & Übersetzung anzeigen';

  if (!item) {
    el.hanziDisplay.textContent = 'Keine Vokabeln vorhanden';
    el.pinyinLine.textContent = '';
    el.translationLine.textContent = '';
    el.progressCount.textContent = '0 / 0';
    el.playBtn.disabled = true;
    el.recordBtn.disabled = true;
    return;
  }

  el.playBtn.disabled = false;
  el.recordBtn.disabled = false;
  el.hanziDisplay.textContent = item.hanzi;
  el.pinyinLine.textContent = item.pinyin || '';
  el.translationLine.textContent = item.translation || '';
  el.pinyinLine.style.visibility = 'hidden';
  el.translationLine.style.visibility = 'hidden';
  el.progressCount.textContent = `${currentIndex + 1} / ${vocab.length}`;
}

el.revealToggle.addEventListener('click', () => {
  revealed = !revealed;
  el.pinyinLine.style.visibility = revealed ? 'visible' : 'hidden';
  el.translationLine.style.visibility = revealed ? 'visible' : 'hidden';
  el.revealToggle.textContent = revealed ? 'Verbergen' : 'Pinyin & Übersetzung anzeigen';
});

el.prevBtn.addEventListener('click', () => {
  if (vocab.length === 0) return;
  currentIndex = (currentIndex - 1 + vocab.length) % vocab.length;
  renderPractice();
});

el.nextBtn.addEventListener('click', () => {
  if (vocab.length === 0) return;
  currentIndex = (currentIndex + 1) % vocab.length;
  renderPractice();
});

el.playBtn.addEventListener('click', async () => {
  const item = currentItem();
  if (!item) return;
  try {
    el.statusLine.textContent = 'Wird abgespielt …';
    await tts.speak(item.hanzi);
    el.statusLine.textContent = '';
  } catch (e) {
    el.statusLine.textContent = 'Sprachausgabe nicht verfügbar in diesem Browser.';
  }
});

el.recordBtn.addEventListener('click', async () => {
  if (!isRecording) {
    await startRecording();
  } else {
    await stopRecordingAndAssess();
  }
});

el.retryBtn.addEventListener('click', () => {
  resetResult();
});

async function startRecording() {
  const item = currentItem();
  if (!item) return;
  try {
    await recorder.start();
    isRecording = true;
    el.recordBtn.textContent = '■ Aufnahme beenden';
    el.recordBtn.classList.add('recording');
    el.retryBtn.style.display = 'none';
    el.playRecordingBtn.style.display = 'none';
    el.resultBox.classList.remove('show');

    recordingStartedAt = Date.now();
    updateRecordingStatus();
    recordingTimerId = setInterval(updateRecordingStatus, 500);

    el.levelMeter.classList.add('show');
    startLevelLoop();
  } catch (e) {
    el.statusLine.textContent = 'Mikrofonzugriff nicht möglich: ' + (e.message || e);
  }
}

async function stopRecordingAndAssess() {
  isRecording = false;
  el.recordBtn.textContent = '● Aufnehmen';
  el.recordBtn.classList.remove('recording');

  stopLevelLoop();
  el.levelMeter.classList.remove('show');
  el.levelFill.style.width = '0%';
  clearInterval(recordingTimerId);
  recordingTimerId = null;

  el.statusLine.textContent = 'Wird ausgewertet …';

  try {
    const { transcript, confidence, error, audioBlob } = await recorder.stop();
    storeRecordingForPlayback(audioBlob);

    const item = currentItem();
    const result = await assessor.assess({
      expectedText: item.hanzi,
      transcript,
      confidence,
      error,
    });
    showResult(result);
    el.statusLine.textContent = '';
  } catch (e) {
    el.statusLine.textContent = 'Auswertung fehlgeschlagen: ' + (e.message || e);
  }
}

function storeRecordingForPlayback(audioBlob) {
  if (lastRecordingUrl) {
    URL.revokeObjectURL(lastRecordingUrl);
    lastRecordingUrl = null;
  }
  if (audioBlob && audioBlob.size > 0) {
    lastRecordingUrl = URL.createObjectURL(audioBlob);
    el.playRecordingBtn.style.display = 'inline-flex';
  } else {
    el.playRecordingBtn.style.display = 'none';
  }
}

el.playRecordingBtn.addEventListener('click', () => {
  if (!lastRecordingUrl) return;
  recordingPlayer.src = lastRecordingUrl;
  recordingPlayer.currentTime = 0;
  recordingPlayer.play().catch((e) => {
    el.statusLine.textContent = 'Wiedergabe nicht möglich: ' + (e.message || e);
  });
});

function updateRecordingStatus() {
  const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
  el.statusLine.textContent = `Aufnahme läuft — jetzt sprechen … (${seconds}s)`;
}

function startLevelLoop() {
  const loop = () => {
    const level = recorder.getLevel();
    el.levelFill.style.width = `${Math.round(level * 100)}%`;
    levelRafId = requestAnimationFrame(loop);
  };
  levelRafId = requestAnimationFrame(loop);
}

function stopLevelLoop() {
  if (levelRafId) {
    cancelAnimationFrame(levelRafId);
    levelRafId = null;
  }
}

function showResult(result) {
  el.resultBox.classList.add('show');
  el.scoreNum.textContent = result.score;
  el.resultFeedback.textContent = feedbackFor(result.score);
  el.retryBtn.style.display = 'inline-flex';

  if (result.diff && result.diff.length) {
    el.diffLine.innerHTML = result.diff
      .map((d) => `<span class="${d.matched ? 'ok' : 'miss'}">${escapeHtml(d.char)}</span>`)
      .join('');
  } else {
    el.diffLine.textContent = '';
  }

  el.resultTranscript.textContent = result.transcript
    ? `Erkannt: „${result.transcript}“${formatPinyinSuffix(result.transcript)}`
    : result.note || 'Nichts erkannt.';
}

function formatPinyinSuffix(text) {
  const py = pinyinOf(text);
  return py ? ` (${py})` : '';
}

function pinyinOf(text) {
  if (!text || !window.pinyinPro || typeof window.pinyinPro.pinyin !== 'function') return '';
  try {
    return window.pinyinPro.pinyin(text, { toneType: 'symbol' });
  } catch (e) {
    console.warn('Pinyin-Umwandlung fehlgeschlagen:', e);
    return '';
  }
}

function feedbackFor(score) {
  if (score >= 90) return 'Sehr gut — die Aussprache passt.';
  if (score >= 70) return 'Gut erkennbar, mit kleinen Abweichungen.';
  if (score >= 45) return 'Teilweise erkannt — noch etwas üben.';
  return 'Kaum erkannt — nochmal langsam versuchen.';
}

function resetResult() {
  el.resultBox.classList.remove('show');
  el.retryBtn.style.display = 'none';
  el.playRecordingBtn.style.display = 'none';
  el.statusLine.textContent = '';
  if (lastRecordingUrl) {
    URL.revokeObjectURL(lastRecordingUrl);
    lastRecordingUrl = null;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Vokabelverwaltung ----

function renderVocabList() {
  el.vocabList.innerHTML = '';
  if (vocab.length === 0) {
    el.vocabList.innerHTML = '<li class="empty-state">Noch keine Einträge — oben hinzufügen oder importieren.</li>';
    return;
  }
  vocab.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'vocab-item';
    li.innerHTML = `
      <span class="vi-hanzi">${escapeHtml(item.hanzi)}</span>
      <span class="vi-meta">
        ${item.pinyin ? `<span class="pinyin">${escapeHtml(item.pinyin)}</span>` : ''}
        ${item.pinyin && item.translation ? ' · ' : ''}
        ${item.translation ? escapeHtml(item.translation) : ''}
      </span>
      <button class="icon-btn" data-id="${item.id}">Entfernen</button>
    `;
    li.querySelector('.icon-btn').addEventListener('click', () => {
      vocab = removeVocabItem(vocab, item.id);
      if (currentIndex >= vocab.length) currentIndex = Math.max(0, vocab.length - 1);
      renderVocabList();
      renderPractice();
    });
    el.vocabList.appendChild(li);
  });
}

el.addBtn.addEventListener('click', () => {
  const hanzi = el.newHanzi.value.trim();
  if (!hanzi) {
    el.newHanzi.focus();
    return;
  }
  vocab = addVocabItem(vocab, {
    hanzi,
    pinyin: el.newPinyin.value.trim(),
    translation: el.newTranslation.value.trim(),
  });
  el.newHanzi.value = '';
  el.newPinyin.value = '';
  el.newTranslation.value = '';
  renderVocabList();
  renderPractice();
});

el.importBtn.addEventListener('click', () => {
  const text = el.importText.value;
  if (!text.trim()) return;
  vocab = importVocabText(vocab, text);
  el.importText.value = '';
  renderVocabList();
  renderPractice();
});

el.exportBtn.addEventListener('click', () => {
  const json = exportVocabJSON(vocab);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vokabeln.json';
  a.click();
  URL.revokeObjectURL(url);
});

// ---- Start ----
renderPractice();
renderVocabList();

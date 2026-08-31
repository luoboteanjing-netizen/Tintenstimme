// vocab.js — Verwaltung der Vokabel-/Satzliste (Persistenz über localStorage)

const STORAGE_KEY = 'caa_vocab_v1';

const DEFAULT_VOCAB = [
  { id: 'v1', hanzi: '你好', pinyin: 'nǐ hǎo', translation: 'Hallo' },
  { id: 'v2', hanzi: '谢谢', pinyin: 'xièxie', translation: 'Danke' },
  { id: 'v3', hanzi: '我叫玛丽', pinyin: 'wǒ jiào mǎlì', translation: 'Ich heiße Marie' },
  { id: 'v4', hanzi: '今天天气很好', pinyin: 'jīntiān tiānqì hěn hǎo', translation: 'Heute ist das Wetter schön' },
];

export function loadVocab() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveVocab(DEFAULT_VOCAB);
      return [...DEFAULT_VOCAB];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...DEFAULT_VOCAB];
  } catch (e) {
    console.warn('Vokabelliste konnte nicht geladen werden, verwende Standardliste.', e);
    return [...DEFAULT_VOCAB];
  }
}

export function saveVocab(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function makeId() {
  return 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
}

export function addVocabItem(list, item) {
  const newList = [...list, { id: makeId(), hanzi: '', pinyin: '', translation: '', ...item }];
  saveVocab(newList);
  return newList;
}

export function updateVocabItem(list, id, changes) {
  const newList = list.map((i) => (i.id === id ? { ...i, ...changes } : i));
  saveVocab(newList);
  return newList;
}

export function removeVocabItem(list, id) {
  const newList = list.filter((i) => i.id !== id);
  saveVocab(newList);
  return newList;
}

// Import-Format: eine Zeile pro Eintrag, Felder getrennt durch "|"
//   汉字 | pīnyīn | Übersetzung
// Pinyin und Übersetzung sind optional.
export function importVocabText(list, text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let newList = list;
  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim());
    const hanzi = parts[0] || '';
    if (!hanzi) continue;
    newList = addVocabItem(newList, {
      hanzi,
      pinyin: parts[1] || '',
      translation: parts[2] || '',
    });
  }
  return newList;
}

export function exportVocabJSON(list) {
  return JSON.stringify(list, null, 2);
}

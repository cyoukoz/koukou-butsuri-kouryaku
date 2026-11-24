// 高校物理攻略 — IndexedDB ラッパー
// 方針（決定済み）：IDB はバージョン固定で、ファイル置き場として使う。
// サーバには個人データを保存しない。進捗などはすべてこの IDB に置く。
// バージョンを上げたくなったら、まず export-import.js で全データを
// ファイルに書き出してから設計し直すこと。安易に VERSION を上げない。
const DB_NAME = 'koukou-butsuri-kouryaku';
const DB_VERSION = 1; // 固定。変更禁止（変更時は上記コメント参照）
const STORE_FILES = 'files'; // { name: string, updatedAt: string, data: any }

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ファイルを1つ保存する（上書き可）。data は JSON にできるものなら何でもよい。
async function saveFile(name, data) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORE_FILES, 'readwrite');
    t.objectStore(STORE_FILES).put({ name, updatedAt: new Date().toISOString(), data });
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  db.close();
}

async function loadFile(name) {
  const db = await openDB();
  const value = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE_FILES, 'readonly').objectStore(STORE_FILES).get(name);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value ? value.data : null;
}

async function listFiles() {
  const db = await openDB();
  const names = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE_FILES, 'readonly').objectStore(STORE_FILES).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return names;
}

// 進捗は 'progress.json' という1つのファイルとして保存する。
async function saveProgress(progress) { return saveFile('progress.json', progress); }
async function loadProgress() { return (await loadFile('progress.json')) || {}; }

// 高校物理攻略 — エクスポート / インポート
// IDB の中身を1つの JSON ファイルとして書き出し、そこから読み戻す。
// idb.js を先に読み込むこと。
async function exportAll() {
  const names = await listFiles();
  const files = {};
  for (const name of names) files[name] = await loadFile(name);
  const blob = new Blob(
    [JSON.stringify({ app: 'koukou-butsuri-kouryaku', exportedAt: new Date().toISOString(), files }, null, 2)],
    { type: 'application/json' },
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'koukou-butsuri-kouryaku-data.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importAll(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed.files !== 'object') throw new Error('このファイルは高校物理攻略のデータではありません。');
  for (const [name, data] of Object.entries(parsed.files)) await saveFile(name, data);
}

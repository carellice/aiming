import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Import as an ES module even before the app package manifest exists.
const source = await readFile(new URL('../dist/data.js', import.meta.url), 'utf8');
const { uid, createBoard, validateWorkspace, encryptWorkspace, decryptWorkspace, openStore } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function fixture() {
  const board = createBoard('Le mie idee');
  board.cards = [
    { id: uid(), type: 'note', x: -40, y: 25, width: 240, height: 180, title: 'Un’idea', content: '<b>Testo semplice 🔒</b>', color: '#ffdf99' },
    { id: uid(), type: 'tasks', x: 300, y: 20, width: 260, title: 'Da fare', color: '#ffffff', tasks: [{ id: uid(), text: 'Finire la lavagna', done: true }] },
    { id: uid(), type: 'image', x: 40, y: 300, width: 300, title: 'Foto', color: '#fff', src: 'data:image/png;base64,aGVsbG8=' },
  ];
  board.connections = [{ id: uid(), from: board.cards[0].id, to: board.cards[1].id, color: '#8a7cb3' }];
  return { version: 1, activeBoardId: board.id, boards: [board], settings: { grid: 'dots', background: '#f8f8f6' } };
}

test('encrypted backup roundtrip preserves boards, tasks, images, connections and unicode', async () => {
  const workspace = fixture();
  const encrypted = await encryptWorkspace(workspace, 'password di prova 🔐');
  assert.equal(encrypted.format, 'aiming-encrypted');
  assert.equal(encrypted.algorithm, 'AES-256-GCM');
  assert.ok(encrypted.iterations >= 310000);
  assert.ok(!JSON.stringify(encrypted).includes('Le mie idee'));
  assert.deepEqual(await decryptWorkspace(JSON.stringify(encrypted), 'password di prova 🔐'), validateWorkspace(workspace));
});

test('each backup uses a fresh salt and nonce', async () => {
  const workspace = fixture();
  const [a, b] = await Promise.all([encryptWorkspace(workspace, 'password123'), encryptWorkspace(workspace, 'password123')]);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
});

test('formatted text survives encrypted backups and local storage, including false flags', async () => {
  const workspace = fixture();
  const styles = [
    { fontSize: 48, bold: true, italic: false, underline: true, textAlign: 'center', textColor: '#234567', textBackground: false, fontFamily: 'serif' },
    { fontSize: 8, bold: false, italic: true, underline: false, textAlign: 'right', textColor: '#abc', textBackground: true, fontFamily: 'mono' },
  ];
  for (const [index, style] of styles.entries()) workspace.boards[0].cards.push({
    id: uid(), type: 'text', x: index * 400, y: -100, width: 320, title: '', content: 'Testo libero\ncon più righe & accenti à', color: '#fff1ad', ...style,
  });
  const expected = validateWorkspace(workspace);
  const encrypted = await encryptWorkspace(workspace, 'password123');
  const restored = await decryptWorkspace(encrypted, 'password123');
  assert.deepEqual(restored, expected);
  styles.forEach((style, index) => {
    for (const [key, value] of Object.entries(style)) assert.equal(restored.boards[0].cards[index + 3][key], value);
  });
  const memory = new Map();
  globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const store = await openStore();
  await store.save(workspace);
  assert.deepEqual(await store.load(), expected);
});

test('text formatting rejects unsafe CSS, invalid enums and coerced booleans', () => {
  const invalidOptions = [
    ...['bold', 'italic', 'underline', 'textBackground'].flatMap(field => ['false', 0, 1, null, {}, []].map(value => ({ [field]: value }))),
    ...[7, 161, '24', Infinity, NaN].map(fontSize => ({ fontSize })),
    ...['justify', 'left;position:fixed', 1, null].map(textAlign => ({ textAlign })),
    ...['Arial', 'sans;display:none', 'url(https://example.com)', 1].map(fontFamily => ({ fontFamily })),
    ...['red', '#fff;position:fixed', 'url(https://example.com)', '#gggggg', null].map(textColor => ({ textColor })),
  ];
  for (const options of invalidOptions) {
    const workspace = fixture();
    workspace.boards[0].cards.push({ id: uid(), type: 'text', x: 0, y: 0, width: 320, content: 'Safe text', ...options });
    assert.throws(() => validateWorkspace(workspace), /validi/, JSON.stringify(options));
  }
});

test('legacy text titles and bodies remain independent without inserted formatting defaults', async () => {
  const workspace = fixture();
  const legacy = { id: uid(), type: 'text', x: 0, y: 0, width: 270, height: 210, title: 'Titolo originale', content: 'Corpo originale\nSeconda riga', color: '#eae5fa' };
  workspace.boards[0].cards.push(legacy);
  const clean = validateWorkspace(workspace);
  assert.deepEqual(clean.boards[0].cards.at(-1), legacy);
  for (const field of ['fontSize', 'bold', 'italic', 'underline', 'textAlign', 'textColor', 'textBackground', 'fontFamily']) assert.equal(Object.hasOwn(clean.boards[0].cards.at(-1), field), false);
  const encrypted = await encryptWorkspace(workspace, 'password123');
  const restored = await decryptWorkspace(encrypted, 'password123');
  assert.deepEqual(restored.boards[0].cards.at(-1), legacy);
});

test('multi-megabyte image backup decrypts without regexp stack exhaustion', async () => {
  const workspace = fixture();
  const source = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024, 127).toString('base64')}`;
  workspace.boards[0].cards[2].src = source;
  const encrypted = await encryptWorkspace(workspace, 'password123');
  const restored = await decryptWorkspace(encrypted, 'password123');
  assert.equal(restored.boards[0].cards[2].src, source);
});

test('wrong password or authenticated-ciphertext tampering never returns workspace data', async () => {
  const encrypted = await encryptWorkspace(fixture(), 'password123');
  await assert.rejects(decryptWorkspace(encrypted, 'password errata'), /Password errata/);
  const bytes = Buffer.from(encrypted.data, 'base64');
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decryptWorkspace({ ...encrypted, data: bytes.toString('base64') }, 'password123'), /Password errata/);
});

test('untrusted envelopes reject invalid algorithms, nonce, expensive KDF and malformed JSON', async () => {
  const encrypted = await encryptWorkspace(fixture(), 'password123');
  await assert.rejects(decryptWorkspace('{broken', 'password123'), /JSON valido/);
  await assert.rejects(decryptWorkspace({ ...encrypted, algorithm: 'AES-CBC' }, 'password123'), /supportato/);
  await assert.rejects(decryptWorkspace({ ...encrypted, iterations: 900000000 }, 'password123'), /parametri/);
  await assert.rejects(decryptWorkspace({ ...encrypted, iv: 'AA==' }, 'password123'), /danneggiato/);
  await assert.rejects(encryptWorkspace(fixture(), 'short'), /password tra 8/);
});

test('workspace validation makes an allowlisted independent copy and rejects unsafe sources', () => {
  const workspace = fixture();
  workspace.boards[0].cards[0].onerror = 'evil()';
  workspace.boards[0].cards[0].__proto__ = { dangerous: true };
  const clean = validateWorkspace(workspace);
  assert.equal(Object.hasOwn(clean.boards[0].cards[0], 'onerror'), false);
  assert.equal(clean.boards[0].cards[0].dangerous, undefined);
  clean.boards[0].cards[0].content = 'Modified';
  assert.notEqual(workspace.boards[0].cards[0].content, 'Modified');
  const invalid = fixture();
  invalid.boards[0].cards[0].x = Infinity;
  assert.throws(() => validateWorkspace(invalid), /validi/);
  const image = fixture();
  image.boards[0].cards[2].src = 'data:image/svg+xml;base64,PHN2Zz4=';
  assert.throws(() => validateWorkspace(image), /immagini/);
  const link = fixture();
  link.boards[0].cards.push({ id: uid(), type: 'link', x: 0, y: 0, width: 200, color: '#fff', url: 'javascript:alert(1)' });
  assert.throws(() => validateWorkspace(link), /HTTP/);
});

test('workspace rejects duplicate IDs, dangling connections and missing active board', () => {
  const duplicate = fixture();
  duplicate.boards.push(duplicate.boards[0]);
  assert.throws(() => validateWorkspace(duplicate), /duplicate/);
  const dangling = fixture();
  dangling.boards[0].connections[0].to = 'missing';
  assert.throws(() => validateWorkspace(dangling), /collegamento/);
  const active = fixture();
  active.activeBoardId = 'missing';
  assert.throws(() => validateWorkspace(active), /attiva/);
});

test('imported identifiers cannot break HTML attributes or CSS selectors', () => {
  for (const invalidId of ['card" onclick="alert(1)', 'x] .board-card', '<img src=x>', '__ id', 'x\u0000y']) {
    const card = fixture();
    card.boards[0].cards[0].id = invalidId;
    assert.throws(() => validateWorkspace(card), /validi/);
    const board = fixture();
    board.boards[0].id = invalidId;
    board.activeBoardId = invalidId;
    assert.throws(() => validateWorkspace(board), /validi/);
    const task = fixture();
    task.boards[0].cards[1].tasks[0].id = invalidId;
    assert.throws(() => validateWorkspace(task), /validi/);
  }
});

test('localStorage fallback roundtrips and reports quota failure without deleting previous data', async () => {
  const memory = new Map();
  globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const store = await openStore();
  assert.equal(store.backend, 'localStorage');
  assert.equal(await store.load(), null);
  const workspace = fixture();
  await store.save(workspace);
  assert.deepEqual(await store.load(), validateWorkspace(workspace));
  const previous = [...memory.values()][0];
  globalThis.localStorage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  await assert.rejects(store.save(workspace), /Spazio locale esaurito/);
  assert.equal([...memory.values()][0], previous);
});

test('corrupted local data is reported and retained for recovery', async () => {
  const corrupt = '{bad json';
  globalThis.localStorage = { getItem: () => corrupt, setItem: () => { throw new Error('should not overwrite'); } };
  const store = await openStore();
  await assert.rejects(store.load(), /Non sono stati sovrascritti/);
});

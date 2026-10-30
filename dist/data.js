/** Aiming local persistence and password-protected, portable backups. */
const FORMAT = 'aiming-encrypted';
const ITERATIONS = 600000;
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_LENGTH = 16 * 1024 * 1024;
const DATABASE = 'aiming-local';
const TABLE = 'workspace';
const STORAGE_KEY = 'aiming.workspace.v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message = 'Il file non contiene dati Aiming validi.') { throw new Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function string(value, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) fail();
  return value;
}
function identifier(value) {
  const result = string(value, 160);
  if (!/^[-_a-zA-Z0-9]{1,160}$/.test(result)) fail();
  return result;
}
function number(value, min, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail();
  return value;
}
function color(value, fallback) {
  const result = string(value, 32, fallback);
  if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(result)) fail();
  return result;
}
function timestamp(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))) return value;
  fail();
}
function cryptoAPI() {
  if (!globalThis.crypto?.subtle) fail('La cifratura richiede un browser aggiornato e una connessione HTTPS o localhost.');
  return globalThis.crypto;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createBoard(name, icon = 'grid', boardColor = '#f28b50') {
  const now = Date.now();
  return {
    id: uid(), name: String(name || 'Nuova lavagna').trim().slice(0, 160) || 'Nuova lavagna',
    icon, color: boardColor, createdAt: now, updatedAt: now, cards: [], connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** Returns a fresh, allowlisted copy. Never inserts imported HTML or trusts prototypes. */
export function validateWorkspace(input) {
  if (!object(input) || input.version !== 1 || !Array.isArray(input.boards) || input.boards.length < 1 || input.boards.length > 200) fail();
  let totalCards = 0;
  const boardIds = new Set();
  const boards = input.boards.map(board => {
    if (!object(board) || !Array.isArray(board.cards) || board.cards.length > 5000) fail();
    totalCards += board.cards.length;
    if (totalCards > 10000) fail('Il backup contiene troppe card (massimo 10.000).');
    const id = identifier(board.id);
    if (boardIds.has(id)) fail('Il backup contiene lavagne duplicate.');
    boardIds.add(id);
    const cardIds = new Set();
    const cards = board.cards.map(card => {
      if (!object(card) || !['note', 'text', 'tasks', 'todo', 'image', 'link', 'frame'].includes(card.type)) fail();
      const cardId = identifier(card.id);
      if (cardIds.has(cardId)) fail('Il backup contiene card duplicate.');
      cardIds.add(cardId);
      const clean = {
        id: cardId, type: card.type,
        x: number(card.x, -10000000, 10000000), y: number(card.y, -10000000, 10000000),
        width: number(card.width, 40, 5000, 260),
        title: string(card.title, 10000, ''), content: string(card.content, 200000, ''),
        color: color(card.color, '#ffffff'),
      };
      if (card.height !== undefined) clean.height = number(card.height, 20, 10000);
      for (const field of ['category', 'imageName', 'caption']) if (card[field] !== undefined) clean[field] = string(card[field], 1000);
      if (card.fontSize !== undefined) clean.fontSize = number(card.fontSize, 8, 160);
      for (const field of ['bold', 'italic', 'underline', 'textBackground']) if (card[field] !== undefined) {
        if (typeof card[field] !== 'boolean') fail();
        clean[field] = card[field];
      }
      if (card.textColor !== undefined) clean.textColor = color(card.textColor);
      if (card.textAlign !== undefined) {
        if (!['left', 'center', 'right'].includes(card.textAlign)) fail();
        clean.textAlign = card.textAlign;
      }
      if (card.fontFamily !== undefined) {
        if (!['sans', 'serif', 'mono'].includes(card.fontFamily)) fail();
        clean.fontFamily = card.fontFamily;
      }
      if (card.rotation !== undefined) clean.rotation = number(card.rotation, -360, 360);
      if (card.zIndex !== undefined) clean.zIndex = number(card.zIndex, -100000, 100000);
      if (card.collapsed !== undefined) clean.collapsed = Boolean(card.collapsed);
      if (card.tasks !== undefined) {
        if (!Array.isArray(card.tasks) || card.tasks.length > 500) fail();
        const taskIds = new Set();
        clean.tasks = card.tasks.map(task => {
          if (!object(task) || typeof task.done !== 'boolean') fail();
          const taskId = identifier(task.id);
          if (taskIds.has(taskId)) fail();
          taskIds.add(taskId);
          return { id: taskId, text: string(task.text, 10000), done: task.done };
        });
      }
      if (card.src !== undefined) {
        const src = string(card.src, MAX_IMAGE_LENGTH);
        if (!/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(src)) fail('Una delle immagini non è valida. Sono supportate immagini PNG, JPEG, GIF, WebP, AVIF e BMP.');
        clean.src = src;
      }
      if (card.url !== undefined && card.url !== '') {
        const url = string(card.url, 8000);
        let parsed;
        try { parsed = new URL(url); } catch { fail('Uno dei collegamenti non è valido.'); }
        if (!['https:', 'http:'].includes(parsed.protocol)) fail('I collegamenti devono usare HTTP o HTTPS.');
        clean.url = url;
      }
      return clean;
    });
    const connections = board.connections ?? [];
    if (!Array.isArray(connections) || connections.length > 10000) fail();
    const connectionIds = new Set();
    const cleanConnections = connections.map(connection => {
      if (!object(connection)) fail();
      const connectionId = identifier(connection.id);
      const from = identifier(connection.from), to = identifier(connection.to);
      if (connectionIds.has(connectionId) || !cardIds.has(from) || !cardIds.has(to) || from === to) fail('Il backup contiene un collegamento tra card non valido.');
      connectionIds.add(connectionId);
      const clean = { id: connectionId, from, to };
      if (connection.color !== undefined) clean.color = color(connection.color);
      if (connection.label !== undefined) clean.label = string(connection.label, 1000);
      return clean;
    });
    const viewport = board.viewport ?? { x: 0, y: 0, zoom: 1 };
    if (!object(viewport)) fail();
    const cleanBoard = {
      id, name: string(board.name, 160), icon: string(board.icon, 64, 'grid'), color: color(board.color, '#f28b50'),
      createdAt: timestamp(board.createdAt, Date.now()), updatedAt: timestamp(board.updatedAt, Date.now()),
      cards, connections: cleanConnections,
      viewport: { x: number(viewport.x, -10000000, 10000000, 0), y: number(viewport.y, -10000000, 10000000, 0), zoom: number(viewport.zoom, 0.05, 10, 1) },
    };
    if (board.favorite !== undefined) cleanBoard.favorite = Boolean(board.favorite);
    if (board.description !== undefined) cleanBoard.description = string(board.description, 10000);
    return cleanBoard;
  });
  const activeBoardId = identifier(input.activeBoardId);
  if (!boardIds.has(activeBoardId)) fail('La lavagna attiva del backup non esiste.');
  const result = { version: 1, activeBoardId, boards };
  if (input.settings !== undefined) {
    if (!object(input.settings)) fail();
    result.settings = {};
    if (input.settings.grid !== undefined) {
      if (!['dots', 'lines', 'none'].includes(input.settings.grid)) fail();
      result.settings.grid = input.settings.grid;
    }
    if (input.settings.background !== undefined) result.settings.background = color(input.settings.background);
    if (input.settings.theme !== undefined) {
      if (!['light', 'dark', 'system'].includes(input.settings.theme)) fail();
      result.settings.theme = input.settings.theme;
    }
  }
  return result;
}

function serialise(workspace) {
  const clean = validateWorkspace(workspace);
  const json = JSON.stringify(clean);
  if (encoder.encode(json).byteLength > MAX_JSON_BYTES) fail('I dati superano il limite di 40 MB. Riduci le immagini prima di salvare.');
  return { clean, json };
}

function storageError(error) {
  if (error?.name === 'QuotaExceededError') return new Error('Spazio locale esaurito. Esporta un backup e riduci le immagini. Le ultime modifiche non sono state salvate.');
  return new Error('Salvataggio locale non disponibile. Esporta un backup per conservare le modifiche.');
}

function fallbackStore() {
  return {
    backend: 'localStorage',
    async load() {
      let stored;
      try { stored = globalThis.localStorage.getItem(STORAGE_KEY); } catch (error) { throw storageError(error); }
      if (stored === null) return null;
      if (stored.length > MAX_JSON_BYTES) fail('I dati locali sono troppo grandi. Ripristina un backup.');
      try { return validateWorkspace(JSON.parse(stored)); } catch { fail('I dati locali non sono leggibili. Non sono stati sovrascritti; ripristina un backup.'); }
    },
    async save(workspace) {
      const { json } = serialise(workspace);
      try { globalThis.localStorage.setItem(STORAGE_KEY, json); } catch (error) { throw storageError(error); }
    },
  };
}

/** IDB stores images without localStorage's small quota; fallback is explicit via backend. */
export async function openStore() {
  if (!globalThis.indexedDB) return fallbackStore();
  let database;
  try {
    database = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(TABLE)) request.result.createObjectStore(TABLE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Database bloccato'));
    });
  } catch { return fallbackStore(); }
  database.onversionchange = () => database.close();
  return {
    backend: 'indexedDB',
    async load() {
      let stored;
      try {
        stored = await new Promise((resolve, reject) => {
          const transaction = database.transaction(TABLE, 'readonly');
          const request = transaction.objectStore(TABLE).get('current');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } catch (error) { throw storageError(error); }
      if (stored === undefined) {
        // An unavailable localStorage is harmless here; existing unreadable data is not.
        let fallback;
        try { fallback = globalThis.localStorage?.getItem(STORAGE_KEY); } catch { return null; }
        if (fallback == null) return null;
        if (fallback.length > MAX_JSON_BYTES) fail('I dati locali sono troppo grandi. Ripristina un backup.');
        try { return validateWorkspace(JSON.parse(fallback)); } catch { fail('I dati locali non sono leggibili. Non sono stati sovrascritti; ripristina un backup.'); }
      }
      try { return validateWorkspace(stored); } catch { fail('I dati locali non sono leggibili. Non sono stati sovrascritti; ripristina un backup.'); }
    },
    async save(workspace) {
      const { clean } = serialise(workspace);
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(TABLE, 'readwrite');
          transaction.objectStore(TABLE).put(clean, 'current');
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } catch (error) { throw storageError(error); }
    },
    close() { database.close(); },
  };
}

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function fromBase64(value, max, exact) {
  // A simple character-class scan avoids regexp stack exhaustion on image backups.
  if (typeof value !== 'string' || value.length > max || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('Il file cifrato è danneggiato o non valido.');
  let binary;
  try { binary = atob(value); } catch { fail('Il file cifrato è danneggiato o non valido.'); }
  if (exact !== undefined && binary.length !== exact) fail('Il file cifrato è danneggiato o non valido.');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function deriveKey(password, salt, iterations) {
  const crypto = cryptoAPI();
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptWorkspace(workspace, password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) fail('Scegli una password tra 8 e 1.024 caratteri.');
  const { json } = serialise(workspace);
  const crypto = cryptoAPI();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(json));
  return {
    format: FORMAT, version: 1, algorithm: 'AES-256-GCM', kdf: 'PBKDF2', hash: 'SHA-256',
    iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptWorkspace(envelope, password) {
  if (typeof password !== 'string' || !password.length || password.length > 1024) fail('Inserisci la password del backup.');
  if (typeof envelope === 'string') {
    if (envelope.length > MAX_JSON_BYTES * 1.4 + 4096) fail('Il file è troppo grande (massimo 56 MB).');
    try { envelope = JSON.parse(envelope); } catch { fail('Il file non è un JSON valido.'); }
  }
  if (!object(envelope) || envelope.format !== FORMAT || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2' || envelope.hash !== 'SHA-256') fail('Questo file non è un backup cifrato di Aiming supportato.');
  if (!Number.isInteger(envelope.iterations) || envelope.iterations < 310000 || envelope.iterations > 2000000) fail('I parametri di cifratura del backup non sono validi.');
  const salt = fromBase64(envelope.salt, 24, 16);
  const iv = fromBase64(envelope.iv, 16, 12);
  const data = fromBase64(envelope.data, Math.ceil((MAX_JSON_BYTES + 16) / 3) * 4);
  if (data.length < 17) fail('Il file cifrato è vuoto o danneggiato.');
  const key = await deriveKey(password, salt, envelope.iterations);
  let plaintext;
  try {
    plaintext = await cryptoAPI().subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  } catch { fail('Password errata oppure backup danneggiato. I dati attuali sono al sicuro.'); }
  let decoded;
  try { decoded = JSON.parse(decoder.decode(plaintext)); } catch { fail('Il contenuto del backup non è valido.'); }
  return validateWorkspace(decoded);
}

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const db = new Database(process.env.DB_PATH || 'tecboard.db');

app.use(express.urlencoded({ extended: true }));

// Inicializar tabla de publicaciones
db.prepare(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT NOT NULL,
    owner_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Migración: añadir owner_token a bases de datos existentes
try {
  db.prepare('ALTER TABLE posts ADD COLUMN owner_token TEXT').run();
} catch (e) {
  // La columna ya existe: ignorar
}

// Utilidad: leer cookies sin dependencias extra
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

const TOKENS_COOKIE = 'owner_tokens';
const MAX_TOKENS = 50; // límite de mensajes eliminables por navegador

// Devuelve la lista de tokens (strings) que este navegador usó al publicar
function getTokens(req) {
  const raw = parseCookies(req)[TOKENS_COOKIE];
  if (!raw) return [];
  return raw.split(',').filter(t => /^[0-9a-f-]{36}$/.test(t));
}

// ¿Este navegador es el dueño del mensaje dado?
function isOwner(req, post) {
  return !!post.owner_token && getTokens(req).includes(post.owner_token);
}

// --- Modo moderador (contraseña maestra) ---
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'tecboard2026';
const MOD_TTL_HOURS = 1; // duración de la sesión de moderador

db.prepare(`
  CREATE TABLE IF NOT EXISTS mod_sessions (
    token TEXT PRIMARY KEY,
    expires_at DATETIME
  )
`).run();

function purgeExpiredSessions() {
  db.prepare('DELETE FROM mod_sessions WHERE expires_at < CURRENT_TIMESTAMP').run();
}

// Comprobación en tiempo constante para no filtrar la contraseña con medidor de tiempo
function checkMasterPassword(password) {
  const a = crypto.createHash('sha256').update(String(password)).digest();
  const b = crypto.createHash('sha256').update(MASTER_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// ¿El navegador tiene una sesión de moderador válida?
function getModToken(req) {
  const token = parseCookies(req)['mod_session'];
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

function isModerator(req) {
  const token = getModToken(req);
  if (!token) return false;
  return !!db.prepare(
    'SELECT token FROM mod_sessions WHERE token = ? AND expires_at >= CURRENT_TIMESTAMP'
  ).get(token);
}

// Escape de HTML para evitar inyección en los mensajes
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Ruta principal (Tablero)
app.get('/', (req, res) => {
  const moderator = isModerator(req);
  purgeExpiredSessions();
  const posts = db.prepare('SELECT * FROM posts ORDER BY id DESC').all();

  const postsHtml = posts.map(p => `
    <div class="post">
      <div class="post-header">
        <span class="title">${escapeHtml(p.title) || 'Anónimo'}</span> 
        <span class="date">${escapeHtml(p.created_at)}</span>
        <span class="id">No. ${p.id}</span>
      </div>
      <div class="content">${escapeHtml(p.content).replace(/\n/g, '<br>')}</div>
      ${(isOwner(req, p) || moderator) ? `
      <div class="delete-row">
        <form action="/delete/${p.id}" method="POST" onsubmit="return confirm('¿Borrar este mensaje?');">
          <button type="submit" class="delete-btn">Borrar</button>
        </form>
      </div>` : ''}
    </div>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>TecBoard - Tablero Digital</title>
      <style>
        body { font-family: sans-serif; background: #eef2f5; color: #000; margin: 0; padding: 20px; }
        h1 { color: #800000; text-align: center; }
        .box { background: #d1d5ee; border: 1px solid #99a; max-width: 500px; margin: 0 auto 20px; padding: 15px; border-radius: 4px; }
        input, textarea { width: 100%; margin-bottom: 10px; box-sizing: border-box; padding: 8px; }
        button { background: #800000; color: white; border: none; padding: 8px 15px; cursor: pointer; }
        .post { background: #f0e0d6; border: 1px solid #d9bfb7; max-width: 700px; margin: 10px auto; padding: 12px; border-radius: 4px; }
        .post-header { color: #117743; font-size: 0.9em; margin-bottom: 8px; }
        .title { font-weight: bold; color: #0f0c5d; }
        .date { color: #666; margin: 0 10px; }
        .content { font-size: 1em; line-height: 1.4; }
        .delete-row { margin-top: 10px; text-align: right; }
        .delete-btn { background: #b02020; font-size: 0.8em; padding: 5px 12px; border-radius: 3px; }
        .delete-btn:hover { background: #8b1a1a; }
        .mod-box { background: #f5f5f5; border: 1px dashed #999; max-width: 500px; margin: 0 auto 20px; padding: 10px 15px; border-radius: 4px; font-size: 0.9em; }
        .mod-box input { display: inline-block; width: auto; margin: 0 8px 0 0; }
        .mod-badge { background: #b02020; color: white; padding: 1px 8px; border-radius: 3px; font-size: 0.85em; margin-left: 8px; }
      </style>
    </head>
    <body>
      <h1>[ TecBoard ]</h1>
      <div class="box">
        <h3>Publicar Anuncio</h3>
        <form action="/post" method="POST">
          <input type="text" name="title" placeholder="Título / Asunto (Opcional)">
          <textarea name="content" rows="4" placeholder="Escribe el mensaje..." required></textarea>
          <button type="submit">Publicar</button>
        </form>
      </div>
      ${moderator ? `
      <div class="mod-box">
        <span class="mod-badge">MODO MODERADOR</span>
        Puedes borrar cualquier mensaje durante ${MOD_TTL_HOURS} h.
        <form action="/mod/logout" method="POST" style="display:inline;">
          <button type="submit" style="font-size:0.8em; padding:4px 10px;">Cerrar sesión moderador</button>
        </form>
      </div>` : `
      <div class="mod-box">
        <form action="/mod" method="POST">
          <strong>Moderador:</strong>
          <input type="password" name="password" placeholder="Contraseña maestra" required>
          <button type="submit" style="font-size:0.8em; padding:4px 10px;">Entrar</button>
        </form>
      </div>`}
      <hr style="max-width: 700px;">
      <div id="board">${postsHtml}</div>
    </body>
    </html>
  `);
});

// Guardar nueva publicación
app.post('/post', (req, res) => {
  const { title, content } = req.body;
  if (content && content.trim()) {
    // Token secreto que identifica al autor en este navegador
    const ownerToken = crypto.randomUUID();
    db.prepare('INSERT INTO posts (title, content, owner_token) VALUES (?, ?, ?)').run(title, content, ownerToken);

    // Añadimos el token a la cookie (lista) para poder borrar este mensaje más tarde
    const tokens = [...getTokens(req), ownerToken].slice(-MAX_TOKENS);
    res.setHeader('Set-Cookie', `${TOKENS_COOKIE}=${tokens.join(',')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  }
  res.redirect('/');
});

// Borrar una publicación: solo su autor o un moderador (comprobado en el servidor)
app.post('/delete/:id', (req, res) => {
  const moderator = isModerator(req);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (post && (moderator || isOwner(req, post))) {
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    // El autor retira su token de la cookie para no acumular tokens sin uso
    if (!moderator) {
      const tokens = getTokens(req).filter(t => t !== post.owner_token);
      const value = tokens.length
        ? `${TOKENS_COOKIE}=${tokens.join(',')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
        : `${TOKENS_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
      res.setHeader('Set-Cookie', value);
    }
  }
  res.redirect('/');
});

// Rate limit simple (en memoria) para evitar fuerza bruta de la contraseña maestra
const modAttempts = new Map(); // ip -> { count, resetAt }
const MOD_MAX_ATTEMPTS = 10;
const MOD_WINDOW_MS = 10 * 60 * 1000;

function isModRateLimited(ip) {
  const now = Date.now();
  let entry = modAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + MOD_WINDOW_MS };
    modAttempts.set(ip, entry);
  }
  entry.count++;
  return entry.count > MOD_MAX_ATTEMPTS;
}

// Entrar en modo moderador: exige la contraseña maestra
app.post('/mod', (req, res) => {
  if (isModRateLimited(req.ip)) {
    res.status(429).send('Demasiados intentos. Espera 10 minutos.');
    return;
  }
  if (checkMasterPassword(req.body.password || '')) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO mod_sessions (token, expires_at) VALUES (?, datetime(CURRENT_TIMESTAMP, ?))')
      .run(token, `+${MOD_TTL_HOURS} hours`);
    res.setHeader('Set-Cookie', `mod_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MOD_TTL_HOURS * 60 * 60}`);
    modAttempts.delete(req.ip); // éxito: resetear contador
  }
  res.redirect('/');
});

// Cerrar sesión de moderador
app.post('/mod/logout', (req, res) => {
  const token = getModToken(req);
  if (token) db.prepare('DELETE FROM mod_sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'mod_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TecBoard activo en puerto ${PORT}`));

// Endpoint exclusivo para el Cron Job
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});
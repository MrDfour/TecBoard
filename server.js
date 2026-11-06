const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database('tecboard.db');

app.use(express.urlencoded({ extended: true }));

// Inicializar tabla de publicaciones
db.prepare(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Ruta principal (Tablero)
app.get('/', (req, res) => {
  const posts = db.prepare('SELECT * FROM posts ORDER BY id DESC').all();
  
  const postsHtml = posts.map(p => `
    <div class="post">
      <div class="post-header">
        <span class="title">${p.title || 'Anónimo'}</span> 
        <span class="date">${p.created_at}</span>
        <span class="id">No. ${p.id}</span>
      </div>
      <div class="content">${p.content.replace(/\n/g, '<br>')}</div>
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
    db.prepare('INSERT INTO posts (title, content) VALUES (?, ?)').run(title, content);
  }
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TecBoard activo en puerto ${PORT}`));
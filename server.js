/* ═══════════════════════════════════════════════════
   NeuralCraft — Express + SQLite Server
   Replaces localStorage with a persistent database
   Uses sql.js (pure JS, no native compilation needed)
   ═══════════════════════════════════════════════════ */

const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.db');

// ─── Middleware ────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname), {
  index: 'index.html'
}));

// ─── Database ─────────────────────────────────────
let db = null;

async function initDb() {
  const SQL = await initSqlJs();

  // Load existing DB or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      displayName TEXT,
      role TEXT DEFAULT 'novice',
      passwordHash TEXT NOT NULL,
      createdAt INTEGER
    )
  `);
  db.run(`CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS progress (userId TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}')`);
  db.run(`CREATE TABLE IF NOT EXISTS favorites (userId TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '[]')`);
  db.run(`CREATE TABLE IF NOT EXISTS glossary (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  saveDb();
  console.log('  💾 Database initialized');
}

// Save DB to disk periodically and after writes
let saveTimeout = null;
function saveDb() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (err) {
      console.error('Error saving DB:', err);
    }
  }, 100); // Debounce writes by 100ms
}

// ─── Helper ───────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// ═══════════════════════════════════════════════════
// AUTH API
// ═══════════════════════════════════════════════════

app.post('/api/auth/register', (req, res) => {
  try {
    const { username, displayName, password } = req.body;

    if (!username || !displayName || !password) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Имя пользователя: 3-20 символов, только a-z, 0-9, _' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }

    const existing = queryOne('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existing) {
      return res.status(400).json({ error: 'Это имя пользователя уже занято' });
    }

    const countRow = queryOne('SELECT COUNT(*) as count FROM users');
    const count = countRow ? countRow.count : 0;
    const role = count === 0 ? 'admin' : 'novice';
    const passwordHash = bcrypt.hashSync(password, 10);
    const id = genId();
    const createdAt = Date.now();

    runSql('INSERT INTO users (id, username, displayName, role, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [id, username, displayName, role, passwordHash, createdAt]);

    res.json({
      user: { id, username, displayName, role, createdAt }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }

    const user = queryOne('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }

    res.json({
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, createdAt: user.createdAt }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ═══════════════════════════════════════════════════
// USERS API
// ═══════════════════════════════════════════════════

app.get('/api/users', (req, res) => {
  try {
    const users = queryAll('SELECT id, username, displayName, role, createdAt FROM users ORDER BY createdAt DESC');
    res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.patch('/api/users/:id/role', (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['novice', 'lite', 'standard', 'pro', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Недопустимая роль' });
    }
    runSql('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.patch('/api/users/:id/profile', (req, res) => {
  try {
    const { displayName, password } = req.body;
    if (password) {
      const passwordHash = bcrypt.hashSync(password, 10);
      runSql('UPDATE users SET displayName = ?, passwordHash = ? WHERE id = ?', [displayName, passwordHash, req.params.id]);
    } else {
      runSql('UPDATE users SET displayName = ? WHERE id = ?', [displayName, req.params.id]);
    }

    const user = queryOne('SELECT id, username, displayName, role FROM users WHERE id = ?', [req.params.id]);
    res.json({ user });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/users/:id', (req, res) => {
  try {
    runSql('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ═══════════════════════════════════════════════════
// COURSES API
// ═══════════════════════════════════════════════════

app.get('/api/courses', (req, res) => {
  try {
    const rows = queryAll('SELECT data FROM courses');
    const courses = rows.map(r => JSON.parse(r.data));
    res.json(courses);
  } catch (err) {
    console.error('Get courses error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/courses', (req, res) => {
  try {
    const course = req.body;
    if (!course.id) course.id = genId();
    runSql('INSERT OR REPLACE INTO courses (id, data) VALUES (?, ?)', [course.id, JSON.stringify(course)]);
    res.json({ success: true, id: course.id });
  } catch (err) {
    console.error('Create course error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/courses/:id', (req, res) => {
  try {
    const course = req.body;
    course.id = req.params.id;
    runSql('INSERT OR REPLACE INTO courses (id, data) VALUES (?, ?)', [course.id, JSON.stringify(course)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update course error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/courses/:id', (req, res) => {
  try {
    runSql('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete course error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Bulk save all courses (for import)
app.put('/api/courses', (req, res) => {
  try {
    const courses = req.body;
    runSql('DELETE FROM courses');
    for (const c of courses) {
      db.run('INSERT OR REPLACE INTO courses (id, data) VALUES (?, ?)', [c.id, JSON.stringify(c)]);
    }
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Bulk save courses error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ═══════════════════════════════════════════════════
// PROGRESS API
// ═══════════════════════════════════════════════════

app.get('/api/progress/:userId', (req, res) => {
  try {
    const row = queryOne('SELECT data FROM progress WHERE userId = ?', [req.params.userId]);
    res.json(row ? JSON.parse(row.data) : {});
  } catch (err) {
    console.error('Get progress error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/progress/:userId', (req, res) => {
  try {
    runSql('INSERT OR REPLACE INTO progress (userId, data) VALUES (?, ?)', [req.params.userId, JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Save progress error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ═══════════════════════════════════════════════════
// FAVORITES API
// ═══════════════════════════════════════════════════

app.get('/api/favorites/:userId', (req, res) => {
  try {
    const row = queryOne('SELECT data FROM favorites WHERE userId = ?', [req.params.userId]);
    res.json(row ? JSON.parse(row.data) : []);
  } catch (err) {
    console.error('Get favorites error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/favorites/:userId', (req, res) => {
  try {
    runSql('INSERT OR REPLACE INTO favorites (userId, data) VALUES (?, ?)', [req.params.userId, JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Save favorites error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ═══════════════════════════════════════════════════
// GLOSSARY API
// ═══════════════════════════════════════════════════

app.get('/api/glossary', (req, res) => {
  try {
    const rows = queryAll('SELECT data FROM glossary');
    res.json(rows.map(r => JSON.parse(r.data)));
  } catch (err) {
    console.error('Get glossary error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/glossary', (req, res) => {
  try {
    const term = req.body;
    if (!term.id) term.id = genId();
    runSql('INSERT OR REPLACE INTO glossary (id, data) VALUES (?, ?)', [term.id, JSON.stringify(term)]);
    res.json({ success: true, id: term.id });
  } catch (err) {
    console.error('Save glossary term error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/glossary/:id', (req, res) => {
  try {
    const term = req.body;
    term.id = req.params.id;
    runSql('INSERT OR REPLACE INTO glossary (id, data) VALUES (?, ?)', [term.id, JSON.stringify(term)]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update glossary term error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/glossary/:id', (req, res) => {
  try {
    runSql('DELETE FROM glossary WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete glossary term error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Bulk replace glossary (for import)
app.put('/api/glossary', (req, res) => {
  try {
    const terms = req.body;
    runSql('DELETE FROM glossary');
    for (const t of terms) {
      db.run('INSERT OR REPLACE INTO glossary (id, data) VALUES (?, ?)', [t.id, JSON.stringify(t)]);
    }
    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Bulk save glossary error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ═══════════════════════════════════════════════════
// KV STORE (achievements defs, user achievements, etc.)
// ═══════════════════════════════════════════════════

app.get('/api/kv/:key', (req, res) => {
  try {
    const row = queryOne('SELECT value FROM kv_store WHERE key = ?', [req.params.key]);
    res.json(row ? JSON.parse(row.value) : null);
  } catch (err) {
    console.error('KV get error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/kv/:key', (req, res) => {
  try {
    runSql('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)', [req.params.key, JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (err) {
    console.error('KV set error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ═══════════════════════════════════════════════════
// EXPORT / IMPORT
// ═══════════════════════════════════════════════════

app.get('/api/export', (req, res) => {
  try {
    const users = queryAll('SELECT id, username, displayName, role, passwordHash, createdAt FROM users');
    const courses = queryAll('SELECT data FROM courses').map(r => JSON.parse(r.data));
    const glossary = queryAll('SELECT data FROM glossary').map(r => JSON.parse(r.data));

    res.json({
      users, courses, glossary,
      exportedAt: new Date().toISOString(),
      version: 3
    });
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/import', (req, res) => {
  try {
    const data = req.body;

    if (data.courses && Array.isArray(data.courses)) {
      db.run('DELETE FROM courses');
      for (const c of data.courses) {
        db.run('INSERT OR REPLACE INTO courses (id, data) VALUES (?, ?)', [c.id, JSON.stringify(c)]);
      }
    }
    if (data.glossary && Array.isArray(data.glossary)) {
      db.run('DELETE FROM glossary');
      for (const t of data.glossary) {
        db.run('INSERT OR REPLACE INTO glossary (id, data) VALUES (?, ?)', [t.id, JSON.stringify(t)]);
      }
    }
    // Import users with their password hashes intact
    if (data.users && Array.isArray(data.users)) {
      for (const u of data.users) {
        const existing = queryOne('SELECT id FROM users WHERE id = ?', [u.id]);
        if (!existing) {
          db.run('INSERT INTO users (id, username, displayName, role, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
            [u.id, u.username, u.displayName, u.role, u.passwordHash, u.createdAt]);
        }
      }
    }

    saveDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Ошибка импорта' });
  }
});

// ─── Fallback to index.html ───────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ────────────────────────────────────────
async function start() {
  await initDb();

  const countRow = queryOne('SELECT COUNT(*) as count FROM users');
  const usersCount = countRow ? countRow.count : 0;
  const coursesCount = queryAll('SELECT id FROM courses').length;

  app.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║     NeuralCraft — Сервер запущен       ║');
    console.log('  ╠═══════════════════════════════════════╣');
    console.log(`  ║  🌐 http://localhost:${PORT}              ║`);
    console.log(`  ║  👤 Пользователей: ${String(usersCount).padEnd(18)}║`);
    console.log(`  ║  📚 Курсов: ${String(coursesCount).padEnd(25)}║`);
    console.log('  ║  💾 БД: data.db                        ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

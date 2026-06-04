require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { filterRussianJobs, mapRussianJob } = require('./russian_jobs');

const app = express();
const port = process.env.PORT || 3000;

const sessions = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const hashVerify = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === hashVerify;
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  req.userId = sessions.get(token);
  req.token = token;
  next();
}

async function ensureTables() {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      company VARCHAR(255) NOT NULL,
      location VARCHAR(255),
      salary VARCHAR(255),
      description TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs (title);
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company);
    CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs (location);

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS saved_jobs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      company VARCHAR(255) NOT NULL,
      location VARCHAR(255),
      salary VARCHAR(255),
      description TEXT,
      source VARCHAR(50) DEFAULT 'local',
      external_id VARCHAR(100),
      url TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_saved_jobs_user ON saved_jobs (user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_jobs_unique
      ON saved_jobs (user_id, source, external_id)
      WHERE external_id IS NOT NULL;
  `;

  try {
    await db.query(createTableSql);
    console.log('DB check: tables are ready');
  } catch (err) {
    console.error('DB init error:', err);
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length < 3) {
    return res.status(400).json({ error: 'Логин должен содержать минимум 3 символа' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Пароль должен содержать минимум 4 символа' });
  }

  try {
    const existing = await db.query('SELECT id FROM users WHERE username = $1', [trimmedUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Пользователь с таким логином уже существует' });
    }

    const passwordHash = hashPassword(password);
    const { rows } = await db.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [trimmedUsername, passwordHash]
    );

    const token = createToken();
    sessions.set(token, rows[0].id);

    res.status(201).json({ token, user: { id: rows[0].id, username: rows[0].username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при регистрации' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const user = rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const token = createToken();
    sessions.set(token, user.id);

    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при входе' });
  }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  sessions.delete(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, username, created_at FROM users WHERE id = $1', [
      req.userId,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении профиля' });
  }
});

app.get('/api/my-jobs', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM saved_jobs WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении сохранённых вакансий' });
  }
});

app.post('/api/my-jobs', authMiddleware, async (req, res) => {
  const { title, company, location, salary, description, source, external_id, url } = req.body;

  if (!title || !company) {
    return res.status(400).json({ error: 'Поля title и company обязательны' });
  }

  const jobSource = source || 'local';
  const jobExternalId = external_id ? String(external_id) : null;

  try {
    let existing;
    if (jobExternalId) {
      existing = await db.query(
        'SELECT id FROM saved_jobs WHERE user_id = $1 AND source = $2 AND external_id = $3',
        [req.userId, jobSource, jobExternalId]
      );
    } else {
      existing = await db.query(
        'SELECT id FROM saved_jobs WHERE user_id = $1 AND LOWER(title) = LOWER($2) AND LOWER(company) = LOWER($3)',
        [req.userId, title, company]
      );
    }

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Эта вакансия уже добавлена в личный кабинет' });
    }

    const { rows } = await db.query(
      `INSERT INTO saved_jobs (user_id, title, company, location, salary, description, source, external_id, url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.userId,
        title,
        company,
        location || '',
        salary || '',
        description || '',
        jobSource,
        jobExternalId,
        url || '',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Эта вакансия уже добавлена в личный кабинет' });
    }
    console.error(err);
    res.status(500).json({ error: 'Ошибка при сохранении вакансии' });
  }
});

app.get('/api/my-jobs/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM saved_jobs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Вакансия не найдена' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении вакансии' });
  }
});

app.put('/api/my-jobs/:id', authMiddleware, async (req, res) => {
  const { title, company, location, salary, description } = req.body;

  if (!title || !company) {
    return res.status(400).json({ error: 'Поля title и company обязательны' });
  }

  try {
    const { rows } = await db.query(
      `UPDATE saved_jobs
       SET title = $1, company = $2, location = $3, salary = $4, description = $5, updated_at = NOW()
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [title, company, location || '', salary || '', description || '', req.params.id, req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Вакансия не найдена' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при обновлении вакансии' });
  }
});

app.delete('/api/my-jobs/:id', authMiddleware, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM saved_jobs WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Вакансия не найдена' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при удалении вакансии' });
  }
});

app.get('/api/jobs', async (req, res) => {
  const { q } = req.query;

  try {
    let queryText = 'SELECT * FROM jobs';
    const queryParams = [];

    if (q && q.trim() !== '') {
      queryText +=
        ' WHERE title ILIKE $1 OR company ILIKE $1 OR location ILIKE $1 OR description ILIKE $1';
      queryParams.push(`%${q}%`);
    }

    queryText += ' ORDER BY created_at DESC';

    const { rows } = await db.query(queryText, queryParams);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении вакансий' });
  }
});

app.post('/api/jobs', async (req, res) => {
  const { title, company, location, salary, description } = req.body;

  if (!title || !company) {
    return res.status(400).json({ error: 'Поля title и company обязательны' });
  }

  try {
    const insertQuery = `
      INSERT INTO jobs (title, company, location, salary, description)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const { rows } = await db.query(insertQuery, [
      title,
      company,
      location || '',
      salary || '',
      description || '',
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при создании вакансии' });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Вакансия не найдена' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении вакансии' });
  }
});

app.delete('/api/jobs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM jobs WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Вакансия не найдена' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при удалении вакансии' });
  }
});

app.get('/api/russian-jobs', async (req, res) => {
  const { q } = req.query;

  try {
    const jobs = filterRussianJobs(q).map(mapRussianJob);
    res.json(jobs);
  } catch (err) {
    console.error('Russian jobs error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке российских вакансий' });
  }
});

// Обратная совместимость со старым URL
app.get('/api/external-jobs', async (req, res) => {
  const { q } = req.query;

  try {
    const jobs = filterRussianJobs(q).map(mapRussianJob);
    res.json(jobs);
  } catch (err) {
    console.error('Russian jobs error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке российских вакансий' });
  }
});

ensureTables().then(() => {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
});

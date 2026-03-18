require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const db = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
//
    CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs (title);
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company);
    CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs (location);
  `;

  try {
    await db.query(createTableSql);
    console.log('DB check: jobs table is ready');
  } catch (err) {
    console.error('DB init error:', err);
  }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
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

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

app.get('/api/external-jobs', async (req, res) => {
  const { q } = req.query;

  try {
    const response = await fetch('https://remoteok.com/api');
    if (!response.ok) {
      throw new Error('Failed to fetch external jobs');
    }
    const data = await response.json();

    let jobs = Array.isArray(data) ? data.slice(1) : [];
    jobs = jobs.map((job) => {
      const rawDescription = job.description || job.description_plain || job.tagline || '';
      const cleanDescription = stripHtml(rawDescription);
      const shortDescription =
        cleanDescription.length > 600
          ? `${cleanDescription.slice(0, 600)}…`
          : cleanDescription;

      return {
        id: job.id,
        title: job.position || job.title || 'Без названия',
        company: job.company || 'Не указана',
        location: job.location || (job.remote ? 'Remote' : ''),
        salary: job.salary || '',
        description: shortDescription,
        created_at: job.date || job.created_at || null,
        source: 'external',
        url: job.url || job.apply_url || '',
      };
    });

    if (q && q.trim() !== '') {
      const query = q.trim().toLowerCase();
      jobs = jobs.filter((job) => {
        const text = `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase();
        return text.includes(query);
      });
    }

    res.json(jobs);
  } catch (err) {
    console.error('External jobs error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке вакансий из интернета' });
  }
});

ensureTables().then(() => {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
});


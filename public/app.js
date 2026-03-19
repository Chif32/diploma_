const API_BASE = '/api';

async function fetchJobs(query = '') {
  const params = new URLSearchParams();
  if (query.trim() !== '') {
    params.set('q', query.trim());
  }

  const url = `${API_BASE}/jobs${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Не удалось загрузить вакансии');
  }
  return res.json();
}

async function fetchExternalJobs(query = '') {
  const params = new URLSearchParams();
  if (query.trim() !== '') {
    params.set('q', query.trim());
  }

  const url = `${API_BASE}/external-jobs${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Не удалось загрузить вакансии из интернета');
  }
  return res.json();
}

function formatDate(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function deleteJob(id) {
  const res = await fetch(`${API_BASE}/jobs/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Не удалось удалить вакансию');
  }
}

function renderJobs(jobs) {
  const listEl = document.getElementById('jobs-list');
  const emptyEl = document.getElementById('jobs-empty');
  const countEl = document.getElementById('jobs-count');

  listEl.innerHTML = '';

  if (!jobs || jobs.length === 0) {
    emptyEl.classList.remove('hidden');
    countEl.textContent = '';
    return;
  }

  emptyEl.classList.add('hidden');
  countEl.textContent = `Найдено вакансий: ${jobs.length}`;

  jobs.forEach((job) => {
    const card = document.createElement('article');
    card.className = 'job-card';

    const header = document.createElement('div');
    header.className = 'job-header';

    const title = document.createElement('div');
    title.className = 'job-title';
    title.textContent = job.title;

    const rightSide = document.createElement('div');
    rightSide.style.display = 'flex';
    rightSide.style.alignItems = 'center';
    rightSide.style.gap = '8px';

    const salary = document.createElement('div');
    salary.className = 'job-salary';
    salary.textContent = job.salary || '';

    rightSide.appendChild(salary);

    if (job.source !== 'external') {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Удалить';
      deleteBtn.style.backgroundColor = '#dc2626';
      deleteBtn.style.fontSize = '12px';
      deleteBtn.style.padding = '4px 10px';

      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Удалить эту вакансию?')) return;
        try {
          await deleteJob(job.id);
          await loadJobs(document.getElementById('search-input').value || '');
        } catch (err) {
          console.error(err);
          alert('Ошибка при удалении вакансии');
        }
      });

      rightSide.appendChild(deleteBtn);
    }

    header.appendChild(title);
    header.appendChild(rightSide);

    const company = document.createElement('div');
    company.className = 'job-company';
    company.textContent = job.company;

    const meta = document.createElement('div');
    meta.className = 'job-meta';
    const parts = [];
    if (job.location) parts.push(job.location);
  if (job.created_at) parts.push(formatDate(job.created_at));
  if (job.source === 'external') parts.push('Интернет');
    meta.textContent = parts.join(' • ');

    const description = document.createElement('div');
    description.className = 'job-description';
    description.textContent = job.description || '';

    card.appendChild(header);
    card.appendChild(company);
    card.appendChild(meta);
    card.appendChild(description);

    listEl.appendChild(card);
  });
}

async function loadJobs(query = '') {
  try {
    const jobs = await fetchJobs(query);
    renderJobs(jobs);
  } catch (err) {
    console.error(err);
    alert('Ошибка при загрузке вакансий');
  }
}

async function loadExternalJobs(query = '') {
  try {
    const jobs = await fetchExternalJobs(query);
    renderJobs(jobs);
  } catch (err) {
    console.error(err);
    alert('Ошибка при загрузке вакансий из интернета');
  }
}

async function createJob(payload) {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error || 'Ошибка при создании вакансии';
    throw new Error(msg);
  }
  return res.json();
}

document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const createForm = document.getElementById('create-form');
  const createMessage = document.getElementById('create-message');
  const internetButton = document.getElementById('search-internet');

  loadJobs();

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = searchInput.value || '';
    loadJobs(query);
  });

  if (internetButton) {
    internetButton.addEventListener('click', (e) => {
      e.preventDefault();
      const query = searchInput.value || '';
      loadExternalJobs(query);
    });
  }

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    createMessage.textContent = '';
    createMessage.classList.remove('form-message--success', 'form-message--error');

    const payload = {
      title: document.getElementById('title').value.trim(),
      company: document.getElementById('company').value.trim(),
      location: document.getElementById('location').value.trim(),
      salary: document.getElementById('salary').value.trim(),
      description: document.getElementById('description').value.trim(),
    };

    if (!payload.title || !payload.company) {
      createMessage.textContent = 'Поля "Название должности" и "Компания" обязательны';
      createMessage.classList.add('form-message--error');
      return;
    }

    try {
      await createJob(payload);
      createMessage.textContent = 'Вакансия успешно создана';
      createMessage.classList.add('form-message--success');
      createForm.reset();
      loadJobs(searchInput.value || '');
    } catch (err) {
      console.error(err);
      createMessage.textContent = err.message || 'Ошибка при создании вакансии';
      createMessage.classList.add('form-message--error');
    }
  });
});

//
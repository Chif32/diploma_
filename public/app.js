const API_BASE = '/api';

let currentUser = null;
let currentDetailJobId = null;
let savedJobKeys = new Set();

function getContentKey(title, company) {
  return `content:${(title || '').toLowerCase()}|${(company || '').toLowerCase()}`;
}

function getJobKey(job) {
  const source = job.source || 'local';
  if (job.id != null) return `${source}:${job.id}`;
  return getContentKey(job.title, job.company);
}

function getSavedJobKey(savedJob) {
  if (savedJob.external_id) {
    return `${savedJob.source || 'local'}:${savedJob.external_id}`;
  }
  return getContentKey(savedJob.title, savedJob.company);
}

async function refreshSavedJobKeys() {
  savedJobKeys = new Set();
  if (!currentUser) return;
  try {
    const jobs = await fetchMyJobs();
    jobs.forEach((job) => {
      savedJobKeys.add(getSavedJobKey(job));
      savedJobKeys.add(getContentKey(job.title, job.company));
    });
  } catch {
    savedJobKeys = new Set();
  }
}

function isJobAlreadySaved(job) {
  if (savedJobKeys.has(getJobKey(job))) return true;
  return savedJobKeys.has(getContentKey(job.title, job.company));
}

function getToken() {
  return localStorage.getItem('authToken');
}

function setToken(token) {
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
}

function authHeaders() {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  });
  return res;
}

function showView(viewName) {
  document.querySelectorAll('.view').forEach((el) => el.classList.add('hidden'));
  document.getElementById(`view-${viewName}`).classList.remove('hidden');

  const navHighlight = viewName === 'cabinet-detail' ? 'cabinet' : viewName;
  document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.classList.toggle('nav-btn--active', btn.dataset.view === navHighlight);
  });

  if (viewName === 'cabinet' && currentUser) {
    loadMyJobs();
  }
}

function showCabinetJobDetail(job) {
  currentDetailJobId = job.id;
  document.getElementById('detail-title').textContent = job.title;
  document.getElementById('detail-company').textContent = job.company;
  document.getElementById('detail-meta').textContent = [job.location, formatDate(job.created_at)]
    .filter(Boolean)
    .join(' • ');
  document.getElementById('detail-salary').textContent = job.salary || '';
  document.getElementById('detail-description').textContent = job.description || '';
  showView('cabinet-detail');
}

function updateAuthUI() {
  const userInfo = document.getElementById('user-info');
  const logoutBtn = document.getElementById('logout-btn');
  const navAuth = document.getElementById('nav-auth');
  const cabinetHint = document.getElementById('cabinet-auth-hint');
  const cabinetUser = document.getElementById('cabinet-user');

  if (currentUser) {
    userInfo.textContent = currentUser.username;
    userInfo.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    navAuth.classList.add('hidden');
    cabinetHint.classList.add('hidden');
    cabinetUser.textContent = `Пользователь: ${currentUser.username}`;
  } else {
    userInfo.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    navAuth.classList.remove('hidden');
    cabinetHint.classList.remove('hidden');
    cabinetUser.textContent = '';
  }
}

async function checkAuth() {
  const token = getToken();
  if (!token) {
    currentUser = null;
    savedJobKeys = new Set();
    updateAuthUI();
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/auth/me`);
    if (!res.ok) {
      setToken(null);
      currentUser = null;
    } else {
      currentUser = await res.json();
    }
  } catch {
    setToken(null);
    currentUser = null;
  }
  updateAuthUI();
  await refreshSavedJobKeys();
}

async function login(username, password) {
  const res = await apiFetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка входа');
  setToken(data.token);
  currentUser = data.user;
  updateAuthUI();
  await refreshSavedJobKeys();
  return data;
}

async function register(username, password) {
  const res = await apiFetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка регистрации');
  setToken(data.token);
  currentUser = data.user;
  updateAuthUI();
  await refreshSavedJobKeys();
  return data;
}

async function logout() {
  try {
    await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  } catch {
    /* ignore */
  }
  setToken(null);
  currentUser = null;
  savedJobKeys = new Set();
  updateAuthUI();
  showView('search');
}

async function fetchJobs(query = '') {
  const params = new URLSearchParams();
  if (query.trim() !== '') params.set('q', query.trim());
  const url = `${API_BASE}/jobs${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось загрузить вакансии');
  return res.json();
}

async function fetchRussianJobs(query = '') {
  const params = new URLSearchParams();
  if (query.trim() !== '') params.set('q', query.trim());
  const url = `${API_BASE}/russian-jobs${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось загрузить российские вакансии');
  return res.json();
}

async function fetchMyJobs() {
  const res = await apiFetch(`${API_BASE}/my-jobs`);
  if (!res.ok) throw new Error('Не удалось загрузить сохранённые вакансии');
  return res.json();
}

async function saveJobToCabinet(job) {
  const res = await apiFetch(`${API_BASE}/my-jobs`, {
    method: 'POST',
    body: JSON.stringify({
      title: job.title,
      company: job.company,
      location: job.location || '',
      salary: job.salary || '',
      description: job.description || '',
      source: job.source || 'local',
      external_id: job.id != null ? String(job.id) : null,
      url: job.url || '',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось сохранить вакансию');
  savedJobKeys.add(getJobKey(job));
  savedJobKeys.add(getContentKey(job.title, job.company));
  return data;
}

async function deleteMyJob(id) {
  const res = await apiFetch(`${API_BASE}/my-jobs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Не удалось удалить вакансию');
}

async function deleteJob(id) {
  const res = await fetch(`${API_BASE}/jobs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Не удалось удалить вакансию');
}

function getSourceLabel(source) {
  if (source === 'russian' || source === 'external') return 'Россия';
  return '';
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

function createAddButton(job) {
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-add';

  if (isJobAlreadySaved(job)) {
    addBtn.disabled = true;
    addBtn.textContent = '✓';
    addBtn.title = 'Уже в личном кабинете';
    return addBtn;
  }

  addBtn.title = 'Добавить в личный кабинет';
  addBtn.textContent = '+';

  addBtn.addEventListener('click', async () => {
    if (!currentUser) {
      alert('Войдите в аккаунт, чтобы добавлять вакансии в личный кабинет');
      showView('auth');
      return;
    }
    if (isJobAlreadySaved(job)) {
      addBtn.disabled = true;
      addBtn.textContent = '✓';
      addBtn.title = 'Уже в личном кабинете';
      return;
    }
    try {
      addBtn.disabled = true;
      addBtn.textContent = '✓';
      await saveJobToCabinet(job);
      addBtn.title = 'Добавлено в личный кабинет';
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка при сохранении вакансии');
      addBtn.disabled = false;
      addBtn.textContent = '+';
    }
  });

  return addBtn;
}

function renderJobs(jobs, options = {}) {
  const { listId = 'jobs-list', emptyId = 'jobs-empty', countId = 'jobs-count', showAdd = true, showDelete = true } = options;

  const listEl = document.getElementById(listId);
  const emptyEl = document.getElementById(emptyId);
  const countEl = document.getElementById(countId);

  listEl.innerHTML = '';

  if (!jobs || jobs.length === 0) {
    emptyEl.classList.remove('hidden');
    if (countEl) countEl.textContent = '';
    return;
  }

  emptyEl.classList.add('hidden');
  if (countEl) countEl.textContent = `Найдено вакансий: ${jobs.length}`;

  jobs.forEach((job) => {
    const card = document.createElement('article');
    card.className = 'job-card';

    const header = document.createElement('div');
    header.className = 'job-header';

    const title = document.createElement('div');
    title.className = 'job-title';
    title.textContent = job.title;

    const rightSide = document.createElement('div');
    rightSide.className = 'job-actions';

    const salary = document.createElement('div');
    salary.className = 'job-salary';
    salary.textContent = job.salary || '';
    rightSide.appendChild(salary);

    if (showAdd) {
      rightSide.appendChild(createAddButton(job));
    }

    if (showDelete && job.source !== 'russian' && job.source !== 'external' && listId === 'jobs-list') {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-danger btn-sm';
      deleteBtn.textContent = 'Удалить';
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
    const sourceLabel = getSourceLabel(job.source);
    if (sourceLabel) parts.push(sourceLabel);
    meta.textContent = parts.join(' • ');

    const description = document.createElement('div');
    description.className = 'job-description';
    description.textContent = job.description || '';

    card.appendChild(header);
    card.appendChild(company);
    card.appendChild(meta);
    card.appendChild(description);

    if (listId === 'cabinet-jobs-list') {
      const actions = document.createElement('div');
      actions.className = 'cabinet-actions';

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn-sm';
      viewBtn.textContent = 'Просмотр';
      viewBtn.addEventListener('click', () => showCabinetJobDetail(job));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-danger btn-sm';
      delBtn.textContent = 'Удалить';
      delBtn.addEventListener('click', async () => {
        if (!confirm('Удалить эту вакансию из личного кабинета?')) return;
        try {
          await deleteMyJob(job.id);
          await refreshSavedJobKeys();
          await loadMyJobs();
        } catch (err) {
          console.error(err);
          alert('Ошибка при удалении вакансии');
        }
      });

      actions.appendChild(viewBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
    }

    listEl.appendChild(card);
  });
}

async function loadMyJobs() {
  if (!currentUser) return;
  try {
    const jobs = await fetchMyJobs();
    renderJobs(jobs, {
      listId: 'cabinet-jobs-list',
      emptyId: 'cabinet-empty',
      countId: null,
      showAdd: false,
      showDelete: false,
    });
  } catch (err) {
    console.error(err);
    alert('Ошибка при загрузке личного кабинета');
  }
}

async function loadJobs(query = '') {
  try {
    if (currentUser) await refreshSavedJobKeys();
    const jobs = await fetchJobs(query);
    renderJobs(jobs);
  } catch (err) {
    console.error(err);
    alert('Ошибка при загрузке вакансий');
  }
}

async function loadRussianJobs(query = '') {
  try {
    if (currentUser) await refreshSavedJobKeys();
    const jobs = await fetchRussianJobs(query);
    renderJobs(jobs);
  } catch (err) {
    console.error(err);
    alert('Ошибка при загрузке российских вакансий');
  }
}

async function createJob(payload) {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Ошибка при создании вакансии');
  }
  return res.json();
}

function showFormMessage(el, text, type) {
  el.textContent = text;
  el.className = `form-message form-message--${type}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await loadJobs();

  document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'cabinet' && !currentUser) {
        showView('auth');
        return;
      }
      showView(btn.dataset.view);
    });
  });

  document.getElementById('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('auth-tab--active'));
      tab.classList.add('auth-tab--active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('login-form').classList.toggle('hidden', !isLogin);
      document.getElementById('register-form').classList.toggle('hidden', isLogin);
    });
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('login-message');
    try {
      await login(
        document.getElementById('login-username').value,
        document.getElementById('login-password').value
      );
      showFormMessage(msgEl, 'Вход выполнен успешно', 'success');
      showView('search');
    } catch (err) {
      showFormMessage(msgEl, err.message, 'error');
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('register-message');
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-password-confirm').value;

    if (password !== confirm) {
      showFormMessage(msgEl, 'Пароли не совпадают', 'error');
      return;
    }

    try {
      await register(
        document.getElementById('register-username').value,
        password
      );
      showFormMessage(msgEl, 'Регистрация успешна', 'success');
      showView('cabinet');
    } catch (err) {
      showFormMessage(msgEl, err.message, 'error');
    }
  });

  document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await loadJobs(document.getElementById('search-input').value);
  });

  document.getElementById('search-russian').addEventListener('click', async () => {
    await loadRussianJobs(document.getElementById('search-input').value);
  });

  document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('create-message');
    try {
      await createJob({
        title: document.getElementById('title').value,
        company: document.getElementById('company').value,
        location: document.getElementById('location').value,
        salary: document.getElementById('salary').value,
        description: document.getElementById('description').value,
      });
      showFormMessage(msgEl, 'Вакансия опубликована', 'success');
      e.target.reset();
      await loadJobs(document.getElementById('search-input').value || '');
    } catch (err) {
      showFormMessage(msgEl, err.message, 'error');
    }
  });

  document.getElementById('cabinet-detail-back').addEventListener('click', () => {
    currentDetailJobId = null;
    showView('cabinet');
  });

  document.getElementById('detail-delete-btn').addEventListener('click', async () => {
    if (!currentDetailJobId || !confirm('Удалить эту вакансию из личного кабинета?')) return;
    try {
      await deleteMyJob(currentDetailJobId);
      await refreshSavedJobKeys();
      currentDetailJobId = null;
      showView('cabinet');
    } catch (err) {
      console.error(err);
      alert('Ошибка при удалении');
    }
  });
});

/* ═══════════════════════════════════════════
   NeuralCraft — Full Platform Logic
   5-tier roles, progress, quiz, prompt, certs
   Server-backed with in-memory cache
   ═══════════════════════════════════════════ */

// ─── Storage Keys (only for client-side data) ──
const KEY_SESSION  = 'nc_session';
const KEY_THEME    = 'nc_theme';
const KEY_REMEMBER = 'nc_remember'; // remember me preference

// Session storage helpers — localStorage (persistent) or sessionStorage (tab only)
function getSessionStore() {
  return localStorage.getItem(KEY_REMEMBER) === 'true' ? localStorage : sessionStorage;
}
function saveSession(user) {
  getSessionStore().setItem(KEY_SESSION, JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem(KEY_SESSION);
  sessionStorage.removeItem(KEY_SESSION);
}
function getSavedSession() {
  return localStorage.getItem(KEY_SESSION) || sessionStorage.getItem(KEY_SESSION);
}

// ─── In-Memory Cache (loaded from server) ──────
const _cache = {
  users: [],
  courses: [],
  progress: {},   // { userId: { lessonId: { viewed, completed, ... } } }
  favorites: {},  // { userId: [...courseIds] }
  glossary: [],
};

// ─── Server API Helper ─────────────────────────
function api(url, options = {}) {
  options.headers = { 'Content-Type': 'application/json', ...options.headers };
  if (options.body && typeof options.body !== 'string') {
    options.body = JSON.stringify(options.body);
  }
  return fetch(url, options).then(r => r.json()).catch(err => {
    console.error('API error:', url, err);
    return null;
  });
}

// ─── Role Hierarchy ────────────────────────────
const ROLES = ['novice', 'lite', 'standard', 'pro', 'admin'];
const ROLE_LABELS = { novice: 'Новичок', lite: 'Лайт', standard: 'Стандарт', pro: 'Про', admin: 'Администратор' };
const ROLE_BADGES = { novice: 'role-novice', lite: 'role-lite', standard: 'role-standard', pro: 'role-pro', admin: 'role-admin' };

function roleLevel(role) { return ROLES.indexOf(role); }
function hasAccess(userRole, requiredRole) {
  return roleLevel(userRole) >= roleLevel(requiredRole);
}

function escHtml(str) {
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

// ─── App State ─────────────────────────────────
let currentUser         = null;
let currentCourseId     = null;
let currentLessonTypeVal = 'text';
let lessonResources     = [];
let currentFilter       = 'all';
let quizQuestions       = [];
let viewingCourseId     = null;
let viewingLessonId     = null;

// ─── Theme ─────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem(KEY_THEME) || 'light';
  setTheme(saved);
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(KEY_THEME, t);
  const darkIcon  = document.querySelector('.theme-icon--dark');
  const lightIcon = document.querySelector('.theme-icon--light');
  if (darkIcon && lightIcon) {
    darkIcon.style.display  = t === 'dark' ? 'block' : 'none';
    lightIcon.style.display = t === 'light' ? 'block' : 'none';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// ─── Utilities ─────────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function showToast(msg, type = 'info') {
  const icons = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function openModal(id) { document.getElementById(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; }

// ─── Storage (In-Memory Cache + Server Sync) ───
function getUsers() { return _cache.users; }
function saveUsers(users) {
  _cache.users = users;
  // Note: individual user operations use specific API endpoints
}
function getCourses() { return _cache.courses; }
function saveCourses(courses) {
  _cache.courses = courses;
  api('/api/courses', { method: 'PUT', body: courses });
}
function saveSingleCourse(course) {
  const idx = _cache.courses.findIndex(c => c.id === course.id);
  if (idx >= 0) _cache.courses[idx] = course;
  else _cache.courses.push(course);
  api('/api/courses/' + course.id, { method: 'PUT', body: course });
}

function getProgress(userId) {
  return _cache.progress[userId] || {};
}
function saveProgress(userId, progress) {
  _cache.progress[userId] = progress;
  api('/api/progress/' + userId, { method: 'PUT', body: progress });
}

// ─── Auth Screen ───────────────────────────────
function switchAuth(mode) {
  document.getElementById('loginForm').style.display    = mode === 'login'    ? 'block' : 'none';
  document.getElementById('registerForm').style.display = mode === 'register' ? 'block' : 'none';
  clearAuthErrors();
}

function clearAuthErrors() {
  const le = document.getElementById('loginError');
  const re = document.getElementById('registerError');
  if (le) le.style.display = 'none';
  if (re) re.style.display = 'none';
}

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) { showAuthError('loginError', 'Заполните все поля'); return; }

  const result = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  if (!result || result.error) {
    showAuthError('loginError', result?.error || 'Ошибка сервера'); return;
  }
  // Load user data from server before starting session
  await loadUserData(result.user.id);
  startSession(result.user);
}

async function handleRegister() {
  const username    = document.getElementById('regUsername').value.trim();
  const displayName = document.getElementById('regDisplayName').value.trim();
  const password    = document.getElementById('regPassword').value;
  const password2   = document.getElementById('regPassword2').value;

  if (!username || !displayName || !password) { showAuthError('registerError', 'Заполните все обязательные поля'); return; }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { showAuthError('registerError', 'Имя пользователя: 3-20 символов, только a-z, 0-9, _'); return; }
  if (password.length < 6) { showAuthError('registerError', 'Пароль минимум 6 символов'); return; }
  if (password !== password2) { showAuthError('registerError', 'Пароли не совпадают'); return; }

  const result = await api('/api/auth/register', { method: 'POST', body: { username, displayName, password } });
  if (!result || result.error) {
    showAuthError('registerError', result?.error || 'Ошибка сервера'); return;
  }

  showToast(`Аккаунт создан! Ваш тариф: ${ROLE_LABELS[result.user.role]}`, 'success');
  await loadUserData(result.user.id);
  startSession(result.user);
}

function startSession(user) {
  currentUser = { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  // Save remember-me preference
  const rememberEl = document.getElementById('rememberMe');
  if (rememberEl) {
    localStorage.setItem(KEY_REMEMBER, rememberEl.checked ? 'true' : 'false');
  }
  saveSession(currentUser);

  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  applySidebarUser();
  applyRoleUI();
  addDemoDataIfEmpty();
  renderDashboard();
  showView('dashboard');
}

// Load user-specific data from server
async function loadUserData(userId) {
  const [users, courses, progress, favorites, glossary, achievementsDef, earnedAch, promptsDb, tariffs] = await Promise.all([
    api('/api/users'),
    api('/api/courses'),
    api('/api/progress/' + userId),
    api('/api/favorites/' + userId),
    api('/api/glossary'),
    api('/api/kv/achievements_def'),
    api('/api/kv/achievements_' + userId),
    api('/api/kv/prompts_db'),
    api('/api/kv/tariffs'),
  ]);
  _cache.users = users || [];
  _cache.courses = courses || [];
  _cache.progress[userId] = progress || {};
  _cache.favorites[userId] = favorites || [];
  _cache.glossary = glossary || [];
  if (achievementsDef && Array.isArray(achievementsDef) && achievementsDef.length > 0) {
    _cache._achievementsDef = achievementsDef;
  }
  if (!_cache._earnedAchievements) _cache._earnedAchievements = {};
  _cache._earnedAchievements[userId] = earnedAch || {};
  if (promptsDb && Array.isArray(promptsDb)) _cache._promptsDb = promptsDb;
  if (tariffs && Array.isArray(tariffs) && tariffs.length > 0) _cache._tariffs = tariffs;
}

function handleLogout() {
  currentUser = null;
  clearSession();
  // Clear cache
  _cache.users = []; _cache.courses = []; _cache.progress = {}; _cache.favorites = {}; _cache.glossary = [];
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  clearAuthErrors();
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

function applySidebarUser() {
  if (!currentUser) return;
  const initials = (currentUser.displayName || currentUser.username).slice(0, 2).toUpperCase();
  document.getElementById('sidebarAvatar').textContent  = initials;
  document.getElementById('sidebarUsername').textContent = currentUser.displayName || currentUser.username;
  document.getElementById('sidebarRole').textContent    = ROLE_LABELS[currentUser.role] || currentUser.role;

  // Click on sidebar footer to open profile
  document.querySelector('.sidebar-footer').onclick = (e) => {
    if (e.target.closest('.logout-btn')) return;
    openProfileModal();
  };
  document.querySelector('.sidebar-footer').style.cursor = 'pointer';
}

function applyRoleUI() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? (el.classList.contains('sidebar-data-btns') || el.classList.contains('sidebar-data-btn') ? 'flex' : '') : 'none';
  });
}

// ─── Navigation ────────────────────────────────
function showView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.add('active');
  const navEl = document.getElementById(`nav-${viewName}`);
  if (navEl) navEl.classList.add('active');

  const labels = { dashboard: 'Дашборд', courses: 'Курсы', favorites: 'Избранное', progress: 'Мой прогресс', achievements: 'Достижения', 'achievements-admin': 'Управление достижениями', glossary: 'Глоссарий', 'prompts-db': 'База промптов', tariffs: 'Тарифы', users: 'Пользователи', 'course-editor': 'Редактор курса', lesson: 'Урок' };
  document.getElementById('breadcrumb').textContent = labels[viewName] || '';

  // Access control for glossary (requires Lite+)
  if (viewName === 'glossary' && currentUser) {
    const isNovice = currentUser.role === 'novice';
    const isAdmin = currentUser.role === 'admin';
    document.getElementById('glossaryGate').style.display = (isNovice && !isAdmin) ? 'block' : 'none';
    document.getElementById('glossaryContent').style.display = (isNovice && !isAdmin) ? 'none' : 'block';
  }

  // Access control for prompts-db (requires Standard+)
  if (viewName === 'prompts-db' && currentUser) {
    const ROLES_ORDER = ['novice', 'lite', 'standard', 'pro', 'admin'];
    const userIdx = ROLES_ORDER.indexOf(currentUser.role);
    const needIdx = ROLES_ORDER.indexOf('standard');
    const hasAccess = userIdx >= needIdx;
    document.getElementById('promptsDbGate').style.display = hasAccess ? 'none' : 'block';
    document.getElementById('promptsDbContent').style.display = hasAccess ? 'block' : 'none';
  }

  if (viewName === 'dashboard')          renderDashboard();
  if (viewName === 'courses')            renderCourses();
  if (viewName === 'favorites')          renderFavorites();
  if (viewName === 'progress')           renderProgress();
  if (viewName === 'achievements')       renderAchievements();
  if (viewName === 'achievements-admin') renderAchievementsAdmin();
  if (viewName === 'glossary')           renderGlossary();
  if (viewName === 'prompts-db')         renderPromptsDb();
  if (viewName === 'tariffs')            renderTariffs();
  if (viewName === 'users')              renderUsers();

  // Close mobile sidebar
  closeSidebar();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active', sidebar.classList.contains('open'));
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

// ─── Dashboard ─────────────────────────────────
function renderDashboard() {
  const courses = getCourses();
  const isAdmin = currentUser && currentUser.role === 'admin';
  const userRole = currentUser ? currentUser.role : 'novice';
  const progress = currentUser ? getProgress(currentUser.id) : {};

  const publishedCourses = courses.filter(c => c.status === 'published');
  const accessibleCourses = isAdmin ? publishedCourses : publishedCourses.filter(c => hasAccess(userRole, c.accessLevel || 'novice'));

  const totalLessons = accessibleCourses.reduce((s, c) => s + (c.lessons || []).filter(l => l.status === 'published').length, 0);
  const completedCourses = accessibleCourses.filter(c => isCourseCompleted(c, progress)).length;
  const totalMin = accessibleCourses.reduce((s, c) => s + (c.lessons || []).reduce((ls, l) => ls + (parseInt(l.duration) || 0), 0), 0);
  const users = getUsers();

  document.getElementById('stat-courses').textContent   = accessibleCourses.length;
  document.getElementById('stat-lessons').textContent   = totalLessons;
  document.getElementById('stat-completed').textContent = completedCourses;
  document.getElementById('stat-hours').textContent     = Math.round(totalMin / 60) || 0;
  document.getElementById('stat-users').textContent     = users.length;

  if (currentUser) {
    document.getElementById('dashWelcome').textContent = `Привет, ${currentUser.displayName || currentUser.username}! 👋`;
  }

  const grid = document.getElementById('dashboard-courses-grid');
  const visibleCourses = isAdmin ? courses : publishedCourses;
  if (visibleCourses.length === 0) {
    grid.innerHTML = '';
    const empty = document.getElementById('dashboard-empty');
    if (empty) { grid.appendChild(empty); empty.style.display = 'flex'; }
    return;
  }

  const recent = [...visibleCourses].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  grid.innerHTML = recent.map(c => buildCourseCard(c, progress)).join('');

  // ── Activity Chart (lessons per day, last 7 days) ──
  renderActivityChart(progress);
  renderFactOfDay();
}

// ── AI Fact of the Day ──
const AI_FACTS = [
  { emoji: '🧠', text: 'Нейросеть GPT-4 обучена на текстах общим объёмом более 13 триллионов токенов — это примерно 10 миллионов книг.' },
  { emoji: '🎨', text: 'Первую картину, созданную ИИ, продали на аукционе Christie\'s за $432,500 в 2018 году.' },
  { emoji: '🤖', text: 'Термин «искусственный интеллект» придумал Джон Маккарти в 1956 году на Дартмутской конференции.' },
  { emoji: '🎵', text: 'ИИ может сочинять музыку в стиле Баха так убедительно, что профессионалы не отличают её от оригинала.' },
  { emoji: '🧬', text: 'AlphaFold от DeepMind предсказал структуру более 200 миллионов белков — задача, над которой учёные бились 50 лет.' },
  { emoji: '♟️', text: 'AlphaZero научился играть в шахматы лучше всех людей за 4 часа, начав с нуля, без знания дебютов.' },
  { emoji: '🌐', text: 'GPT-3 может программировать на 12+ языках, писать стихи и даже юридические документы.' },
  { emoji: '🚗', text: 'Автопилот Tesla обрабатывает 2300 кадров в секунду с 8 камер одновременно с помощью нейросетей.' },
  { emoji: '🔬', text: 'ИИ помог открыть новый антибиотик — галлицин — впервые за 60 лет, проанализировав 100 млн молекул.' },
  { emoji: '📱', text: 'Siri от Apple ежедневно обрабатывает более 25 миллиардов запросов с помощью нейросетей.' },
  { emoji: '🎬', text: 'Deepfake-технология может создать реалистичное видео человека всего по одной фотографии.' },
  { emoji: '🧮', text: 'Первый нейрон (перцептрон) был создан в 1957 году — он мог только отличать фигуры слева от справа.' },
  { emoji: '🌍', text: 'Google Translate переводит 100 миллиардов слов в день на 133 языка с помощью нейронных сетей.' },
  { emoji: '💡', text: 'Обучение большой языковой модели потребляет столько энергии, сколько 5 автомобилей за всю жизнь.' },
  { emoji: '🎮', text: 'ИИ OpenAI Five победил чемпионов мира по Dota 2, обучившись на 10,000 лет игрового опыта за несколько дней.' },
  { emoji: '📷', text: 'Нейросети распознают лица точнее людей — с точностью 99.97% при хорошем освещении.' },
  { emoji: '🦠', text: 'Во время пандемии COVID-19 ИИ помог создать вакцину Moderna менее чем за 2 дня после секвенирования вируса.' },
  { emoji: '🎭', text: 'DALL-E 3 генерирует изображения, понимая абстрактные концепции вроде «грусть в стиле кубизма».' },
  { emoji: '📊', text: 'Netflix экономит $1 миллиард в год благодаря ИИ-рекомендациям, которые удерживают зрителей.' },
  { emoji: '🧪', text: 'ИИ предсказывает землетрясения с точностью 70%, анализируя сейсмические данные в реальном времени.' },
  { emoji: '✍️', text: 'GPT-4 сдал юридический экзамен (BAR) на уровне топ-10% студентов юридических школ.' },
  { emoji: '🏥', text: 'ИИ диагностирует рак кожи точнее дерматологов — с точностью 95% по фотографии.' },
  { emoji: '🎤', text: 'Технология клонирования голоса может воспроизвести ваш голос по образцу всего в 3 секунды.' },
  { emoji: '🌊', text: 'ИИ помогает предсказывать цунами за 10 минут до удара, спасая тысячи жизней.' },
  { emoji: '🐋', text: 'Нейросети расшифровывают язык дельфинов и китов, обнаружив более 800 уникальных «слов».' },
  { emoji: '⚡', text: 'Один запрос к ChatGPT потребляет в 10 раз больше энергии, чем обычный поиск в Google.' },
  { emoji: '🏗️', text: 'Midjourney был создан командой из всего 11 человек, но генерирует миллионы изображений в день.' },
  { emoji: '🧩', text: 'Нейросети работают по принципу мозга: 86 миллиардов нейронов у человека vs миллиарды параметров у GPT.' },
  { emoji: '🌙', text: 'ИИ помог обнаружить 301 новую экзопланету, анализируя данные телескопа Kepler.' },
  { emoji: '📝', text: 'Stable Diffusion — одна из первых мощных генеративных моделей с открытым исходным кодом, доступная каждому.' }
];

function renderFactOfDay() {
  const el = document.getElementById('fact-of-day');
  if (!el) return;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const fact = AI_FACTS[dayOfYear % AI_FACTS.length];
  el.innerHTML = `
    <div class="fact-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
      Факт дня об ИИ
    </div>
    <div class="fact-emoji">${fact.emoji}</div>
    <div class="fact-text">${fact.text}</div>
  `;
}

function renderActivityChart(progress) {
  const container = document.getElementById('activity-chart');
  if (!container) return;

  const now = new Date();
  const days = [];
  const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 86400000;

    let count = 0;
    Object.values(progress).forEach(p => {
      if (p && p.viewedAt && p.viewedAt >= dayStart && p.viewedAt < dayEnd) count++;
    });

    days.push({
      label: DAY_NAMES[d.getDay()],
      date: d.getDate(),
      count,
      isToday: i === 0
    });
  }

  const maxCount = Math.max(...days.map(d => d.count), 1);
  const totalWeek = days.reduce((s, d) => s + d.count, 0);

  // SVG dimensions
  const W = 500, H = 140;
  const padL = 30, padR = 15, padT = 15, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Y-axis ticks (nice round numbers)
  const yTicks = [];
  const yStep = maxCount <= 3 ? 1 : maxCount <= 8 ? 2 : Math.ceil(maxCount / 4);
  for (let v = 0; v <= maxCount; v += yStep) yTicks.push(v);
  if (yTicks[yTicks.length - 1] < maxCount) yTicks.push(maxCount);
  const yMax = yTicks[yTicks.length - 1] || 1;

  // Calculate points
  const points = days.map((d, i) => ({
    x: padL + (i / 6) * chartW,
    y: padT + chartH - (d.count / yMax) * chartH,
    count: d.count,
    label: d.label,
    date: d.date,
    isToday: d.isToday
  }));

  // Line path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  // Area fill path
  const areaPath = linePath + ` L${points[6].x.toFixed(1)},${padT + chartH} L${points[0].x.toFixed(1)},${padT + chartH} Z`;

  // Y-axis grid lines + labels
  const yLines = yTicks.map(v => {
    const y = padT + chartH - (v / yMax) * chartH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="chart-grid-line"/>
            <text x="${padL - 6}" y="${y + 3.5}" class="chart-y-label">${v}</text>`;
  }).join('');

  // X-axis labels
  const xLabels = points.map(p =>
    `<text x="${p.x}" y="${H - 5}" class="chart-x-label${p.isToday ? ' today' : ''}">${p.label} ${p.date}</text>`
  ).join('');

  // Dots
  const dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="${p.isToday ? 5 : 3.5}" class="chart-dot${p.isToday ? ' today' : ''}"/>
     ${p.count > 0 ? `<text x="${p.x}" y="${p.y - 10}" class="chart-dot-label">${p.count}</text>` : ''}`
  ).join('');

  container.innerHTML = `
    <div class="activity-chart-header">
      <div class="activity-chart-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Активность за неделю
      </div>
      <div class="activity-chart-total">${totalWeek} <span>уроков</span></div>
    </div>
    <svg class="activity-line-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(201,168,76,0.25)"/>
          <stop offset="100%" stop-color="rgba(201,168,76,0)"/>
        </linearGradient>
      </defs>
      ${yLines}
      <polygon points="${areaPath.replace(/[MLZ]/g, ' ')}" fill="url(#areaGrad)"/>
      <polyline points="${points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" class="chart-line"/>
      ${dots}
      ${xLabels}
    </svg>
  `;
}

// ─── Course Completion Logic ───────────────────
function isCourseCompleted(course, progress) {
  const lessons = (course.lessons || []).filter(l => l.status === 'published');
  if (lessons.length === 0) return false;
  const practiceLesson = lessons.find(l => l.type === 'quiz' || l.type === 'prompt');
  if (practiceLesson) {
    return progress[practiceLesson.id] && progress[practiceLesson.id].completed;
  }
  // If no practice lesson, course is completed when all lessons are viewed
  return lessons.every(l => progress[l.id] && progress[l.id].viewed);
}

function getCourseProgress(course, progress) {
  const lessons = (course.lessons || []).filter(l => l.status === 'published');
  if (lessons.length === 0) return 0;
  const done = lessons.filter(l => progress[l.id] && (progress[l.id].completed || progress[l.id].viewed)).length;
  return Math.round((done / lessons.length) * 100);
}

function getCourseStatus(course, progress) {
  if (isCourseCompleted(course, progress)) return 'completed';
  const lessons = (course.lessons || []).filter(l => l.status === 'published');
  const started = lessons.some(l => progress[l.id]);
  return started ? 'in-progress' : 'not-started';
}

// ─── Courses ───────────────────────────────────
function renderCourses(filter) {
  if (filter !== undefined) currentFilter = filter;
  const isAdmin = currentUser && currentUser.role === 'admin';
  const userRole = currentUser ? currentUser.role : 'novice';
  const progress = currentUser ? getProgress(currentUser.id) : {};
  let courses = getCourses();

  // Non-admin: show published courses (all of them, locked ones too)
  if (!isAdmin) {
    courses = courses.filter(c => c.status === 'published');
  }

  if (currentFilter === 'available') {
    courses = courses.filter(c => hasAccess(userRole, c.accessLevel || 'novice') || isAdmin);
  }
  if (currentFilter === 'completed') {
    courses = courses.filter(c => isCourseCompleted(c, progress));
  }
  if (currentFilter === 'draft') {
    courses = getCourses().filter(c => c.status !== 'published');
  }

  const grid = document.getElementById('courses-grid');
  if (courses.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
      <h3>Нет курсов</h3><p>${currentFilter !== 'all' ? 'Нет курсов с таким фильтром' : 'Курсы ещё не созданы'}</p>
    </div>`;
    return;
  }
  grid.innerHTML = courses.map(c => buildCourseCard(c, progress)).join('');
}

function filterCourses(type, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCourses(type);
}

function buildCourseCard(course, progress) {
  const isAdmin = currentUser && currentUser.role === 'admin';
  const userRole = currentUser ? currentUser.role : 'novice';
  const accessLevel = course.accessLevel || 'novice';
  const canAccess = isAdmin || hasAccess(userRole, accessLevel);
  const locked = !canAccess;

  const lessons = course.lessons || [];
  const publishedLessons = lessons.filter(l => l.status === 'published');
  const totalMin = publishedLessons.reduce((s, l) => s + (parseInt(l.duration) || 0), 0);

  const status = canAccess ? getCourseStatus(course, progress || {}) : 'not-started';
  const pct = canAccess ? getCourseProgress(course, progress || {}) : 0;

  const statusLabels = { completed: '✅ Пройден', 'in-progress': '🔵 В процессе', 'not-started': '⬜ Не начат' };
  const statusClasses = { completed: 'completed', 'in-progress': 'in-progress', 'not-started': 'not-started' };

  const thumb = course.preview
    ? `<img class="course-card-thumb" src="${course.preview}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="course-card-thumb-placeholder" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`
    : `<div class="course-card-thumb-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;

  const lockOverlay = locked ? `<div class="course-card-lock">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <span>Повысьте подписку</span>
    <div class="lock-level">от ${ROLE_LABELS[accessLevel]}</div>
  </div>` : '';

  const adminActions = isAdmin ? `
    <div class="course-card-actions" onclick="event.stopPropagation()">
      <button class="card-action-btn" onclick="openCourseEditor('${course.id}')" title="Редактировать">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="card-action-btn danger" onclick="confirmDeleteCourse('${course.id}')" title="Удалить">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>` : '';

  const clickFn = isAdmin ? `openCourseEditor('${course.id}')` : (locked ? '' : `openCourseView('${course.id}')`);

  const accessBadge = `<span class="badge ${ROLE_BADGES[accessLevel]}">${ROLE_LABELS[accessLevel]}</span>`;
  const draftBadge = course.status !== 'published' ? `<span class="badge badge-gray">Черновик</span>` : '';

  return `<div class="course-card ${locked ? 'locked' : ''}" onclick="${clickFn}">
    ${thumb}
    <button class="fav-btn ${isFavorite(course.id) ? 'active' : ''}" onclick="event.stopPropagation();toggleFavorite('${course.id}')" title="Избранное">
      <svg viewBox="0 0 24 24" fill="${isFavorite(course.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    </button>
    ${lockOverlay}
    ${adminActions}
    <div class="course-card-body">
      <div class="course-card-title">${course.title}</div>
      <div class="course-card-desc">${course.description || 'Без описания'}</div>
      <div class="course-card-meta">
        <div class="course-card-badges">${accessBadge}${draftBadge}</div>
        <span class="lesson-meta-small">${publishedLessons.length} ур.</span>
      </div>
    </div>
    ${canAccess && course.status === 'published' ? `<div class="course-card-progress"><div class="course-card-progress-fill" style="width:${pct}%"></div></div>` : ''}
    <div class="course-card-footer">
      <div class="course-card-time">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${totalMin} мин
      </div>
      ${canAccess && course.status === 'published' ? `<div class="course-card-status ${statusClasses[status]}">${statusLabels[status]}</div>` : ''}
    </div>
  </div>`;
}

// ─── Course View (Student) ─────────────────────
function openCourseView(courseId) {
  const courses = getCourses();
  const course = courses.find(c => c.id === courseId);
  if (!course) return;

  viewingCourseId = courseId;
  const lessons = (course.lessons || []).filter(l => l.status === 'published').sort((a, b) => (a.order || 0) - (b.order || 0));

  if (lessons.length === 0) {
    showToast('В этом курсе пока нет уроков', 'info');
    return;
  }

  openLessonViewer(courseId, lessons[0].id);
}

// ─── Lesson Viewer ─────────────────────────────
function openLessonViewer(courseId, lessonId) {
  const courses = getCourses();
  const course = courses.find(c => c.id === courseId);
  if (!course) return;

  const lessons = (course.lessons || []).filter(l => l.status === 'published').sort((a, b) => (a.order || 0) - (b.order || 0));
  const lesson = lessons.find(l => l.id === lessonId);
  if (!lesson) return;

  viewingCourseId = courseId;
  viewingLessonId = lessonId;

  // Mark as viewed
  if (currentUser) {
    const progress = getProgress(currentUser.id);
    if (!progress[lessonId]) progress[lessonId] = {};
    progress[lessonId].viewed = true;
    if (!progress[lessonId].viewedAt) progress[lessonId].viewedAt = Date.now();
    saveProgress(currentUser.id, progress);
  }

  const TYPE_LABEL = { video: 'Видео', text: 'Текст', quiz: 'Тест', prompt: 'Промпт' };
  const TYPE_BADGE = { video: 'badge-brown', text: 'badge-gold', quiz: 'badge-orange', prompt: 'badge-green' };

  document.getElementById('lessonViewTitle').textContent = lesson.title || 'Урок';
  document.getElementById('lessonViewType').textContent = TYPE_LABEL[lesson.type] || lesson.type;
  document.getElementById('lessonViewType').className = `badge ${TYPE_BADGE[lesson.type] || 'badge-gray'}`;
  document.getElementById('lessonViewDuration').querySelector('span').textContent = `${lesson.duration || '—'} мин`;

  // Check if completed
  const progress = currentUser ? getProgress(currentUser.id) : {};
  const isCompleted = progress[lessonId] && progress[lessonId].completed;
  const statusEl = document.getElementById('lessonViewStatus');
  if (isCompleted) {
    statusEl.textContent = '✅ Пройден';
    statusEl.className = 'badge badge-green';
  } else {
    statusEl.textContent = 'В процессе';
    statusEl.className = 'badge badge-gray';
  }

  // Render content
  const contentHtml = renderMarkdown(lesson.content || '');
  document.getElementById('lessonViewContent').innerHTML = contentHtml;

  // Video embed
  if (lesson.type === 'video' && lesson.videoUrl) {
    const videoEmbed = buildVideoEmbed(lesson.videoUrl);
    if (videoEmbed) {
      document.getElementById('lessonViewContent').innerHTML = videoEmbed + contentHtml;
    }
  }

  // Practice block
  const practiceBlock = document.getElementById('practiceBlock');
  const practiceContent = document.getElementById('practiceContent');
  const practiceResult = document.getElementById('practiceResult');
  practiceResult.innerHTML = '';

  if (lesson.type === 'quiz' && lesson.quizData && lesson.quizData.length > 0) {
    practiceBlock.style.display = 'block';
    document.getElementById('practiceTitle').textContent = 'Тест';
    document.getElementById('practiceSubtitle').textContent = `${lesson.quizData.length} вопрос(ов) — выберите правильные ответы`;
    practiceContent.innerHTML = renderQuiz(lesson.quizData);
    document.getElementById('practiceSubmitBtn').textContent = 'Проверить ответы';
    document.getElementById('practiceSubmitBtn').style.display = isCompleted ? 'none' : '';
  } else if (lesson.type === 'prompt' && lesson.promptData) {
    practiceBlock.style.display = 'block';
    document.getElementById('practiceTitle').textContent = 'Практика: Промпт';
    document.getElementById('practiceSubtitle').textContent = 'Напишите промпт по заданию';
    practiceContent.innerHTML = renderPromptPractice(lesson.promptData);
    document.getElementById('practiceSubmitBtn').textContent = 'Проверить промпт';
    document.getElementById('practiceSubmitBtn').style.display = isCompleted ? 'none' : '';
  } else {
    practiceBlock.style.display = 'none';
  }

  if (isCompleted && (lesson.type === 'quiz' || lesson.type === 'prompt')) {
    practiceResult.innerHTML = `<div class="prompt-result success">✅ Вы уже выполнили это задание!</div>`;
  }

  // Navigation buttons
  const idx = lessons.findIndex(l => l.id === lessonId);
  document.getElementById('prevLessonBtn').style.display = idx > 0 ? '' : 'none';
  document.getElementById('nextLessonBtn').style.display = idx < lessons.length - 1 ? '' : 'none';

  // Back button
  document.getElementById('lessonBackBtn').onclick = () => {
    if (currentUser && currentUser.role === 'admin') {
      openCourseEditor(courseId);
    } else {
      showView('courses');
    }
  };

  showView('lesson');
}

function goToPrevLesson() {
  const course = getCourses().find(c => c.id === viewingCourseId);
  if (!course) return;
  const lessons = (course.lessons || []).filter(l => l.status === 'published').sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = lessons.findIndex(l => l.id === viewingLessonId);
  if (idx > 0) openLessonViewer(viewingCourseId, lessons[idx - 1].id);
}

function goToNextLesson() {
  const course = getCourses().find(c => c.id === viewingCourseId);
  if (!course) return;
  const lessons = (course.lessons || []).filter(l => l.status === 'published').sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = lessons.findIndex(l => l.id === viewingLessonId);
  if (idx < lessons.length - 1) openLessonViewer(viewingCourseId, lessons[idx + 1].id);
}

function goBackFromLesson() {
  if (currentUser && currentUser.role === 'admin') {
    if (viewingCourseId) openCourseEditor(viewingCourseId);
    else showView('courses');
  } else {
    showView('courses');
  }
}

// ─── Markdown Renderer (simple) ────────────────
function renderMarkdown(md) {
  if (!md) return '<p style="color:var(--text-muted)">Контент урока пуст</p>';
  let html = md;
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang}">${escHtml(code.trim())}</code></pre>`
  );
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--accent-gold)">$1</a>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold/Italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br/>');
  if (!html.startsWith('<')) html = '<p>' + html + '</p>';
  return html;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildVideoEmbed(url) {
  let videoId = null;
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) videoId = ytMatch[1];
  if (videoId) {
    return `<div style="position:relative;padding-bottom:56.25%;height:0;margin-bottom:20px;border-radius:var(--radius-lg);overflow:hidden">
      <iframe src="https://www.youtube.com/embed/${videoId}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen></iframe>
    </div>`;
  }
  return '';
}

// ─── Quiz Rendering & Checking ─────────────────
function renderQuiz(quizData) {
  return quizData.map((q, qi) => {
    const optionsHtml = q.options.map((opt, oi) =>
      `<div class="quiz-option" data-qi="${qi}" data-oi="${oi}" onclick="selectQuizOption(this, ${qi})">
        <div class="quiz-radio"></div>
        <span>${escHtml(opt)}</span>
      </div>`
    ).join('');
    return `<div class="quiz-question" data-qi="${qi}">
      <div class="quiz-question-text">${qi + 1}. ${escHtml(q.question)}</div>
      <div class="quiz-options">${optionsHtml}</div>
    </div>`;
  }).join('');
}

function selectQuizOption(el, qi) {
  const parent = el.closest('.quiz-question');
  parent.querySelectorAll('.quiz-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

function renderPromptPractice(promptData) {
  return `<div class="prompt-practice">
    <div class="prompt-task-text">${escHtml(promptData.task || '')}</div>
    <div class="prompt-input-area">
      <textarea class="prompt-textarea" id="promptUserInput" placeholder="Введите ваш промпт здесь..."></textarea>
      <div class="prompt-actions">
        <span class="prompt-hint">Минимум ${promptData.minMatch || 3} ключевых совпадений</span>
      </div>
    </div>
  </div>`;
}

function submitPractice() {
  const course = getCourses().find(c => c.id === viewingCourseId);
  if (!course) return;
  const lesson = course.lessons.find(l => l.id === viewingLessonId);
  if (!lesson) return;

  if (lesson.type === 'quiz') {
    submitQuiz(lesson);
  } else if (lesson.type === 'prompt') {
    submitPrompt(lesson);
  }
}

function submitQuiz(lesson) {
  const quizData = lesson.quizData;
  let correct = 0;
  const total = quizData.length;

  quizData.forEach((q, qi) => {
    const questionEl = document.querySelector(`.quiz-question[data-qi="${qi}"]`);
    const selected = questionEl.querySelector('.quiz-option.selected');
    const correctIdx = q.correctIndex;

    questionEl.querySelectorAll('.quiz-option').forEach((opt, oi) => {
      opt.style.pointerEvents = 'none';
      if (oi === correctIdx) opt.classList.add('correct');
      if (opt.classList.contains('selected') && oi !== correctIdx) opt.classList.add('incorrect');
    });

    if (selected) {
      const selIdx = parseInt(selected.dataset.oi);
      if (selIdx === correctIdx) correct++;
    }
  });

  const passed = correct >= Math.ceil(total * 0.7);
  const resultEl = document.getElementById('practiceResult');
  resultEl.innerHTML = `<div class="quiz-results">
    <div class="quiz-score">${correct}/${total}</div>
    <div class="quiz-score-label">${passed ? '🎉 Отлично! Тест пройден!' : '❌ Попробуйте ещё раз (нужно 70%)'}</div>
    ${!passed ? '<button class="btn-primary" style="margin-top:16px" onclick="retryQuiz()">🔄 Начать тест заново</button>' : ''}
  </div>`;

  if (passed && currentUser) {
    markLessonCompleted(viewingLessonId);
    document.getElementById('practiceSubmitBtn').style.display = 'none';
  }
}

function retryQuiz() {
  // Re-render the current lesson to reset quiz state
  if (viewingLessonId) {
    const courses = getCourses();
    for (const c of courses) {
      const lesson = (c.lessons || []).find(l => l.id === viewingLessonId);
      if (lesson) { openLesson(c.id, lesson.id); return; }
    }
  }
}

function submitPrompt(lesson) {
  const promptData = lesson.promptData;
  const userInput = document.getElementById('promptUserInput').value.trim().toLowerCase();

  if (!userInput) {
    showToast('Введите промпт', 'error');
    return;
  }

  const keywords = (promptData.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(k => k);
  const minMatch = parseInt(promptData.minMatch) || 3;

  let matches = 0;
  const matchedWords = [];
  const missedWords = [];

  keywords.forEach(kw => {
    if (userInput.includes(kw)) {
      matches++;
      matchedWords.push(kw);
    } else {
      missedWords.push(kw);
    }
  });

  const passed = matches >= minMatch;
  const resultEl = document.getElementById('practiceResult');
  resultEl.innerHTML = `<div class="prompt-result ${passed ? 'success' : 'fail'}">
    ${passed ? '✅' : '❌'} <strong>${passed ? 'Промпт принят!' : 'Промпт не прошёл проверку'}</strong><br>
    Совпадений: ${matches}/${keywords.length} (минимум ${minMatch})<br>
    ${matchedWords.length > 0 ? `✓ Найдено: ${matchedWords.join(', ')}<br>` : ''}
    ${!passed && missedWords.length > 0 ? `✗ Не найдено: ${missedWords.join(', ')}` : ''}
  </div>`;

  if (passed && currentUser) {
    markLessonCompleted(viewingLessonId);
    document.getElementById('practiceSubmitBtn').style.display = 'none';
    checkCourseCertificate();
  }
}

function markLessonCompleted(lessonId) {
  if (!currentUser) return;
  const progress = getProgress(currentUser.id);
  if (!progress[lessonId]) progress[lessonId] = {};
  progress[lessonId].completed = true;
  progress[lessonId].completedAt = Date.now();
  saveProgress(currentUser.id, progress);
  showToast('Урок пройден! 🎉', 'success');

  // Update status badge
  const statusEl = document.getElementById('lessonViewStatus');
  statusEl.textContent = '✅ Пройден';
  statusEl.className = 'badge badge-green';
}

function checkCourseCertificate() {
  if (!currentUser) return;
  const courses = getCourses().filter(c => c.status === 'published');
  const userRole = currentUser.role;
  const isAdmin = userRole === 'admin';
  const accessibleCourses = isAdmin ? courses : courses.filter(c => hasAccess(userRole, c.accessLevel || 'novice'));
  if (accessibleCourses.length === 0) return;

  const progress = getProgress(currentUser.id);
  const allCompleted = accessibleCourses.every(c => isCourseCompleted(c, progress));
  if (allCompleted) {
    setTimeout(() => showGlobalCertificate(), 500);
  }
}

// ─── Progress View ─────────────────────────────
function renderProgress() {
  if (!currentUser) return;
  const progress = getProgress(currentUser.id);
  const courses = getCourses().filter(c => c.status === 'published');
  const userRole = currentUser.role;
  const isAdmin = userRole === 'admin';

  const accessibleCourses = isAdmin ? courses : courses.filter(c => hasAccess(userRole, c.accessLevel || 'novice'));

  const completedCount = accessibleCourses.filter(c => isCourseCompleted(c, progress)).length;
  const allLessons = [];
  accessibleCourses.forEach(c => (c.lessons || []).filter(l => l.status === 'published').forEach(l => allLessons.push(l)));
  const completedLessons = allLessons.filter(l => progress[l.id] && (progress[l.id].completed || progress[l.id].viewed)).length;
  const totalHours = allLessons.filter(l => progress[l.id] && progress[l.id].viewed).reduce((s, l) => s + (parseInt(l.duration) || 0), 0);

  document.getElementById('progress-completed').textContent = completedCount;
  document.getElementById('progress-hours').textContent = Math.round(totalHours / 60) || 0;
  document.getElementById('progress-lessons').textContent = completedLessons;
  document.getElementById('progress-certs').textContent = completedCount; // same as completed courses

  const inProgressCourses = accessibleCourses.filter(c => {
    const st = getCourseStatus(c, progress);
    return st === 'in-progress' || st === 'completed';
  });

  const grid = document.getElementById('progress-courses-grid');
  if (inProgressCourses.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <h3>Пока нет прогресса</h3><p>Начните изучать курсы чтобы видеть прогресс</p>
    </div>`;
    return;
  }
  grid.innerHTML = inProgressCourses.map(c => buildCourseCard(c, progress)).join('');
}

// ─── Certificate ───────────────────────────────
function showGlobalCertificate() {
  if (!currentUser) return;
  // Check if already shown this session
  if (window._certShown) return;
  window._certShown = true;

  const courses = getCourses().filter(c => c.status === 'published');
  const userRole = currentUser.role;
  const isAdmin = userRole === 'admin';
  const accessibleCourses = isAdmin ? courses : courses.filter(c => hasAccess(userRole, c.accessLevel || 'novice'));

  document.getElementById('certStudentName').textContent = currentUser.displayName || currentUser.username;
  document.getElementById('certCourseName').textContent = `все ${accessibleCourses.length} доступных курсов`;
  document.getElementById('certDate').textContent = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  openModal('modalCertificate');
}

function downloadCertificatePDF() {
  const card = document.getElementById('certificateCard');
  const studentName = document.getElementById('certStudentName').textContent;
  const courseName = document.getElementById('certCourseName').textContent;
  const date = document.getElementById('certDate').textContent;

  // Generate PDF using Canvas
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');

  // Background
  const grad = ctx.createLinearGradient(0, 0, 800, 600);
  grad.addColorStop(0, '#FFFEF9');
  grad.addColorStop(1, '#F8F2E4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 600);

  // Gold border
  ctx.strokeStyle = '#C9A84C';
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 760, 560);
  ctx.strokeStyle = '#D4B85C';
  ctx.lineWidth = 1;
  ctx.strokeRect(30, 30, 740, 540);

  // Logo placeholder
  ctx.fillStyle = '#C9A84C';
  ctx.font = 'bold 14px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('◆', 400, 80);

  // Certificate label
  ctx.font = '600 12px "Inter", sans-serif';
  ctx.fillStyle = '#C9A84C';
  ctx.letterSpacing = '3px';
  ctx.fillText('СЕРТИФИКАТ', 400, 110);

  // Title
  ctx.font = 'bold 32px "Inter", sans-serif';
  ctx.fillStyle = '#2D2319';
  ctx.fillText('NeuralCraft', 400, 160);

  // Ornament
  ctx.fillStyle = '#C9A84C';
  ctx.fillRect(350, 180, 100, 2);

  // Subtitle
  ctx.font = '400 14px "Inter", sans-serif';
  ctx.fillStyle = '#8C7B6B';
  ctx.fillText('Настоящим подтверждается, что', 400, 220);

  // Student name
  ctx.font = 'bold 26px "Inter", sans-serif';
  ctx.fillStyle = '#C9A84C';
  ctx.fillText(studentName, 400, 270);

  // Course label
  ctx.font = '400 14px "Inter", sans-serif';
  ctx.fillStyle = '#8C7B6B';
  ctx.fillText('успешно завершил(а)', 400, 310);

  // Course name
  ctx.font = '600 18px "Inter", sans-serif';
  ctx.fillStyle = '#6B5344';
  ctx.fillText(courseName, 400, 350);

  // Ornament
  ctx.fillStyle = '#C9A84C';
  ctx.fillRect(350, 380, 100, 2);

  // Date
  ctx.font = '400 13px "Inter", sans-serif';
  ctx.fillStyle = '#8C7B6B';
  ctx.fillText(date, 400, 420);

  // Decorative corners
  ctx.fillStyle = '#C9A84C';
  // top-left
  ctx.fillRect(40, 40, 30, 2);
  ctx.fillRect(40, 40, 2, 30);
  // top-right
  ctx.fillRect(730, 40, 30, 2);
  ctx.fillRect(758, 40, 2, 30);
  // bottom-left
  ctx.fillRect(40, 558, 30, 2);
  ctx.fillRect(40, 530, 2, 30);
  // bottom-right
  ctx.fillRect(730, 558, 30, 2);
  ctx.fillRect(758, 530, 2, 30);

  // Download as image (simulating PDF)
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NeuralCraft_Certificate_${studentName.replace(/\s+/g, '_')}.png`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Сертификат скачан!', 'success');
  }, 'image/png');
}

// ─── Create Course ──────────────────────────────
function openCreateCourseModal() {
  if (!currentUser || currentUser.role !== 'admin') { showToast('Только администратор может создавать курсы', 'error'); return; }
  document.getElementById('newCourseTitle').value = '';
  document.getElementById('newCourseDesc').value = '';
  document.getElementById('newCourseLevel').value = 'beginner';
  document.getElementById('newCourseAccess').value = 'novice';
  document.getElementById('newCourseLanguage').value = 'ru';
  openModal('modalCreateCourse');
  setTimeout(() => document.getElementById('newCourseTitle').focus(), 200);
}

function createCourse() {
  const title = document.getElementById('newCourseTitle').value.trim();
  if (!title) { showToast('Введите название курса', 'error'); return; }

  const course = {
    id: genId(), title,
    description: document.getElementById('newCourseDesc').value.trim(),
    level: document.getElementById('newCourseLevel').value,
    accessLevel: document.getElementById('newCourseAccess').value,
    language: document.getElementById('newCourseLanguage').value,
    status: 'draft', preview: '', tags: '',
    lessons: [],
    createdBy: currentUser.id,
    createdAt: Date.now(), updatedAt: Date.now()
  };
  const courses = getCourses();
  courses.push(course);
  saveCourses(courses);
  closeModal('modalCreateCourse');
  showToast('Курс создан!', 'success');
  openCourseEditor(course.id);
}

// ─── Course Editor ──────────────────────────────
function openCourseEditor(courseId) {
  if (!currentUser || currentUser.role !== 'admin') return;
  const courses = getCourses();
  const course  = courses.find(c => c.id === courseId);
  if (!course) return;

  currentCourseId = courseId;

  document.getElementById('courseTitle').value       = course.title || '';
  document.getElementById('courseDescription').value = course.description || '';
  document.getElementById('courseLevel').value       = course.level || 'beginner';
  document.getElementById('courseStatus').value      = course.status || 'draft';
  document.getElementById('courseAccessLevel').value = course.accessLevel || 'novice';
  document.getElementById('courseTags').value        = course.tags || '';
  document.getElementById('courseLanguage').value    = course.language || 'ru';
  document.getElementById('coursePreviewUrl').value  = course.preview || '';

  const img = document.getElementById('coursePreviewImg');
  const ph  = document.getElementById('coursePreviewPlaceholder');
  if (course.preview) {
    img.src = course.preview; img.style.display = 'block'; img.className = 'preview-set'; ph.style.display = 'none';
  } else {
    img.style.display = 'none'; img.src = ''; ph.style.display = 'flex';
  }

  renderLessons(courseId);
  showView('course-editor');
}

function saveCourse() {
  const courses = getCourses();
  const course  = courses.find(c => c.id === currentCourseId);
  if (!course) return;
  const title = document.getElementById('courseTitle').value.trim();
  if (!title) { showToast('Введите название', 'error'); return; }
  course.title       = title;
  course.description = document.getElementById('courseDescription').value.trim();
  course.level       = document.getElementById('courseLevel').value;
  course.status      = document.getElementById('courseStatus').value;
  course.accessLevel = document.getElementById('courseAccessLevel').value;
  course.tags        = document.getElementById('courseTags').value.trim();
  course.language    = document.getElementById('courseLanguage').value;
  course.updatedAt   = Date.now();
  saveCourses(courses);
  showToast('Курс сохранён!', 'success');
}

function confirmDeleteCourse(courseId) {
  document.getElementById('confirmTitle').textContent   = 'Удалить курс?';
  document.getElementById('confirmMessage').textContent = 'Все уроки курса будут удалены. Это действие нельзя отменить.';
  document.getElementById('confirmBtn').onclick = () => deleteCourse(courseId);
  openModal('modalConfirm');
}

function deleteCourse(courseId) {
  const courses = getCourses().filter(c => c.id !== courseId);
  saveCourses(courses);
  closeModal('modalConfirm');
  showToast('Курс удалён', 'info');
  showView('courses');
}

// ─── Course Preview ─────────────────────────────
function triggerCourseImageUpload() { document.getElementById('courseImageInput').click(); }
function handleCourseImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Файл слишком большой (макс. 5MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => setCoursePreview(ev.target.result);
  reader.readAsDataURL(file);
}
function setCoursePreviewFromUrl(url) { if (url.trim()) setCoursePreview(url.trim()); }
function setCoursePreview(src) {
  const courses = getCourses();
  const course  = courses.find(c => c.id === currentCourseId);
  if (course) { course.preview = src; saveCourses(courses); }
  const img = document.getElementById('coursePreviewImg');
  const ph  = document.getElementById('coursePreviewPlaceholder');
  img.src = src; img.style.display = 'block'; img.className = 'preview-set'; ph.style.display = 'none';
}

// ─── Lessons Rendering ──────────────────────────
const TYPE_ICONS = {
  video:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  text:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>`,
  quiz:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  prompt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
};
const TYPE_LABEL = { video: 'Видео', text: 'Текст', quiz: 'Тест', prompt: 'Промпт' };
const TYPE_BADGE = { video: 'badge-brown', text: 'badge-gold', quiz: 'badge-orange', prompt: 'badge-green' };

function renderLessons(courseId) {
  const courses = getCourses();
  const course  = courses.find(c => c.id === courseId);
  if (!course) return;
  const lessons = (course.lessons || []).sort((a, b) => (a.order || 0) - (b.order || 0));
  document.getElementById('lessonsCount').textContent = lessons.length;
  const container = document.getElementById('lessonsList');

  if (lessons.length === 0) {
    container.innerHTML = `<div class="empty-lessons"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg><p>Добавьте первый урок</p></div>`;
    return;
  }

  container.innerHTML = lessons.map(l => {
    const si = l.status === 'published' ? { cls:'badge-green', lbl:'Опубликован' } : { cls:'badge-gray', lbl:'Черновик' };
    const thumb = l.preview
      ? `<div class="lesson-thumb"><img src="${l.preview}" alt="" onerror="this.parentElement.innerHTML='${TYPE_ICONS[l.type]||TYPE_ICONS.text}'" /></div>`
      : `<div class="lesson-thumb">${TYPE_ICONS[l.type] || TYPE_ICONS.text}</div>`;
    return `<div class="lesson-item" onclick="openEditLessonModal('${l.id}')">
      <div class="lesson-drag"><span></span><span></span><span></span></div>
      ${thumb}
      <div class="lesson-info">
        <div class="lesson-name">${l.title || 'Без названия'}</div>
        <div class="lesson-meta-row">
          <span class="badge ${TYPE_BADGE[l.type]||'badge-gray'}">${TYPE_LABEL[l.type]||l.type}</span>
          ${l.duration ? `<span class="lesson-meta">${l.duration} мин</span>` : ''}
          <span class="badge ${si.cls}">${si.lbl}</span>
        </div>
      </div>
      <div class="lesson-actions" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="openLessonViewer('${courseId}', '${l.id}')" title="Просмотреть"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button class="btn-icon" onclick="openEditLessonModal('${l.id}')" title="Редактировать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-icon danger" onclick="confirmDeleteLesson('${l.id}')" title="Удалить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

// ─── Lesson Modal ────────────────────────────────
function openAddLessonModal() {
  document.getElementById('lessonModalTitle').textContent = 'Добавить урок';
  document.getElementById('editingLessonId').value = '';
  ['lessonTitle','lessonDescription','lessonContent','lessonVideoUrl','lessonPreviewUrl'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('lessonDuration').value = '';
  document.getElementById('lessonStatus').value = 'draft';
  const courses = getCourses();
  const course  = courses.find(c => c.id === currentCourseId);
  document.getElementById('lessonOrder').value = course ? (course.lessons || []).length + 1 : 1;
  resetLessonPreview();
  selectLessonType('text', document.querySelector('.type-btn[data-type="text"]'));
  lessonResources = [];
  quizQuestions = [];
  document.getElementById('resourcesList').innerHTML = '';
  document.getElementById('quizQuestionsEditor').innerHTML = '';
  document.getElementById('promptTaskText').value = '';
  document.getElementById('promptKeywords').value = '';
  document.getElementById('promptMinMatch').value = '3';
  openModal('modalLesson');
  setTimeout(() => document.getElementById('lessonTitle').focus(), 200);
}

function openEditLessonModal(lessonId) {
  const courses = getCourses();
  const course  = courses.find(c => c.id === currentCourseId);
  if (!course) return;
  const lesson = course.lessons.find(l => l.id === lessonId);
  if (!lesson) return;

  document.getElementById('lessonModalTitle').textContent = 'Редактировать урок';
  document.getElementById('editingLessonId').value = lessonId;
  document.getElementById('lessonTitle').value = lesson.title || '';
  document.getElementById('lessonDescription').value = lesson.description || '';
  document.getElementById('lessonContent').value = lesson.content || '';
  document.getElementById('lessonDuration').value = lesson.duration || '';
  document.getElementById('lessonStatus').value = lesson.status || 'draft';
  document.getElementById('lessonVideoUrl').value = lesson.videoUrl || '';
  document.getElementById('lessonOrder').value = lesson.order || '';
  document.getElementById('lessonPreviewUrl').value = lesson.preview || '';

  lesson.preview ? setLessonPreview(lesson.preview) : resetLessonPreview();
  const typeBtn = document.querySelector(`.type-btn[data-type="${lesson.type || 'text'}"]`);
  selectLessonType(lesson.type || 'text', typeBtn);

  lessonResources = lesson.resources ? [...lesson.resources] : [];
  renderResources();

  // Quiz data
  quizQuestions = lesson.quizData ? JSON.parse(JSON.stringify(lesson.quizData)) : [];
  renderQuizEditor();

  // Prompt data
  if (lesson.promptData) {
    document.getElementById('promptTaskText').value = lesson.promptData.task || '';
    document.getElementById('promptKeywords').value = lesson.promptData.keywords || '';
    document.getElementById('promptMinMatch').value = lesson.promptData.minMatch || '3';
  } else {
    document.getElementById('promptTaskText').value = '';
    document.getElementById('promptKeywords').value = '';
    document.getElementById('promptMinMatch').value = '3';
  }

  openModal('modalLesson');
}

function saveLesson() {
  const title = document.getElementById('lessonTitle').value.trim();
  if (!title) { showToast('Введите название урока', 'error'); document.getElementById('lessonTitle').focus(); return; }

  const courses = getCourses();
  const course  = courses.find(c => c.id === currentCourseId);
  if (!course) return;

  const editingId = document.getElementById('editingLessonId').value;
  const previewImg = document.getElementById('lessonPreviewImg');
  const preview = (previewImg.style.display !== 'none' && previewImg.src && !previewImg.src.endsWith('/')) ? previewImg.src : '';

  const data = {
    title,
    description: document.getElementById('lessonDescription').value.trim(),
    content:     document.getElementById('lessonContent').value,
    type:        currentLessonTypeVal,
    duration:    document.getElementById('lessonDuration').value,
    status:      document.getElementById('lessonStatus').value,
    videoUrl:    document.getElementById('lessonVideoUrl').value.trim(),
    order:       parseInt(document.getElementById('lessonOrder').value) || (course.lessons.length + 1),
    preview, resources: [...lessonResources], updatedAt: Date.now()
  };

  // Quiz data
  if (currentLessonTypeVal === 'quiz') {
    data.quizData = quizQuestions;
  }

  // Prompt data
  if (currentLessonTypeVal === 'prompt') {
    data.promptData = {
      task: document.getElementById('promptTaskText').value.trim(),
      keywords: document.getElementById('promptKeywords').value.trim(),
      minMatch: parseInt(document.getElementById('promptMinMatch').value) || 3
    };
  }

  if (editingId) {
    const idx = course.lessons.findIndex(l => l.id === editingId);
    if (idx !== -1) { course.lessons[idx] = { ...course.lessons[idx], ...data }; showToast('Урок обновлён!', 'success'); }
  } else {
    course.lessons.push({ id: genId(), ...data, createdAt: Date.now() });
    showToast('Урок добавлен!', 'success');
  }
  course.updatedAt = Date.now();
  saveCourses(courses);
  closeModal('modalLesson');
  renderLessons(currentCourseId);
}

function confirmDeleteLesson(lessonId) {
  document.getElementById('confirmTitle').textContent   = 'Удалить урок?';
  document.getElementById('confirmMessage').textContent = 'Урок будет удалён без возможности восстановления.';
  document.getElementById('confirmBtn').onclick = () => deleteLesson(lessonId);
  openModal('modalConfirm');
}

function deleteLesson(lessonId) {
  const courses = getCourses();
  const course  = courses.find(c => c.id === currentCourseId);
  if (!course) return;
  course.lessons = course.lessons.filter(l => l.id !== lessonId);
  course.updatedAt = Date.now();
  saveCourses(courses);
  closeModal('modalConfirm');
  showToast('Урок удалён', 'info');
  renderLessons(currentCourseId);
}

// ─── Lesson Type ─────────────────────────────────
function selectLessonType(type, btn) {
  currentLessonTypeVal = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('videoUrlGroup').style.display = type === 'video' ? 'block' : 'none';
  document.getElementById('quizEditor').style.display = type === 'quiz' ? 'block' : 'none';
  document.getElementById('promptEditor').style.display = type === 'prompt' ? 'block' : 'none';
}

// ─── Quiz Editor ─────────────────────────────────
function addQuizQuestion() {
  quizQuestions.push({ question: '', options: ['', '', '', ''], correctIndex: 0 });
  renderQuizEditor();
}

function removeQuizQuestion(idx) {
  quizQuestions.splice(idx, 1);
  renderQuizEditor();
}

function updateQuizQuestion(idx, field, value) {
  if (field === 'question') quizQuestions[idx].question = value;
  else if (field === 'correctIndex') quizQuestions[idx].correctIndex = parseInt(value);
}

function updateQuizOption(qi, oi, value) {
  quizQuestions[qi].options[oi] = value;
}

function renderQuizEditor() {
  const container = document.getElementById('quizQuestionsEditor');
  container.innerHTML = quizQuestions.map((q, qi) => {
    const optionsHtml = q.options.map((opt, oi) =>
      `<div class="quiz-editor-option">
        <input type="radio" name="correct_${qi}" ${q.correctIndex === oi ? 'checked' : ''} onchange="updateQuizQuestion(${qi},'correctIndex',${oi})" />
        <input type="text" class="form-input" placeholder="Вариант ${oi + 1}" value="${escHtml(opt)}" oninput="updateQuizOption(${qi},${oi},this.value)" />
      </div>`
    ).join('');
    return `<div class="quiz-editor-question">
      <button class="btn-icon danger quiz-editor-remove" onclick="removeQuizQuestion(${qi})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <input type="text" class="form-input" placeholder="Вопрос ${qi + 1}" value="${escHtml(q.question)}" oninput="updateQuizQuestion(${qi},'question',this.value)" />
      <div style="font-size:0.72rem;color:var(--text-muted);margin:6px 0 4px">Варианты ответов (выберите правильный):</div>
      ${optionsHtml}
    </div>`;
  }).join('');
}

// ─── Lesson Preview ──────────────────────────────
function triggerLessonImageUpload() { document.getElementById('lessonImageInput').click(); }
function handleLessonImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Максимум 5MB', 'error'); return; }
  const r = new FileReader();
  r.onload = ev => setLessonPreview(ev.target.result);
  r.readAsDataURL(file);
}
function setLessonPreviewFromUrl(url) { if (url.trim()) setLessonPreview(url.trim()); }
function setLessonPreview(src) {
  const img = document.getElementById('lessonPreviewImg');
  const ph  = document.getElementById('lessonPreviewPlaceholder');
  img.src = src; img.style.display = 'block'; img.className = 'preview-set';
  if (ph) ph.style.display = 'none';
}
function resetLessonPreview() {
  const img = document.getElementById('lessonPreviewImg');
  const ph  = document.getElementById('lessonPreviewPlaceholder');
  img.src = ''; img.style.display = 'none'; img.className = '';
  if (ph) ph.style.display = 'flex';
}

// ─── Insert image into lesson content ────────────
function insertImageInContent() { document.getElementById('contentImageInput').click(); }
function insertContentImage(e) {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Максимум 5MB', 'error'); return; }

  // Compress image via canvas before inserting
  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  img.onload = () => {
    const MAX_W = 800;
    const MAX_H = 800;
    let w = img.naturalWidth;
    let h = img.naturalHeight;

    // Scale down if larger than max
    if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
    if (h > MAX_H) { w = Math.round(w * MAX_H / h); h = MAX_H; }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    // JPEG at 70% quality — much smaller than raw base64
    const compressed = canvas.toDataURL('image/jpeg', 0.7);
    URL.revokeObjectURL(objectUrl);

    const ta = document.getElementById('lessonContent');
    const pos = ta.selectionStart;
    const name = file.name.replace(/\.[^.]+$/, '');
    const tag = `\n![${name}](${compressed})\n`;
    ta.value = ta.value.substring(0, pos) + tag + ta.value.substring(pos);
    ta.setSelectionRange(pos + tag.length, pos + tag.length);
    ta.focus();
    showToast('Фото сжато и вставлено', 'success');
  };
  img.src = objectUrl;
  e.target.value = '';
}

// ─── Editor Toolbar ──────────────────────────────
function formatText(cmd) {
  const ta = document.getElementById('lessonContent');
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.substring(s, e);
  const w = cmd === 'bold' ? '**' : '_';
  ta.value = ta.value.substring(0, s) + w + sel + w + ta.value.substring(e);
  ta.setSelectionRange(s + w.length, e + w.length);
  ta.focus();
}
function insertHeading() {
  const ta = document.getElementById('lessonContent');
  const pos = ta.selectionStart;
  const before = ta.value.substring(0, pos);
  const after  = ta.value.substring(pos);
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.substring(lineStart);
  ta.value = before.substring(0, lineStart) + '## ' + line + after;
  ta.focus();
}
function insertCode() {
  const ta = document.getElementById('lessonContent');
  const pos = ta.selectionStart;
  const block = '\n```python\n# код здесь\n```\n';
  ta.value = ta.value.substring(0, pos) + block + ta.value.substring(pos);
  ta.setSelectionRange(pos + block.length, pos + block.length);
  ta.focus();
}
function insertList() {
  const ta = document.getElementById('lessonContent');
  const pos = ta.selectionStart;
  const item = '\n- ';
  ta.value = ta.value.substring(0, pos) + item + ta.value.substring(pos);
  ta.setSelectionRange(pos + item.length, pos + item.length);
  ta.focus();
}

// ─── Resources ───────────────────────────────────
function addResource() {
  lessonResources.push({ id: genId(), label: '', url: '' });
  renderResources();
}
function removeResource(id) {
  lessonResources = lessonResources.filter(r => r.id !== id);
  renderResources();
}
function updateResource(id, field, value) {
  const r = lessonResources.find(x => x.id === id);
  if (r) r[field] = value;
}
function renderResources() {
    const c = document.getElementById('resourcesList');
  c.innerHTML = lessonResources.map(r => `
    <div class="resource-item">
      <input type="text" class="form-input" placeholder="Название" value="${r.label}" oninput="updateResource('${r.id}','label',this.value)" style="max-width:130px"/>
      <input type="text" class="form-input" placeholder="https://..." value="${r.url}" oninput="updateResource('${r.id}','url',this.value)"/>
      <button class="btn-icon danger" onclick="removeResource('${r.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`).join('');
}

// ─── Users View ──────────────────────────────────
function renderUsers() {
  const users = getUsers();
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">Нет зарегистрированных пользователей</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const initials = (u.displayName || u.username).slice(0, 2).toUpperCase();
    const date = new Date(u.createdAt).toLocaleDateString('ru-RU');
    const isSelf = currentUser && u.id === currentUser.id;

    const roleSelect = !isSelf ? `
      <select class="form-select" style="max-width:160px;padding:6px 10px;font-size:0.8rem" onchange="changeUserRole('${u.id}', this.value)">
        ${ROLES.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
      </select>` : `<span class="badge ${ROLE_BADGES[u.role]}">${ROLE_LABELS[u.role]}</span>`;

    return `<tr>
      <td><div class="user-cell"><span class="user-row-avatar">${initials}</span>${u.displayName || u.username}</div></td>
      <td style="color:var(--text-secondary)">@${u.username}${isSelf ? ' <span class="badge badge-green">Вы</span>' : ''}</td>
      <td><span class="badge ${ROLE_BADGES[u.role]||'badge-gray'}">${ROLE_LABELS[u.role]||u.role}</span></td>
      <td style="color:var(--text-secondary)">${date}</td>
      <td>
        ${!isSelf ? roleSelect : '—'}
        ${!isSelf ? `<button class="btn-danger btn-sm" style="margin-left:6px" onclick="confirmDeleteUser('${u.id}')">Удалить</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

async function changeUserRole(userId, newRole) {
  await api('/api/users/' + userId + '/role', { method: 'PATCH', body: { role: newRole } });
  await loadUserData(currentUser.id);
  showToast(`Тариф изменён`, 'success');
  renderUsers();
}

function confirmDeleteUser(userId) {
  document.getElementById('confirmTitle').textContent   = 'Удалить пользователя?';
  document.getElementById('confirmMessage').textContent = 'Аккаунт будет удалён без возможности восстановления.';
  document.getElementById('confirmBtn').onclick = () => deleteUser(userId);
  openModal('modalConfirm');
}

async function deleteUser(userId) {
  await api('/api/users/' + userId, { method: 'DELETE' });
  await loadUserData(currentUser.id);
  closeModal('modalConfirm');
  showToast('Пользователь удалён', 'info');
  renderUsers();
}

// ─── Profile ─────────────────────────────────────
function openProfileModal() {
  if (!currentUser) return;
  document.getElementById('profileDisplayName').value = currentUser.displayName || '';
  document.getElementById('profileNewPassword').value = '';
  document.getElementById('profileNewPassword2').value = '';
  const initials = (currentUser.displayName || currentUser.username).slice(0, 2).toUpperCase();
  document.getElementById('profileAvatar').textContent = initials;
  openModal('modalProfile');
}

async function saveProfile() {
  const newName = document.getElementById('profileDisplayName').value.trim();
  const newPass = document.getElementById('profileNewPassword').value;
  const newPass2 = document.getElementById('profileNewPassword2').value;

  if (!newName) { showToast('Введите имя', 'error'); return; }
  if (newPass && newPass.length < 6) { showToast('Пароль минимум 6 символов', 'error'); return; }
  if (newPass && newPass !== newPass2) { showToast('Пароли не совпадают', 'error'); return; }

  const body = { displayName: newName };
  if (newPass) body.password = newPass;

  const result = await api('/api/users/' + currentUser.id + '/profile', { method: 'PATCH', body });
  if (result && result.user) {
    currentUser.displayName = result.user.displayName;
    await loadUserData(currentUser.id);
  }

  saveSession(currentUser);
  applySidebarUser();

  closeModal('modalProfile');
  showToast('Профиль обновлён!', 'success');
}

// ─── Search ──────────────────────────────────────
function handleSearch(query) {
  const q = query.toLowerCase().trim();
  const active = document.querySelector('.view.active');
  if (!active || active.id !== 'view-courses') { showView('courses'); }
  if (!q) { renderCourses(); return; }
  const isAdmin = currentUser && currentUser.role === 'admin';
  let courses = getCourses();
  if (!isAdmin) courses = courses.filter(c => c.status === 'published');
  const filtered = courses.filter(c =>
    c.title.toLowerCase().includes(q) ||
    (c.description || '').toLowerCase().includes(q) ||
    (c.tags || '').toLowerCase().includes(q)
  );
  const grid = document.getElementById('courses-grid');
  const progress = currentUser ? getProgress(currentUser.id) : {};
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><h3>Ничего не найдено</h3><p>Попробуйте другой запрос</p></div>`;
    return;
  }
  grid.innerHTML = filtered.map(c => buildCourseCard(c, progress)).join('');
}

// ─── Export / Import ─────────────────────────────
async function exportData() {
  const data = await api('/api/export');
  if (!data) { showToast('Ошибка экспорта', 'error'); return; }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `neuralcraft-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Данные экспортированы', 'success');
}

function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.courses || !Array.isArray(data.courses)) throw new Error('Неверный формат');
      document.getElementById('confirmTitle').textContent   = 'Импортировать данные?';
      document.getElementById('confirmMessage').textContent = `Будет загружено ${data.courses.length} курсов${data.users ? ` и ${data.users.length} пользователей` : ''}. Это заменит текущие данные.`;
      document.getElementById('confirmBtn').textContent     = 'Импортировать';
      document.getElementById('confirmBtn').onclick = async () => {
        await api('/api/import', { method: 'POST', body: data });
        if (currentUser) await loadUserData(currentUser.id);
        closeModal('modalConfirm');
        showToast(`Импортировано ${data.courses.length} курсов`, 'success');
        renderDashboard();
        showView('dashboard');
        document.getElementById('confirmBtn').textContent = 'Подтвердить';
      };
      openModal('modalConfirm');
    } catch(err) {
      showToast('Ошибка импорта: неверный файл', 'error');
    }
  };
  r.readAsText(file);
  e.target.value = '';
}

// ─── Demo data ───────────────────────────────────
function addDemoDataIfEmpty() {
  if (getCourses().length > 0) return;
  const demoQuiz = [
    { question: 'Что такое промпт?', options: ['Запрос к нейросети', 'Тип файла', 'Язык программирования', 'Операционная система'], correctIndex: 0 },
    { question: 'Какая нейросеть создаёт изображения?', options: ['ChatGPT', 'Midjourney', 'Google Sheets', 'VS Code'], correctIndex: 1 },
    { question: 'Что влияет на качество сгенерированного изображения?', options: ['Размер монитора', 'Детализация промпта', 'Скорость интернета', 'Версия браузера'], correctIndex: 1 }
  ];

  const demoPrompt = {
    task: 'Напишите промпт для создания фотореалистичного портрета кота в студийном освещении, используя технику Midjourney.',
    keywords: 'фотореалистичный,портрет,кот,студийное освещение,midjourney,детализация,высокое качество',
    minMatch: 4
  };

  const demo = {
    id: genId(), title: 'Создание изображений через ИИ',
    description: 'Научитесь создавать профессиональные изображения с помощью нейросетей: Midjourney, DALL-E и другие инструменты.',
    level: 'beginner', language: 'ru', status: 'published',
    accessLevel: 'novice',
    preview: 'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=600&q=80',
    tags: 'нейросети, Midjourney, изображения',
    createdBy: currentUser ? currentUser.id : 'system',
    lessons: [
      { id: genId(), title: 'Введение в ИИ-генерацию', description: 'Основы создания контента через ИИ', type: 'text', duration: '20', status: 'published', order: 1,
        content: '## Что такое ИИ-генерация?\n\nИскусственный интеллект может создавать:\n- **Изображения** — фотореалистичные и художественные\n- **Видео** — короткие ролики и анимации\n- **Текст** — статьи, сценарии, описания\n\n### Основные инструменты\n\n1. Midjourney — лидер в создании изображений\n2. DALL-E — разработка OpenAI\n3. Stable Diffusion — открытая модель\n\n> Ключ к хорошему результату — правильный промпт!',
        preview: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=300&q=80', resources: [], createdAt: Date.now(), updatedAt: Date.now() },
      { id: genId(), title: 'Основы промптинга', description: 'Как писать эффективные промпты', type: 'text', duration: '30', status: 'published', order: 2,
        content: '## Структура промпта\n\nХороший промпт состоит из:\n\n1. **Основной объект** — что вы хотите увидеть\n2. **Стиль** — фотореализм, мультяшный, масло и т.д.\n3. **Освещение** — студийное, естественное, закат\n4. **Детали** — качество, разрешение, угол камеры\n\n### Пример\n\n```\nphoto-realistic portrait of a cat, studio lighting,\nhigh detail, 8k resolution, soft bokeh background\n```\n\n### Частые ошибки\n\n- Слишком короткий промпт\n- Противоречивые описания\n- Отсутствие стиля и настроения',
        preview: '', resources: [], createdAt: Date.now(), updatedAt: Date.now() },
      { id: genId(), title: 'Тест: Основы ИИ', description: 'Проверьте свои знания', type: 'quiz', duration: '10', status: 'published', order: 3,
        content: '## Тест по основам\n\nОтветьте на вопросы ниже, чтобы завершить этот блок обучения.',
        quizData: demoQuiz,
        preview: '', resources: [], createdAt: Date.now(), updatedAt: Date.now() },
      { id: genId(), title: 'Практика: Пишем промпт', description: 'Создайте свой первый промпт', type: 'prompt', duration: '15', status: 'published', order: 4,
        content: '## Практическое задание\n\nТеперь пришло время применить знания на практике!\n\nНапишите промпт по заданию ниже. Система проверит наличие ключевых элементов в вашем промпте.',
        promptData: demoPrompt,
        preview: '', resources: [], createdAt: Date.now(), updatedAt: Date.now() }
    ],
    createdAt: Date.now() - 86400000, updatedAt: Date.now()
  };

  const demo2 = {
    id: genId(), title: 'Продвинутый Midjourney',
    description: 'Продвинутые техники создания изображений: стили, параметры, inpainting и outpainting.',
    level: 'intermediate', language: 'ru', status: 'published',
    accessLevel: 'standard',
    preview: 'https://images.unsplash.com/photo-1686191128892-3b37add4c844?w=600&q=80',
    tags: 'Midjourney, продвинутый, стили',
    createdBy: currentUser ? currentUser.id : 'system',
    lessons: [
      { id: genId(), title: 'Параметры Midjourney', type: 'text', duration: '40', status: 'published', order: 1,
        content: '## Параметры генерации\n\nMidjourney поддерживает множество параметров:\n\n- `--ar` — соотношение сторон\n- `--v` — версия модели\n- `--q` — качество\n- `--s` — стилизация\n- `--chaos` — вариативность\n\n### Примеры\n\n```\n/imagine beautiful landscape --ar 16:9 --v 6 --q 2\n```',
        preview: '', resources: [], createdAt: Date.now(), updatedAt: Date.now() }
    ],
    createdAt: Date.now() - 43200000, updatedAt: Date.now()
  };

  saveCourses([demo, demo2]);
}

// ─── Keyboard shortcuts ──────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => {
      m.classList.remove('open'); document.body.style.overflow = '';
    });
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    const editor = document.getElementById('view-course-editor');
    if (editor && editor.classList.contains('active')) { e.preventDefault(); saveCourse(); }
  }
  if (e.key === 'Enter') {
    const authScreen = document.getElementById('authScreen');
    const isAuthVisible = authScreen && authScreen.style.display !== 'none' && authScreen.offsetParent !== null;
    if (isAuthVisible) {
      const loginForm = document.getElementById('loginForm');
      if (loginForm && loginForm.style.display !== 'none') {
        const modals = document.querySelectorAll('.modal-overlay.open');
        if (modals.length === 0) { e.preventDefault(); handleLogin(); }
      }
    }
  }
});

// ─── Init ────────────────────────────────────────
async function init() {
  initTheme();
  try {
    const saved = getSavedSession();
    if (saved) {
      const user = JSON.parse(saved);
      // Load data from server first, then verify user exists
      await loadUserData(user.id);
      const users = getUsers();
      const found = users.find(u => u.id === user.id);
      if (found) { startSession(found); return; }
    }
  } catch(e) { console.log('Init session error:', e); }
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}

init();

// ═══════════════════════════════════════════
// NEW FEATURES: Favorites, Achievements, Glossary
// ═══════════════════════════════════════════

// --- Favorites --------------------------------
function getFavorites(userId) {
  return _cache.favorites[userId] || [];
}
function saveFavorites(userId, favs) {
  _cache.favorites[userId] = favs;
  api('/api/favorites/' + userId, { method: 'PUT', body: favs });
}
function toggleFavorite(courseId) {
  if (!currentUser) return;
  var favs = getFavorites(currentUser.id);
  if (favs.includes(courseId)) {
    favs = favs.filter(function(f) { return f !== courseId; });
    showToast('Убрано из избранного', 'info');
  } else {
    favs.push(courseId);
    showToast('Добавлено в избранное', 'success');
  }
  saveFavorites(currentUser.id, favs);
  var active = document.querySelector('.view.active');
  if (active) {
    var viewId = active.id.replace('view-', '');
    if (viewId === 'favorites') renderFavorites();
    else if (viewId === 'courses') renderCourses();
    else if (viewId === 'dashboard') renderDashboard();
  }
}
function isFavorite(courseId) {
  if (!currentUser) return false;
  return getFavorites(currentUser.id).includes(courseId);
}
function renderFavorites() {
  if (!currentUser) return;
  var favs = getFavorites(currentUser.id);
  var courses = getCourses();
  var progress = getProgress(currentUser.id);
  var favCourses = courses.filter(function(c) { return favs.includes(c.id) && c.status === 'published'; });
  var grid = document.getElementById('favorites-grid');
  if (!grid) return;
  if (favCourses.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><h3>Нет избранных курсов</h3><p>Нажмите ❤️ на карточке курса, чтобы добавить его сюда</p></div>';
    return;
  }
  grid.innerHTML = favCourses.map(function(c) { return buildCourseCard(c, progress); }).join('');
}

// --- Achievements (Dynamic — stored in LocalStorage) ---------
const KEY_ACHIEVEMENTS = 'nc_achievements_def';

const DEFAULT_ACHIEVEMENTS = [
  // ── Одиночные (без группы) ──
  { id: 'first_login',     icon: '🚀', title: 'Первый шаг',       desc: 'Войти в систему',                   condition: 'first_login',       need: 0, tier: '', group: '' },
  { id: 'night_owl',       icon: '🦉', title: 'Ночная сова',       desc: 'Посетить платформу после 22:00',     condition: 'night_owl',          need: 0, tier: '', group: '' },
  { id: 'early_bird',      icon: '☀️', title: 'Ранняя пташка',     desc: 'Посетить с 5:00 до 7:00',            condition: 'early_bird',         need: 0, tier: '', group: '' },

  // ── Уроки (одна группа — 3 уровня) ──
  { id: 'lessons_10',      icon: '📖', title: 'Ученик',             desc: 'Просмотреть 10 уроков',              condition: 'lessons_viewed',     need: 10, tier: 'bronze', group: 'lessons' },
  { id: 'lessons_25',      icon: '📚', title: 'Книжный червь',      desc: 'Просмотреть 25 уроков',              condition: 'lessons_viewed',     need: 25, tier: 'silver', group: 'lessons' },
  { id: 'lessons_50',      icon: '🧠', title: 'Академик',           desc: 'Просмотреть 50 уроков',              condition: 'lessons_viewed',     need: 50, tier: 'gold',   group: 'lessons' },

  // ── Тесты (одна группа — 3 уровня) ──
  { id: 'quiz_1',          icon: '✅', title: 'Экзаменатор',        desc: 'Пройти первый тест',                 condition: 'quizzes_passed',     need: 1,  tier: 'bronze', group: 'quizzes' },
  { id: 'quiz_5',          icon: '🎯', title: 'Знаток',             desc: 'Пройти 5 тестов',                    condition: 'quizzes_passed',     need: 5,  tier: 'silver', group: 'quizzes' },
  { id: 'quiz_15',         icon: '💎', title: 'Эксперт тестов',     desc: 'Пройти 15 тестов',                   condition: 'quizzes_passed',     need: 15, tier: 'gold',   group: 'quizzes' },

  // ── Промпты (одна группа — 3 уровня) ──
  { id: 'prompt_1',        icon: '📝', title: 'Промпт-мастер',      desc: 'Выполнить промпт-задание',            condition: 'prompts_completed',  need: 1,  tier: 'bronze', group: 'prompts' },
  { id: 'prompt_5',        icon: '✍️', title: 'Промпт-инженер',     desc: 'Выполнить 5 промпт-заданий',          condition: 'prompts_completed',  need: 5,  tier: 'silver', group: 'prompts' },
  { id: 'prompt_10',       icon: '🤖', title: 'AI-виртуоз',         desc: 'Выполнить 10 промпт-заданий',         condition: 'prompts_completed',  need: 10, tier: 'gold',   group: 'prompts' },

  // ── Курсы (одна группа — 3 уровня) ──
  { id: 'course_1',        icon: '🎓', title: 'Выпускник',          desc: 'Завершить первый курс',               condition: 'courses_completed',  need: 1,  tier: 'bronze', group: 'courses_done' },
  { id: 'course_3',        icon: '🏅', title: 'Марафонец',          desc: 'Завершить 3 курса',                   condition: 'courses_completed',  need: 3,  tier: 'silver', group: 'courses_done' },
  { id: 'course_5',        icon: '🏆', title: 'Чемпион',            desc: 'Завершить 5 курсов',                  condition: 'courses_completed',  need: 5,  tier: 'gold',   group: 'courses_done' },

  // ── Избранное (одна группа — 3 уровня) ──
  { id: 'fav_1',           icon: '❤️', title: 'Ценитель',           desc: 'Добавить курс в избранное',           condition: 'favorites_count',    need: 1,  tier: 'bronze', group: 'favs' },
  { id: 'fav_3',           icon: '💛', title: 'Коллекционер',       desc: 'Добавить 3 курса в избранное',        condition: 'favorites_count',    need: 3,  tier: 'silver', group: 'favs' },
  { id: 'fav_5',           icon: '💜', title: 'Меценат',            desc: 'Добавить 5 курсов в избранное',       condition: 'favorites_count',    need: 5,  tier: 'gold',   group: 'favs' }
];

function getAchievementsDef() {
  const ACHIEVEMENTS_VERSION = 3;
  // Try loading from server cache (kv_store)
  const cached = _cache._achievementsDef;
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;
  // Seed defaults
  _cache._achievementsDef = DEFAULT_ACHIEVEMENTS;
  saveAchievementsDef(DEFAULT_ACHIEVEMENTS);
  return DEFAULT_ACHIEVEMENTS;
}
function saveAchievementsDef(defs) {
  _cache._achievementsDef = defs;
  api('/api/kv/achievements_def', { method: 'PUT', body: defs });
}

function getEarnedAchievements(userId) {
  return _cache._earnedAchievements && _cache._earnedAchievements[userId] || {};
}
function saveEarnedAchievements(userId, data) {
  if (!_cache._earnedAchievements) _cache._earnedAchievements = {};
  _cache._earnedAchievements[userId] = data;
  api('/api/kv/achievements_' + userId, { method: 'PUT', body: data });
}

// ── Condition evaluator (generic) ─────────────
function evaluateCondition(condition, need, progress, courses, userId) {
  const viewed = Object.values(progress).filter(v => v && v.viewed);
  const n = parseInt(need) || 1;

  switch (condition) {
    case 'first_login':
      return { met: true, current: 1, target: 1 };

    case 'lessons_viewed': {
      const count = viewed.length;
      return { met: count >= n, current: Math.min(count, n), target: n };
    }

    case 'quizzes_passed': {
      let count = 0;
      courses.forEach(c => (c.lessons||[]).forEach(l => { if (l.type === 'quiz' && progress[l.id] && progress[l.id].completed) count++; }));
      return { met: count >= n, current: Math.min(count, n), target: n };
    }

    case 'prompts_completed': {
      let count = 0;
      courses.forEach(c => (c.lessons||[]).forEach(l => { if (l.type === 'prompt' && progress[l.id] && progress[l.id].completed) count++; }));
      return { met: count >= n, current: Math.min(count, n), target: n };
    }

    case 'courses_completed': {
      const count = courses.filter(c => isCourseCompleted(c, progress)).length;
      return { met: count >= n, current: Math.min(count, n), target: n };
    }

    case 'favorites_count': {
      const count = getFavorites(userId).length;
      return { met: count >= n, current: Math.min(count, n), target: n };
    }

    case 'night_owl': {
      const h = new Date().getHours();
      return { met: h >= 22 || h < 5, current: 0, target: 0 };
    }

    case 'early_bird': {
      const h = new Date().getHours();
      return { met: h >= 5 && h < 7, current: 0, target: 0 };
    }

    default:
      return { met: false, current: 0, target: n };
  }
}

// ── Check & Award ──────────────────────────────
function checkAndAwardAchievements() {
  if (!currentUser) return;
  const achievementsDef = getAchievementsDef();
  const progress = getProgress(currentUser.id);
  const courses = getCourses().filter(c => c.status === 'published');
  const earned = getEarnedAchievements(currentUser.id);
  let newCount = 0;

  achievementsDef.forEach(a => {
    if (earned[a.id]) return;
    const result = evaluateCondition(a.condition, a.need, progress, courses, currentUser.id);
    if (result.met) {
      earned[a.id] = { earnedAt: Date.now() };
      newCount++;
    }
  });

  if (newCount > 0) {
    saveEarnedAchievements(currentUser.id, earned);
    showToast('Новое достижение! (+' + newCount + ')', 'success');
  }
}

// ── Render student achievements ────────────────
const TIER_ORDER = ['bronze', 'silver', 'gold'];
const TIER_ICONS = { bronze: '🥉', silver: '🥈', gold: '🥇' };
const TIER_NAMES = { bronze: 'Бронза', silver: 'Серебро', gold: 'Золото' };

function renderAchievements() {
  if (!currentUser) return;
  checkAndAwardAchievements();

  const achievementsDef = getAchievementsDef();
  const progress = getProgress(currentUser.id);
  const courses = getCourses().filter(c => c.status === 'published');
  const earned = getEarnedAchievements(currentUser.id);
  const grid = document.getElementById('achievements-grid');
  if (!grid) return;

  if (achievementsDef.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg></div><h3>Нет достижений</h3><p>Администратор ещё не создал достижения</p></div>';
    return;
  }

  // Separate grouped vs ungrouped
  const ungrouped = achievementsDef.filter(a => !a.group);
  const groupMap = {};
  achievementsDef.filter(a => a.group).forEach(a => {
    if (!groupMap[a.group]) groupMap[a.group] = [];
    groupMap[a.group].push(a);
  });
  // Sort each group by tier order
  Object.values(groupMap).forEach(arr => arr.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)));

  let html = '';

  // Render ungrouped (single cards)
  ungrouped.forEach(a => {
    const isEarned = !!earned[a.id];
    const date = isEarned ? new Date(earned[a.id].earnedAt).toLocaleDateString('ru-RU') : '';
    html += `<div class="achievement-card ${isEarned ? 'earned' : 'locked'}">
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-title">${escHtml(a.title)}</div>
      <div class="achievement-desc">${escHtml(a.desc)}</div>
      <div class="achievement-date">${isEarned ? date : 'Заблокировано'}</div>
    </div>`;
  });

  // Render grouped (tiered cards)
  Object.entries(groupMap).forEach(([groupName, tiers]) => {
    // Find highest earned tier
    let highestEarned = -1;
    tiers.forEach((a, i) => { if (earned[a.id]) highestEarned = i; });

    // Current tier info
    const currentTier = highestEarned >= 0 ? tiers[highestEarned] : null;
    const nextTier = highestEarned < tiers.length - 1 ? tiers[highestEarned + 1] : null;
    const isMaxed = highestEarned === tiers.length - 1;

    // Show the current or next tier's icon/title
    const displayAch = currentTier || tiers[0];
    const activeTierKey = currentTier ? currentTier.tier : '';
    const cardClass = isMaxed ? 'earned tier-gold' : (currentTier ? `earned tier-${currentTier.tier}` : 'locked');

    // Progress bar toward next tier
    let progressHtml = '';
    if (nextTier) {
      const result = evaluateCondition(nextTier.condition, nextTier.need, progress, courses, currentUser.id);
      const pct = Math.round((result.current / result.target) * 100);
      progressHtml = `<div class="achievement-progress-bar"><div class="achievement-progress-fill" style="width:${pct}%"></div></div>
        <div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px">${result.current}/${result.target}</div>`;
    } else if (!currentTier) {
      // No tier earned yet, show progress to bronze
      const first = tiers[0];
      const result = evaluateCondition(first.condition, first.need, progress, courses, currentUser.id);
      const pct = Math.round((result.current / result.target) * 100);
      progressHtml = `<div class="achievement-progress-bar"><div class="achievement-progress-fill" style="width:${pct}%"></div></div>
        <div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px">${result.current}/${result.target}</div>`;
    }

    // Tier indicators (3 circles)
    const tierIndicators = tiers.map((t, i) => {
      const isActive = i <= highestEarned;
      const isCurrent = i === highestEarned;
      return `<div class="tier-dot ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''} tier-${t.tier}" title="${TIER_NAMES[t.tier]}: ${escHtml(t.title)} — ${escHtml(t.desc)}">
        <span class="tier-dot-medal">${TIER_ICONS[t.tier]}</span>
      </div>`;
    }).join('');

    html += `<div class="achievement-card achievement-grouped ${cardClass}">
      <div class="achievement-icon">${currentTier ? currentTier.icon : displayAch.icon}</div>
      <div class="achievement-title">${escHtml(currentTier ? currentTier.title : displayAch.title)}</div>
      <div class="achievement-desc">${escHtml(nextTier ? 'Следующий: ' + nextTier.desc : (isMaxed ? 'Максимальный уровень!' : displayAch.desc))}</div>
      <div class="tier-indicators">${tierIndicators}</div>
      ${progressHtml}
    </div>`;
  });

  grid.innerHTML = html;
}

// ── Admin: Render achievements list ────────────
const CONDITION_LABELS = {
  first_login: 'Первый вход',
  lessons_viewed: 'Просмотрено уроков',
  quizzes_passed: 'Пройдено тестов',
  prompts_completed: 'Промпт-задания',
  courses_completed: 'Пройдено курсов',
  favorites_count: 'В избранном',
  night_owl: 'Ночной визит (22:00+)',
  early_bird: 'Ранний визит (5-7:00)'
};

function renderAchievementsAdmin() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const achievementsDef = getAchievementsDef();
  const container = document.getElementById('achievements-admin-list');
  if (!container) return;

  if (achievementsDef.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg></div>
      <h3>Нет достижений</h3><p>Создайте первое достижение</p>
    </div>`;
    return;
  }

  container.innerHTML = achievementsDef.map((a, idx) => {
    const condLabel = CONDITION_LABELS[a.condition] || a.condition;
    const needLabel = a.need && a.need > 0 ? ` (${a.need})` : '';
    const tierLabel = a.tier ? `<span class="badge ${{'bronze':'badge-brown','silver':'badge-blue','gold':'badge-gold'}[a.tier]}">${{bronze:'🥉 Бронза', silver:'🥈 Серебро', gold:'🥇 Золото'}[a.tier]}</span>` : '';
    return `<div class="achievement-admin-item">
      <div class="achievement-admin-drag">
        <button class="btn-icon" onclick="moveAchievement(${idx}, -1)" title="Вверх" ${idx === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="btn-icon" onclick="moveAchievement(${idx}, 1)" title="Вниз" ${idx === achievementsDef.length - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="achievement-admin-icon">${a.icon}</div>
      <div class="achievement-admin-info">
        <div class="achievement-admin-title">${escHtml(a.title)}</div>
        <div class="achievement-admin-desc">${escHtml(a.desc)}</div>
        <div class="achievement-admin-meta">
          <span class="badge badge-gold">${condLabel}${needLabel}</span>
          ${tierLabel}
        </div>
      </div>
      <div class="achievement-admin-actions">
        <button class="btn-icon" onclick="openAchievementModal('${a.id}')" title="Редактировать">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger" onclick="confirmDeleteAchievement('${a.id}')" title="Удалить">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── Admin: Modal open/save ─────────────────────
function onAchievementConditionChange() {
  const cond = document.getElementById('achievementCondition').value;
  const needsCount = ['lessons_viewed','quizzes_passed','prompts_completed','courses_completed','favorites_count'].includes(cond);
  document.getElementById('achievementNeedGroup').style.display = needsCount ? 'block' : 'none';
}

function openAchievementModal(achId) {
  if (!achId) {
    document.getElementById('achievementModalTitle').textContent = 'Добавить достижение';
    document.getElementById('editingAchievementId').value = '';
    document.getElementById('achievementIcon').value = '🏆';
    document.getElementById('achievementTitle').value = '';
    document.getElementById('achievementDesc').value = '';
    document.getElementById('achievementCondition').value = 'first_login';
    document.getElementById('achievementNeed').value = '1';
    document.getElementById('achievementTier').value = '';
    onAchievementConditionChange();
  } else {
    const defs = getAchievementsDef();
    const a = defs.find(x => x.id === achId);
    if (!a) return;
    document.getElementById('achievementModalTitle').textContent = 'Редактировать достижение';
    document.getElementById('editingAchievementId').value = achId;
    document.getElementById('achievementIcon').value = a.icon || '🏆';
    document.getElementById('achievementTitle').value = a.title || '';
    document.getElementById('achievementDesc').value = a.desc || '';
    document.getElementById('achievementCondition').value = a.condition || 'first_login';
    document.getElementById('achievementNeed').value = a.need || 1;
    document.getElementById('achievementTier').value = a.tier || '';
    onAchievementConditionChange();
  }
  openModal('modalAchievement');
  setTimeout(() => document.getElementById('achievementTitle').focus(), 200);
}

function saveAchievement() {
  const icon  = document.getElementById('achievementIcon').value.trim();
  const title = document.getElementById('achievementTitle').value.trim();
  const desc  = document.getElementById('achievementDesc').value.trim();
  const condition = document.getElementById('achievementCondition').value;
  const need  = parseInt(document.getElementById('achievementNeed').value) || 0;
  const tier  = document.getElementById('achievementTier').value;

  if (!icon || !title || !desc) { showToast('Заполните все обязательные поля', 'error'); return; }

  const editId = document.getElementById('editingAchievementId').value;
  const defs = getAchievementsDef();

  if (editId) {
    const idx = defs.findIndex(a => a.id === editId);
    if (idx !== -1) {
      defs[idx] = { ...defs[idx], icon, title, desc, condition, need, tier };
      showToast('Достижение обновлено!', 'success');
    }
  } else {
    defs.push({ id: genId(), icon, title, desc, condition, need, tier });
    showToast('Достижение добавлено!', 'success');
  }

  saveAchievementsDef(defs);
  closeModal('modalAchievement');
  renderAchievementsAdmin();
}

function confirmDeleteAchievement(achId) {
  document.getElementById('confirmTitle').textContent = 'Удалить достижение?';
  document.getElementById('confirmMessage').textContent = 'Достижение будет удалено. У пользователей, которые его получили, оно останется в истории.';
  document.getElementById('confirmBtn').onclick = () => {
    const defs = getAchievementsDef().filter(a => a.id !== achId);
    saveAchievementsDef(defs);
    closeModal('modalConfirm');
    showToast('Достижение удалено', 'info');
    renderAchievementsAdmin();
  };
  openModal('modalConfirm');
}

function moveAchievement(idx, direction) {
  const defs = getAchievementsDef();
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= defs.length) return;
  [defs[idx], defs[newIdx]] = [defs[newIdx], defs[idx]];
  saveAchievementsDef(defs);
  renderAchievementsAdmin();
}

// --- Glossary ---------------------------------
var GLOSSARY_CATEGORIES = {
  general: { label: 'Общее', cls: 'badge-gray' },
  images: { label: 'Изображения', cls: 'badge-blue' },
  video: { label: 'Видео', cls: 'badge-brown' },
  text: { label: 'Текст', cls: 'badge-gold' },
  tools: { label: 'Инструменты', cls: 'badge-green' },
  tech: { label: 'Техническое', cls: 'badge-purple' }
};

function getGlossary() { return _cache.glossary || []; }
function saveGlossary(data) {
  _cache.glossary = data;
  api('/api/glossary', { method: 'PUT', body: data });
}

var glossaryFilter = '';
var glossaryAlpha = '';

function renderGlossary() {
  var terms = getGlossary().sort(function(a, b) { return a.term.localeCompare(b.term, 'ru'); });
  var isAdmin = currentUser && currentUser.role === 'admin';
  if (terms.length === 0 && isAdmin) { addDemoGlossary(); terms = getGlossary(); }

  var letters = [];
  terms.forEach(function(t) { var l = t.term.charAt(0).toUpperCase(); if (letters.indexOf(l) === -1) letters.push(l); });
  letters.sort(function(a, b) { return a.localeCompare(b, 'ru'); });

  var alphaBar = document.getElementById('glossaryAlphaBar');
  if (!alphaBar) return;
  alphaBar.innerHTML = '<button class="glossary-alpha-btn ' + (!glossaryAlpha ? 'active' : '') + '" onclick="setGlossaryAlpha(\'\')">\u0412\u0441\u0435</button>' +
    letters.map(function(l) { return '<button class="glossary-alpha-btn ' + (glossaryAlpha === l ? 'active' : '') + '" onclick="setGlossaryAlpha(\'' + l + '\')">' + l + '</button>'; }).join('');

  if (glossaryAlpha) terms = terms.filter(function(t) { return t.term.charAt(0).toUpperCase() === glossaryAlpha; });
  if (glossaryFilter) terms = terms.filter(function(t) {
    return t.term.toLowerCase().indexOf(glossaryFilter.toLowerCase()) !== -1 || t.definition.toLowerCase().indexOf(glossaryFilter.toLowerCase()) !== -1;
  });

  var grid = document.getElementById('glossary-grid');
  if (!grid) return;
  if (terms.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div><h3>' + (glossaryFilter || glossaryAlpha ? 'Ничего не найдено' : 'Глоссарий пуст') + '</h3><p>' + (isAdmin ? 'Добавьте первый термин' : 'Термины появятся здесь') + '</p></div>';
    return;
  }
  grid.innerHTML = terms.map(function(t) {
    var cat = GLOSSARY_CATEGORIES[t.category] || GLOSSARY_CATEGORIES.general;
    var actions = isAdmin ? '<div class="glossary-card-actions"><button class="btn-icon" onclick="openGlossaryModal(\'' + t.id + '\')" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon danger" onclick="confirmDeleteGlossaryTerm(\'' + t.id + '\')" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button></div>' : '';
    return '<div class="glossary-card">' + actions + '<div class="glossary-card-term">' + escHtml(t.term) + ' <span class="badge ' + cat.cls + '">' + cat.label + '</span></div><div class="glossary-card-def">' + escHtml(t.definition) + '</div></div>';
  }).join('');
}

function filterGlossary(q) { glossaryFilter = q; renderGlossary(); }
function setGlossaryAlpha(letter) { glossaryAlpha = letter; renderGlossary(); }

function openGlossaryModal(termId) {
  if (!termId) {
    document.getElementById('glossaryModalTitle').textContent = '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0442\u0435\u0440\u043c\u0438\u043d';
    document.getElementById('editingGlossaryId').value = '';
    document.getElementById('glossaryTerm').value = '';
    document.getElementById('glossaryDefinition').value = '';
    document.getElementById('glossaryCategory').value = 'general';
  } else {
    var terms = getGlossary();
    var t = terms.find(function(x) { return x.id === termId; });
    if (!t) return;
    document.getElementById('glossaryModalTitle').textContent = '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0442\u0435\u0440\u043c\u0438\u043d';
    document.getElementById('editingGlossaryId').value = termId;
    document.getElementById('glossaryTerm').value = t.term;
    document.getElementById('glossaryDefinition').value = t.definition;
    document.getElementById('glossaryCategory').value = t.category || 'general';
  }
  openModal('modalGlossary');
  setTimeout(function() { document.getElementById('glossaryTerm').focus(); }, 200);
}

function saveGlossaryTerm() {
  var term = document.getElementById('glossaryTerm').value.trim();
  var def = document.getElementById('glossaryDefinition').value.trim();
  if (!term || !def) { showToast('Заполните термин и определение', 'error'); return; }
  var editId = document.getElementById('editingGlossaryId').value;
  var terms = getGlossary();
  if (editId) {
    var idx = terms.findIndex(function(t) { return t.id === editId; });
    if (idx !== -1) { terms[idx].term = term; terms[idx].definition = def; terms[idx].category = document.getElementById('glossaryCategory').value; terms[idx].updatedAt = Date.now(); }
    showToast('\u0422\u0435\u0440\u043c\u0438\u043d \u043e\u0431\u043d\u043e\u0432\u043b\u0451\u043d!', 'success');
  } else {
    terms.push({ id: genId(), term: term, definition: def, category: document.getElementById('glossaryCategory').value, createdAt: Date.now(), updatedAt: Date.now() });
    showToast('\u0422\u0435\u0440\u043c\u0438\u043d \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d!', 'success');
  }
  saveGlossary(terms);
  closeModal('modalGlossary');
  renderGlossary();
}

function confirmDeleteGlossaryTerm(termId) {
  document.getElementById('confirmTitle').textContent = '\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0442\u0435\u0440\u043c\u0438\u043d?';
  document.getElementById('confirmMessage').textContent = '\u0422\u0435\u0440\u043c\u0438\u043d \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043b\u0451\u043d.';
  document.getElementById('confirmBtn').onclick = function() {
    var terms = getGlossary().filter(function(t) { return t.id !== termId; });
    saveGlossary(terms);
    closeModal('modalConfirm');
    showToast('\u0422\u0435\u0440\u043c\u0438\u043d \u0443\u0434\u0430\u043b\u0451\u043d', 'info');
    renderGlossary();
  };
  openModal('modalConfirm');
}

function addDemoGlossary() {
  if (getGlossary().length > 0) return;
  saveGlossary([
    { id: genId(), term: '\u041f\u0440\u043e\u043c\u043f\u0442', definition: '\u0422\u0435\u043a\u0441\u0442\u043e\u0432\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441 \u043a \u043d\u0435\u0439\u0440\u043e\u0441\u0435\u0442\u0438, \u043e\u043f\u0438\u0441\u044b\u0432\u0430\u044e\u0449\u0438\u0439 \u0436\u0435\u043b\u0430\u0435\u043c\u044b\u0439 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442.', category: 'general', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'Midjourney', definition: '\u041d\u0435\u0439\u0440\u043e\u0441\u0435\u0442\u044c \u0434\u043b\u044f \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u0438 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439 \u043f\u043e \u0442\u0435\u043a\u0441\u0442\u043e\u0432\u043e\u043c\u0443 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u044e. \u0420\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 Discord.', category: 'tools', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'DALL-E', definition: '\u041c\u043e\u0434\u0435\u043b\u044c \u043e\u0442 OpenAI \u0434\u043b\u044f \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439 \u043f\u043e \u0442\u0435\u043a\u0441\u0442\u0443.', category: 'tools', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'Stable Diffusion', definition: '\u041e\u0442\u043a\u0440\u044b\u0442\u0430\u044f \u043c\u043e\u0434\u0435\u043b\u044c \u0434\u043b\u044f \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u0438 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0439. \u041c\u043e\u0436\u043d\u043e \u0437\u0430\u043f\u0443\u0441\u043a\u0430\u0442\u044c \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e.', category: 'tools', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'Inpainting', definition: '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0447\u0430\u0441\u0442\u0438 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u0441 \u043f\u043e\u043c\u043e\u0449\u044c\u044e \u043d\u0435\u0439\u0440\u043e\u0441\u0435\u0442\u0438.', category: 'images', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'Outpainting', definition: '\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u0438\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u0437\u0430 \u043f\u0440\u0435\u0434\u0435\u043b\u044b \u0435\u0433\u043e \u0433\u0440\u0430\u043d\u0438\u0446.', category: 'images', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: '\u041d\u0435\u0433\u0430\u0442\u0438\u0432\u043d\u044b\u0439 \u043f\u0440\u043e\u043c\u043f\u0442', definition: '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0442\u043e\u0433\u043e, \u0447\u0435\u0433\u043e \u041d\u0415 \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u043d\u0430 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0438.', category: 'general', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'Seed', definition: '\u0427\u0438\u0441\u043b\u043e \u0434\u043b\u044f \u0432\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0438\u043c\u043e\u0441\u0442\u0438 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0430 \u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u0438.', category: 'tech', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'LoRA', definition: 'Low-Rank Adaptation \u2014 \u043c\u0435\u0442\u043e\u0434 \u0434\u043e\u043e\u0431\u0443\u0447\u0435\u043d\u0438\u044f \u043c\u043e\u0434\u0435\u043b\u0438 \u043d\u0430 \u043a\u043e\u043d\u043a\u0440\u0435\u0442\u043d\u044b\u0439 \u0441\u0442\u0438\u043b\u044c.', category: 'tech', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'Upscale', definition: '\u0423\u0432\u0435\u043b\u0438\u0447\u0435\u043d\u0438\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u044f \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u0441 \u043f\u043e\u043c\u043e\u0449\u044c\u044e \u0418\u0418.', category: 'images', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'Aspect Ratio (--ar)', definition: '\u0421\u043e\u043e\u0442\u043d\u043e\u0448\u0435\u043d\u0438\u0435 \u0441\u0442\u043e\u0440\u043e\u043d \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f: 16:9, 9:16, 1:1 \u0438 \u0434\u0440.', category: 'tech', createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), term: 'LLM', definition: 'Large Language Model \u2014 \u0431\u043e\u043b\u044c\u0448\u0430\u044f \u044f\u0437\u044b\u043a\u043e\u0432\u0430\u044f \u043c\u043e\u0434\u0435\u043b\u044c (GPT-4, Claude, Gemini).', category: 'tech', createdAt: Date.now(), updatedAt: Date.now() }
  ]);
}

// Check achievements on load
setTimeout(function() { if (currentUser) checkAndAwardAchievements(); }, 1000);

// ═══════════════════════════════════════════
// PROMPTS DATABASE
// ═══════════════════════════════════════════

function getPromptsDb() { return _cache._promptsDb || []; }
function savePromptsDb(data) {
  _cache._promptsDb = data;
  api('/api/kv/prompts_db', { method: 'PUT', body: data });
}

const PROMPT_CATEGORIES = {
  images: { label: '🎨 Изображения', cls: 'badge-gold' },
  text: { label: '✍️ Текст', cls: 'badge-blue' },
  video: { label: '🎬 Видео', cls: 'badge-purple' },
  code: { label: '💻 Код', cls: 'badge-green' },
  other: { label: '📦 Другое', cls: 'badge-gray' }
};

function renderPromptsDb() {
  const grid = document.getElementById('prompts-db-grid');
  if (!grid) return;
  const prompts = getPromptsDb();
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (prompts.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
      <h3>Промптов пока нет</h3>
      <p>${isAdmin ? 'Добавьте первый промпт' : 'Скоро здесь появятся готовые промпты'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = prompts.map(p => {
    const cat = PROMPT_CATEGORIES[p.category] || PROMPT_CATEGORIES.other;
    return `<div class="prompt-db-card">
      ${p.image ? `<img class="prompt-db-card-image" src="${p.image}" alt="Результат промпта" onerror="this.style.display='none'" />` : ''}
      <div class="prompt-db-card-body">
        <div class="prompt-db-card-text">${escapeHtml(p.text)}</div>
        <div class="prompt-db-card-meta">
          <span class="badge ${cat.cls} prompt-db-category">${cat.label}</span>
          <div class="prompt-db-actions">
            <button class="prompt-db-copy-btn" onclick="copyPromptText('${p.id}')">📋 Копировать</button>
            ${isAdmin ? `<button class="card-action-btn" onclick="editPromptDb('${p.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button class="card-action-btn danger" onclick="deletePromptDb('${p.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyPromptText(id) {
  const prompt = getPromptsDb().find(p => p.id === id);
  if (prompt) {
    navigator.clipboard.writeText(prompt.text).then(() => {
      showToast('Промпт скопирован!', 'success');
    });
  }
}

function openPromptDbModal(id) {
  const isEdit = !!id;
  document.getElementById('promptDbModalTitle').textContent = isEdit ? 'Редактировать промпт' : 'Добавить промпт';
  document.getElementById('editingPromptDbId').value = id || '';

  if (isEdit) {
    const p = getPromptsDb().find(x => x.id === id);
    if (p) {
      document.getElementById('promptDbText').value = p.text;
      document.getElementById('promptDbCategory').value = p.category || 'images';
      document.getElementById('promptDbImageUrl').value = p.image || '';
      const preview = document.getElementById('promptDbImagePreview');
      if (p.image) { preview.src = p.image; preview.style.display = 'block'; }
      else { preview.style.display = 'none'; }
    }
  } else {
    document.getElementById('promptDbText').value = '';
    document.getElementById('promptDbCategory').value = 'images';
    document.getElementById('promptDbImageUrl').value = '';
    document.getElementById('promptDbImagePreview').style.display = 'none';
  }
  document.getElementById('promptDbImageFile').value = '';
  openModal('modalPromptDb');
}

function editPromptDb(id) { openPromptDbModal(id); }

function handlePromptDbImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    document.getElementById('promptDbImageUrl').value = ev.target.result;
    const preview = document.getElementById('promptDbImagePreview');
    preview.src = ev.target.result;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function savePromptDb() {
  const text = document.getElementById('promptDbText').value.trim();
  if (!text) { showToast('Введите текст промпта', 'error'); return; }

  const id = document.getElementById('editingPromptDbId').value;
  const category = document.getElementById('promptDbCategory').value;
  const image = document.getElementById('promptDbImageUrl').value.trim();

  const prompts = getPromptsDb();
  if (id) {
    const p = prompts.find(x => x.id === id);
    if (p) { p.text = text; p.category = category; p.image = image; p.updatedAt = Date.now(); }
  } else {
    prompts.unshift({ id: genId(), text, category, image, createdAt: Date.now(), updatedAt: Date.now() });
  }
  savePromptsDb(prompts);
  closeModal('modalPromptDb');
  showToast(id ? 'Промпт обновлён' : 'Промпт добавлен', 'success');
  renderPromptsDb();
}

function deletePromptDb(id) {
  const prompts = getPromptsDb().filter(p => p.id !== id);
  savePromptsDb(prompts);
  showToast('Промпт удалён', 'info');
  renderPromptsDb();
}

// ═══════════════════════════════════════════
// TARIFFS
// ═══════════════════════════════════════════

const DEFAULT_TARIFFS = [
  { role: 'novice', name: 'Новичок', icon: '🌱', price: 'Бесплатно', oldPrice: '', benefits: ['Доступ к базовым курсам', 'Просмотр уроков'] },
  { role: 'lite', name: 'Лайт', icon: '💡', price: '', oldPrice: '', benefits: ['Всё из Новичок', 'Глоссарий терминов', 'Избранное'] },
  { role: 'standard', name: 'Стандарт', icon: '⭐', price: '', oldPrice: '', benefits: ['Всё из Лайт', 'База промптов', 'Все курсы'] },
  { role: 'pro', name: 'PRO', icon: '🚀', price: '', oldPrice: '', benefits: ['Всё из Стандарт', 'Приоритетная поддержка', 'Эксклюзивный контент'] }
];

function getTariffs() {
  const saved = _cache._tariffs;
  if (saved && Array.isArray(saved) && saved.length > 0) return saved;
  _cache._tariffs = DEFAULT_TARIFFS;
  saveTariffsData(DEFAULT_TARIFFS);
  return DEFAULT_TARIFFS;
}
function saveTariffsData(data) {
  _cache._tariffs = data;
  api('/api/kv/tariffs', { method: 'PUT', body: data });
}

function renderTariffs() {
  const grid = document.getElementById('tariffs-grid');
  if (!grid) return;
  const tariffs = getTariffs();
  const isAdmin = currentUser && currentUser.role === 'admin';

  grid.innerHTML = tariffs.map(t => {
    const isCurrent = currentUser && currentUser.role === t.role;
    const priceHtml = t.price === 'Бесплатно'
      ? '<span class="tariff-price">Бесплатно</span>'
      : (t.price
        ? `${t.oldPrice ? `<span class="tariff-old-price">${t.oldPrice}</span>` : ''}<span class="tariff-price">${t.price}</span>`
        : '<span class="tariff-price" style="font-size:1.2rem;color:var(--text-muted)">Цена не указана</span>');

    return `<div class="tariff-card${isCurrent ? ' current' : ''}">
      ${isAdmin ? `<div class="tariff-admin-edit"><button class="card-action-btn" onclick="openTariffModal('${t.role}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div>` : ''}
      <div class="tariff-card-icon">${t.icon}</div>
      <div class="tariff-card-name">${t.name}</div>
      <div class="tariff-card-pricing">${priceHtml}</div>
      <ul class="tariff-benefits">
        ${(t.benefits || []).map(b => `<li>${b}</li>`).join('')}
      </ul>
      ${!isCurrent && t.role !== 'novice' ? '<button class="tariff-card-btn" onclick="window.open(\'https://t.me/assylbekov09\',\'_blank\')">Приобрести</button>' : ''}
    </div>`;
  }).join('');
}

function openTariffModal(role) {
  const tariffs = getTariffs();
  const t = tariffs.find(x => x.role === role);
  if (!t) return;
  document.getElementById('editingTariffRole').value = role;
  document.getElementById('tariffModalTitle').textContent = 'Редактировать: ' + t.name;
  document.getElementById('tariffPrice').value = t.price === 'Бесплатно' ? '' : (t.price || '');
  document.getElementById('tariffOldPrice').value = t.oldPrice || '';
  document.getElementById('tariffBenefits').value = (t.benefits || []).join('\n');
  openModal('modalTariff');
}

function saveTariff() {
  const role = document.getElementById('editingTariffRole').value;
  const tariffs = getTariffs();
  const t = tariffs.find(x => x.role === role);
  if (!t) return;

  const price = document.getElementById('tariffPrice').value.trim();
  t.price = price || (role === 'novice' ? 'Бесплатно' : '');
  t.oldPrice = document.getElementById('tariffOldPrice').value.trim();
  t.benefits = document.getElementById('tariffBenefits').value.split('\n').map(s => s.trim()).filter(s => s);

  saveTariffsData(tariffs);
  closeModal('modalTariff');
  showToast('Тариф обновлён', 'success');
  renderTariffs();
}

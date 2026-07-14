const STATE_PREFIX = 'CAPSTONE_STATE:';
const COMPARE_KEY = 'capstone_compare_ids_v1';
const appState = readAppState();
let loadingCount = 0;
let globalBindingsReady = false;

function readAppState() {
  try {
    if (typeof window !== 'undefined' && window.name.startsWith(STATE_PREFIX)) {
      const parsed = JSON.parse(window.name.slice(STATE_PREFIX.length));
      return {
        token: parsed.token || null,
        user: parsed.user || null,
      };
    }
  } catch (error) {
    console.warn('Failed to read app state', error);
  }
  return { token: null, user: null };
}

function persistAppState() {
  if (typeof window === 'undefined') {
    return;
  }
  window.name = STATE_PREFIX + JSON.stringify({ token: appState.token, user: appState.user });
}

function loadCompareIds() {
  try {
    return JSON.parse(localStorage.getItem(COMPARE_KEY) || '[]');
  } catch (error) {
    return [];
  }
}

function saveCompareIds(ids) {
  localStorage.setItem(COMPARE_KEY, JSON.stringify([...new Set(ids)].slice(0, 4)));
}

export function getCompareIds() {
  return loadCompareIds();
}

export function setCompareIds(ids) {
  saveCompareIds(ids);
  updateCompareCount();
}

export function toggleCompareId(phoneId) {
  const ids = loadCompareIds();
  const normalized = Number(phoneId);
  const index = ids.indexOf(normalized);
  if (index >= 0) {
    ids.splice(index, 1);
    toast('Removed from compare list', 'warning');
  } else {
    if (ids.length >= 4) {
      toast('You can compare up to 4 devices', 'warning');
      return false;
    }
    ids.push(normalized);
    toast('Added to compare list', 'success');
  }
  saveCompareIds(ids);
  updateCompareCount();
  return true;
}

export function setToken(token, user) {
  appState.token = token || null;
  appState.user = user || null;
  persistAppState();
  updateNav();
}

export function clearToken() {
  appState.token = null;
  appState.user = null;
  persistAppState();
  updateNav();
}

export function getToken() {
  return appState.token;
}

export function getUser() {
  return appState.user;
}

export function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(normalized)
        .split('')
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

export function formatMoney(value) {
  const numeric = Number(value) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric);
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function toast(message, type = 'success') {
  ensureChrome();
  const stack = document.querySelector('[data-toast-stack]');
  if (!stack) {
    return;
  }
  const item = document.createElement('div');
  item.className = `toast-item ${type} animated-fade`;
  item.innerHTML = `<strong>${escapeHtml(type.toUpperCase())}</strong><div>${escapeHtml(message)}</div>`;
  stack.appendChild(item);
  window.setTimeout(() => {
    item.remove();
  }, 3200);
}

export function setLoading(active) {
  ensureChrome();
  const overlay = document.querySelector('[data-loading-overlay]');
  if (!overlay) {
    return;
  }
  loadingCount = Math.max(0, loadingCount + (active ? 1 : -1));
  overlay.classList.toggle('show', loadingCount > 0);
}

export async function apiRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (appState.token) {
    headers.set('Authorization', `Bearer ${appState.token}`);
  }
  setLoading(true);
  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || `Request failed with ${response.status}`);
    }
    return data;
  } finally {
    setLoading(false);
  }
}

export function renderPhoneCard(phone, options = {}) {
  const compareIds = new Set(loadCompareIds());
  const inCompare = compareIds.has(Number(phone.phone_id));
  const showScore = options.showScore !== false;
  return `
    <div class="phone-card h-100 animated-fade">
      <img class="phone-img" src="${escapeHtml(phone.image_url)}" alt="${escapeHtml(phone.name)}">
      <div class="p-3 d-flex flex-column gap-2">
        <div class="d-flex justify-content-between gap-2 align-items-start">
          <div>
            <h5 class="mb-1 fw-bold">${escapeHtml(phone.name)}</h5>
            <div class="phone-meta">${escapeHtml(phone.brand)} | ${phone.ram} GB RAM | ${phone.storage} GB Storage</div>
          </div>
          ${showScore ? `<span class="score-badge">${Number(phone.similarity_score || phone.performance_score || 0).toFixed(1)}</span>` : ''}
        </div>
        <div class="fw-bold fs-5 text-primary">${formatMoney(phone.price)}</div>
        <div class="phone-meta">Camera ${phone.camera} MP · Battery ${phone.battery} mAh · ${escapeHtml(phone.processor)}</div>
        <div class="d-flex gap-2 flex-wrap pt-2">
          <a class="btn btn-sm btn-primary" href="/detail.html?phone_id=${phone.phone_id}">View Details</a>
          <button class="btn btn-sm ${inCompare ? 'btn-accent' : 'btn-outline-primary'}" data-action="toggle-compare" data-phone-id="${phone.phone_id}">${inCompare ? 'Remove Compare' : 'Add to Compare'}</button>
        </div>
      </div>
    </div>
  `;
}

export function renderStars(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  return Array.from({ length: 5 }, (_, index) => (index < value ? '★' : '☆')).join('');
}

export function updateNav() {
  const navTargets = document.querySelectorAll('[data-app-nav]');
  if (!navTargets.length) {
    return;
  }
  const currentPage = document.body?.dataset?.page || '';
  const activeClass = (page) => (currentPage === page ? 'active' : '');
  const user = getUser();
  navTargets.forEach((target) => {
    // Build role-specific nav items
    const role = user?.role || 'guest';
    const commonItems = [
      `<li class="nav-item"><a class="nav-link ${activeClass('index')}" href="/index.html">Home</a></li>`,
      `<li class="nav-item"><a class="nav-link ${activeClass('search')}" href="/search.html">Search</a></li>`,
      `<li class="nav-item"><a class="nav-link ${activeClass('recommend')}" href="/recommend.html">Recommend</a></li>`,
      `<li class="nav-item"><a class="nav-link ${activeClass('trends')}" href="/trends.html">Trends</a></li>`,
      `<li class="nav-item"><a class="nav-link" href="/trend-graph.html">Price Graph</a></li>`,
    ];

    // Compare is available to logged-in users and guests (but saving requires login)
    const compareItem = `<li class="nav-item"><a class="nav-link ${activeClass('compare')}" href="/compare.html">Compare <span class="badge text-bg-light ms-1" data-compare-count>0</span></a></li>`;

    // Role specific additions
    let roleItems = '';
    if (role === 'admin') {
      roleItems = `
        <li class="nav-item"><a class="nav-link ${activeClass('admin')}" href="/admin.html">Admin Dashboard</a></li>
        <li class="nav-item"><a class="nav-link" href="/admin.html#user-management">Manage Users</a></li>
      `;
    } else if (role === 'user') {
      roleItems = `
        <li class="nav-item"><a class="nav-link" href="/compare.html">Saved</a></li>
        <li class="nav-item"><a class="nav-link" href="/recommend.html">My Recommendations</a></li>
      `;
    } else {
      // guest
      roleItems = `
        <li class="nav-item"><a class="nav-link text-muted" href="#">Explore</a></li>
      `;
    }

    const userMenu = user
      ? `<li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">${escapeHtml(user.name || 'User')} <span class="badge bg-secondary ms-1">${escapeHtml(user.role || '')}</span></a>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="/detail.html?phone_id=1">Profile</a></li>
            <li><a class="dropdown-item" href="/compare.html">Saved Comparisons</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item" type="button" data-action="logout">Logout</button></li>
          </ul>
        </li>`
      : `<li class="nav-item"><a class="nav-link ${activeClass('login')}" href="/login.html">Login</a></li>
         <li class="nav-item"><a class="btn btn-sm btn-primary ms-lg-2" href="/register.html">Register</a></li>`;

    target.innerHTML = `
      <nav class="navbar navbar-expand-lg navbar-light sticky-top">
        <div class="container py-2">
          <a class="navbar-brand fw-bold" href="/index.html">DecisionPhone</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav" aria-controls="mainNav" aria-expanded="false" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="mainNav">
            <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-1">
              ${commonItems.join('')}
              ${compareItem}
              ${roleItems}
              ${userMenu}
            </ul>
          </div>
        </div>
      </nav>
    `;
  });
  updateCompareCount();
}

export function updateFooter() {
  const footerTargets = document.querySelectorAll('[data-app-footer]');
  if (!footerTargets.length) {
    return;
  }
  const year = new Date().getFullYear();
  footerTargets.forEach((target) => {
    target.innerHTML = `
      <footer class="container py-4">
        <div class="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2 border-top pt-3">
          <div>DecisionPhone ${year}</div>
          <div>Integrated decision support and market analysis for mobile device selection.</div>
        </div>
      </footer>
    `;
  });
}

export function ensureChrome() {
  if (!document.querySelector('[data-toast-stack]')) {
    const stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('data-toast-stack', 'true');
    document.body.appendChild(stack);
  }
  if (!document.querySelector('[data-loading-overlay]')) {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.setAttribute('data-loading-overlay', 'true');
    overlay.innerHTML = '<div class="loading-card d-flex align-items-center gap-3"><div class="spinner-border text-primary" role="status" aria-hidden="true"></div><div class="fw-semibold">Loading data...</div></div>';
    document.body.appendChild(overlay);
  }
}

export function updateCompareCount() {
  const badges = document.querySelectorAll('[data-compare-count]');
  const count = loadCompareIds().length;
  badges.forEach((badge) => {
    badge.textContent = String(count);
  });
}

export function bindGlobalActions() {
  if (globalBindingsReady) {
    return;
  }
  globalBindingsReady = true;

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-action="toggle-compare"]');
    if (toggle) {
      event.preventDefault();
      const phoneId = Number(toggle.getAttribute('data-phone-id'));
      const changed = toggleCompareId(phoneId);
      if (changed) {
        toggle.textContent = loadCompareIds().includes(phoneId) ? 'Remove Compare' : 'Add to Compare';
        toggle.classList.toggle('btn-accent');
        toggle.classList.toggle('btn-outline-primary');
        document.dispatchEvent(new CustomEvent('compare:changed'));
      }
      return;
    }

    const logout = event.target.closest('[data-action="logout"]');
    if (logout) {
      event.preventDefault();
      clearToken();
      toast('Logged out successfully', 'success');
      window.location.href = data.redirect_to || (data.role === 'admin' ? '/admin.html' : '/index.html');
    }
  });
}

export async function validateSession() {
  if (!appState.token) {
    updateNav();
    return;
  }
  try {
    const decoded = decodeJwt(appState.token);
    if (decoded && !appState.user) {
      appState.user = { name: decoded.name || 'User', role: decoded.role || 'user', email: decoded.email || '' };
      persistAppState();
    }
    await apiRequest('/user/data');
    if (!appState.user && decoded) {
      appState.user = { name: decoded.name || 'User', role: decoded.role || 'user', email: decoded.email || '' };
      persistAppState();
    }
  } catch (error) {
    clearToken();
    toast('Session expired. Please log in again.', 'warning');
  }
  updateNav();
}

async function initIndexPage() {
  const featured = document.querySelector('[data-featured-phones]');
  const searchInput = document.querySelector('[data-quick-search]');
  const searchButton = document.querySelector('[data-quick-search-btn]');
  if (!featured) {
    return;
  }
  const phones = await apiRequest('/phones');
  const renderCards = (items) => {
    featured.innerHTML = items.map((phone) => renderPhoneCard(phone)).join('');
  };
  renderCards(phones.slice(0, 6));
  if (searchButton && searchInput) {
    searchButton.addEventListener('click', () => {
      const term = searchInput.value.trim();
      const query = term ? `?q=${encodeURIComponent(term)}` : '';
      window.location.href = `/search.html${query}`;
    });
  }
}

async function initRecommendPage() {
  const form = document.querySelector('[data-recommend-form]');
  const results = document.querySelector('[data-recommend-results]');
  if (!form || !results) {
    return;
  }
  const cameraSlider = form.querySelector('[data-slider="camera"]');
  const performanceSlider = form.querySelector('[data-slider="performance"]');
  const cameraValue = form.querySelector('[data-camera-value]');
  const performanceValue = form.querySelector('[data-performance-value]');

  cameraSlider?.addEventListener('input', () => {
    cameraValue.textContent = cameraSlider.value;
  });
  performanceSlider?.addEventListener('input', () => {
    performanceValue.textContent = performanceSlider.value;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.budget = Number(payload.budget);
    payload.min_ram = Number(payload.min_ram);
    payload.min_storage = Number(payload.min_storage);
    payload.min_battery = Number(payload.min_battery);
    payload.camera_priority = Number(payload.camera_priority);
    payload.performance_priority = Number(payload.performance_priority);
    try {
      const items = await apiRequest('/recommend', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      results.innerHTML = items.length ? items.map((phone) => renderPhoneCard(phone, { showScore: true })).join('') : '<div class="alert alert-info">No matching devices found.</div>';
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function initComparePage() {
  const list = document.querySelector('[data-compare-list]');
  const tableWrap = document.querySelector('[data-compare-table-wrap]');
  const savedWrap = document.querySelector('[data-saved-comparisons]');
  const saveButton = document.querySelector('[data-save-comparison]');
  if (!list || !tableWrap || !savedWrap || !saveButton) {
    return;
  }

  const phones = await apiRequest('/phones');

  const renderSavedComparisons = async () => {
    if (!getToken()) {
      savedWrap.innerHTML = '<div class="alert alert-info">Log in to view saved comparisons.</div>';
      return;
    }
    try {
      const saved = await apiRequest('/user/comparisons');
      savedWrap.innerHTML = saved.length
        ? saved.map((entry) => `<div class="col-md-6"><div class="compare-card p-3"><strong>Comparison #${entry.comparison_id}</strong><div class="text-muted small">${entry.phone_ids.join(', ')}</div><div class="small">Saved ${escapeHtml(entry.saved_at || '')}</div></div></div>`).join('')
        : '<div class="col-12 text-muted">No saved comparisons yet.</div>';
    } catch (error) {
      savedWrap.innerHTML = `<div class="col-12 alert alert-warning mb-0">${escapeHtml(error.message)}</div>`;
    }
  };

  const render = async () => {
    const compareIds = getCompareIds();
    const selected = phones.filter((phone) => compareIds.includes(Number(phone.phone_id)));
    list.innerHTML = selected.length
      ? selected.map((phone) => `
        <tr>
          <td>${escapeHtml(phone.name)} <span class="text-muted">(${escapeHtml(phone.brand)})</span></td>
          <td><button class="btn btn-sm btn-outline-danger" data-action="toggle-compare" data-phone-id="${phone.phone_id}">Remove</button></td>
        </tr>
      `).join('')
      : '<tr><td colspan="2" class="text-muted">No devices selected.</td></tr>';

    if (!selected.length) {
      tableWrap.innerHTML = '<div class="alert alert-info mb-0">Add up to four devices to see comparison data.</div>';
    } else {
      const metrics = [
        ['Brand', 'brand'],
        ['Price', 'price'],
        ['RAM', 'ram'],
        ['Storage', 'storage'],
        ['Camera', 'camera'],
        ['Battery', 'battery'],
        ['Processor', 'processor'],
        ['Performance Score', 'performance_score'],
      ];
      tableWrap.innerHTML = `
        <table class="table mb-0 align-middle">
          <thead class="table-light"><tr><th>Spec</th>${selected.map((phone) => `<th>${escapeHtml(phone.name)}</th>`).join('')}</tr></thead>
          <tbody>
            ${metrics.map(([label, key]) => {
              const values = selected.map((phone) => phone[key]);
              const numeric = values.every((value) => !Number.isNaN(Number(value)));
              const max = numeric ? Math.max(...values.map(Number)) : null;
              const min = numeric ? Math.min(...values.map(Number)) : null;
              return `<tr><th>${label}</th>${selected.map((phone) => {
                const value = phone[key];
                let className = '';
                if (numeric) {
                  if (Number(value) === max) {
                    className = 'best-value';
                  } else if (Number(value) === min) {
                    className = 'worst-value';
                  }
                }
                return `<td class="${className}">${key === 'price' ? formatMoney(value) : escapeHtml(value)}</td>`;
              }).join('')}</tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
    }
  };

  document.addEventListener('compare:changed', render);

  saveButton.addEventListener('click', async () => {
    if (!getToken()) {
      toast('Please log in to save comparisons', 'warning');
      window.location.href = '/login.html';
      return;
    }
    try {
      await apiRequest('/user/comparisons', {
        method: 'POST',
        body: JSON.stringify({ phone_ids: getCompareIds() }),
      });
      toast('Comparison saved', 'success');
      await renderSavedComparisons();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  await render();
  await renderSavedComparisons();
}

async function initTrendsPage() {
  const select = document.querySelector('[data-trend-device]');
  const summary = document.querySelector('[data-trend-summary]');
  const insight = document.querySelector('[data-trend-insight]');
  if (!select || !summary || !insight) {
    return;
  }
  const phones = await apiRequest('/phones');
  select.innerHTML = phones.map((phone) => `<option value="${phone.phone_id}">${escapeHtml(phone.name)}</option>`).join('');

  const renderTrend = async () => {
    console.debug('initTrendsPage: renderTrend start', { selectValue: select?.value });
    const phoneId = select.value;
    let data;
    try {
      data = await apiRequest(`/trend?phone_id=${phoneId}`);
      console.debug('trend data loaded', data);
    } catch (err) {
      console.error('Failed to load trend data', err);
      const shell = document.querySelector('.chart-shell');
      if (shell) shell.innerHTML = `<div class="p-4 text-danger">Failed to load trend data. Check console for details.</div>`;
      toast('Could not load trend data. See console.', 'error');
      return;
    }
    summary.innerHTML = `
      <div class="col-md-4"><div class="page-card p-3"><div class="text-muted">Current Price</div><div class="h4 fw-bold mb-0">${formatMoney(data.current_price)}</div></div></div>
      <div class="col-md-4"><div class="page-card p-3"><div class="text-muted">Lowest Recorded</div><div class="h4 fw-bold mb-0">${formatMoney(data.lowest_recorded)}</div></div></div>
      <div class="col-md-4"><div class="page-card p-3"><div class="text-muted">Predicted in 6 Months</div><div class="h4 fw-bold mb-0">${formatMoney(data.predicted_in_6_months)}</div></div></div>
    `;
    insight.textContent = data.insight;

    // populate analysis panel if present
    const analysis = document.querySelector('[data-trend-analysis]');
    if (analysis) {
      // compute quick stats
      const hist = data.historical_prices || [];
      const pred = data.predicted_prices || [];
      const latest = hist.length ? hist[hist.length - 1] : data.current_price;
      const predicted = pred.length ? pred[pred.length - 1] : data.predicted_in_6_months;
      const minVal = hist.length ? Math.min(...hist) : data.lowest_recorded;
      const maxVal = hist.length ? Math.max(...hist) : latest;
      const volatility = (maxVal - minVal).toFixed(2);
      const pctChange = latest ? (((predicted - latest) / latest) * 100).toFixed(1) : '0.0';
      const direction = Number(predicted) > Number(latest) ? 'Rising' : 'Softening';
      const recommendation = Number(pctChange) >= 5 ? 'Consider waiting for price to soften' : Number(pctChange) <= -5 ? 'Good time to buy' : 'Hold — small change expected';
      analysis.innerHTML = `
        <div class="label">Quick Analysis</div>
        <div><span class="small text-muted">Trend</span> <div class="value">${direction} (${pctChange}% over 6m)</div></div>
        <div class="mt-2"><span class="small text-muted">Volatility</span> <div class="value">$${Number(volatility).toLocaleString()}</div></div>
        <div class="mt-2"><span class="small text-muted">Recommendation</span><div class="text-muted">${escapeHtml(recommendation)}</div></div>
      `;
    }

    const canvas = document.getElementById('trendChart');
    if (typeof Chart === 'undefined') {
      console.error('Chart.js is not available on the page.');
      const shell = document.querySelector('.chart-shell');
      if (shell) shell.innerHTML = `<div class="p-4 text-danger">Chart.js not loaded — chart cannot be rendered.</div>`;
      toast('Chart library missing. See console.', 'error');
      return;
    }

    if (!canvas) {
      console.error('Trend canvas element not found.');
      const shell = document.querySelector('.chart-shell');
      if (shell) shell.innerHTML = `<div class="p-4 text-danger">Chart canvas missing in DOM.</div>`;
      return;
    }

    if (canvas && typeof Chart !== 'undefined') {
      // ensure canvas fills the parent chart shell
      try {
        const parentShell = canvas.closest('.chart-shell');
        if (parentShell) {
          parentShell.style.minHeight = parentShell.style.minHeight || '280px';
        }
        canvas.style.width = '100%';
        canvas.style.height = canvas.style.height || '100%';
        canvas.style.maxHeight = '520px';
      } catch (e) {}
      const labels = [...data.historical_labels, ...data.predicted_labels];
      const historySeries = [...data.historical_prices, ...Array(data.predicted_prices.length).fill(null)];
      const futureSeries = [...Array(data.historical_prices.length).fill(null), ...data.predicted_prices];
      if (window.__trendChart && typeof window.__trendChart.destroy === 'function') {
        try { window.__trendChart.destroy(); } catch (e) { console.warn('Error destroying trendChart', e); }
        window.__trendChart = null;
      }
      // compute fixed y-axis bounds from available numeric series with a small padding
      const allValues = [...data.historical_prices, ...data.predicted_prices].filter((v) => v != null && !Number.isNaN(Number(v)));
      let yMin = 0;
      let yMax = 100;
      if (allValues.length) {
        const minVal = Math.min(...allValues);
        const maxVal = Math.max(...allValues);
        const pad = Math.max(5, (maxVal - minVal) * 0.1);
        yMin = Math.max(0, Math.floor(minVal - pad));
        yMax = Math.ceil(maxVal + pad);
      }
      try {
        window.trendChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Historical Prices', data: historySeries, borderColor: '#0f766e', backgroundColor: function(context){ const c = context.chart.canvas; const ctx = context.chart.ctx; const rect = c.getBoundingClientRect(); const g = ctx.createLinearGradient(0,0,0,rect.height||360); g.addColorStop(0, 'rgba(15,118,110,0.16)'); g.addColorStop(1, 'rgba(15,118,110,0.02)'); return g; }, tension: 0.35, pointRadius: 3, borderWidth: 2, fill: true, spanGaps: true },
            { label: 'Predicted Prices', data: futureSeries, borderColor: '#f97316', backgroundColor: function(context){ const c = context.chart.canvas; const ctx = context.chart.ctx; const rect = c.getBoundingClientRect(); const g = ctx.createLinearGradient(0,0,0,rect.height||360); g.addColorStop(0, 'rgba(249,115,22,0.14)'); g.addColorStop(1, 'rgba(249,115,22,0.03)'); return g; }, borderDash: [8, 6], tension: 0.35, pointRadius: 3, borderWidth: 2, fill: true, spanGaps: true },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top' },
            tooltip: { mode: 'index', intersect: false }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { autoSkip: true, maxTicksLimit: 8 },
            },
            y: {
              min: yMin,
              max: yMax,
              grid: { color: '#eee' },
              ticks: { callback: (value) => formatMoney(value) },
            },
          },
        },
        });
        console.debug('initTrendsPage: chart created', window.__trendChart);
      } catch (chartErr) {
        console.error('Chart creation failed', chartErr);
        const shell = document.querySelector('.chart-shell');
        if (shell) {
          shell.insertAdjacentHTML('beforeend', `<div class="p-3 text-danger">Chart creation error — see console.</div>`);
        }
        toast('Chart rendering failed. See console.', 'error');
      }
    }

    // If chart wasn't created, show raw data for debugging
    if (!window.__trendChart) {
      const shell = document.querySelector('.chart-shell');
      if (shell) {
        const dump = `Historical: ${escapeHtml(JSON.stringify(data.historical_prices || []))} \nPredicted: ${escapeHtml(JSON.stringify(data.predicted_prices || []))}`;
        shell.insertAdjacentHTML('beforeend', `<pre class="p-3 small text-muted">${dump}</pre>`);
      }
    }
  };

  select.addEventListener('change', renderTrend);
  await renderTrend();
}

async function initSearchPage() {
  const results = document.querySelector('[data-search-results]');
  if (!results) {
    return;
  }
  const phones = await apiRequest('/phones');
  const controls = {
    brand: document.querySelector('[data-filter-brand]'),
    maxPrice: document.querySelector('[data-filter-price]'),
    ram: document.querySelector('[data-filter-ram]'),
    storage: document.querySelector('[data-filter-storage]'),
    battery: document.querySelector('[data-filter-battery]'),
    camera: document.querySelector('[data-filter-camera]'),
    query: document.querySelector('[data-filter-query]'),
  };
  const loadMore = document.querySelector('[data-load-more]');
  let visibleCount = 8;

  const applyFilters = () => {
    const brand = controls.brand?.value || '';
    const maxPrice = Number(controls.maxPrice?.value || 99999);
    const ram = Number(controls.ram?.value || 0);
    const storage = Number(controls.storage?.value || 0);
    const battery = Number(controls.battery?.value || 0);
    const camera = Number(controls.camera?.value || 0);
    const query = (controls.query?.value || '').toLowerCase();

    const filtered = phones.filter((phone) => {
      return (
        (!brand || phone.brand === brand) &&
        phone.price <= maxPrice &&
        phone.ram >= ram &&
        phone.storage >= storage &&
        phone.battery >= battery &&
        phone.camera >= camera &&
        (!query || `${phone.brand} ${phone.name} ${phone.processor}`.toLowerCase().includes(query))
      );
    });

    const items = filtered.slice(0, visibleCount);
    results.innerHTML = items.length ? items.map((phone) => renderPhoneCard(phone)).join('') : '<div class="col-12"><div class="alert alert-info">No Results Found</div></div>';
    if (loadMore) {
      loadMore.classList.toggle('d-none', filtered.length <= visibleCount);
      loadMore.onclick = () => {
        visibleCount += 8;
        applyFilters();
      };
    }
  };

  Object.values(controls).forEach((control) => control?.addEventListener('input', () => {
    visibleCount = 8;
    applyFilters();
  }));

  applyFilters();
}

async function initLoginPage() {
  const form = document.querySelector('[data-login-form]');
  if (!form) {
    return;
  }
  const guestButton = document.querySelector('[data-guest-view]');
  guestButton?.addEventListener('click', () => {
    clearToken();
    toast('Browsing as guest', 'success');
    window.location.href = '/index.html';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token, { name: data.name, role: data.role, email });
      toast('Welcome back', 'success');
      window.location.href = '/index.html';
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function initRegisterPage() {
  const form = document.querySelector('[data-register-form]');
  if (!form) {
    return;
  }
  const guestButton = document.querySelector('[data-guest-view]');
  guestButton?.addEventListener('click', () => {
    clearToken();
    toast('Browsing as guest', 'success');
    window.location.href = '/index.html';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const confirmPassword = form.querySelector('[name="confirm_password"]').value;
    if (!name || !email || password.length < 6) {
      toast('Please complete all fields with a password of at least 6 characters', 'warning');
      return;
    }
    if (password !== confirmPassword) {
      toast('Passwords do not match', 'warning');
      return;
    }
    try {
      await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      toast('Registration successful. Please log in.', 'success');
      window.location.href = '/login.html';
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function initDetailPage() {
  const target = document.querySelector('[data-phone-detail]');
  if (!target) {
    return;
  }
  const phoneId = getQueryParam('phone_id');
  if (!phoneId) {
    target.innerHTML = '<div class="alert alert-warning">Missing phone_id parameter</div>';
    return;
  }
  const phone = await apiRequest(`/phone/${phoneId}`);
  target.innerHTML = `
    <div class="row g-4">
      <div class="col-lg-5">
        <div class="page-card p-3 h-100">
          <img src="${escapeHtml(phone.image_url)}" alt="${escapeHtml(phone.name)}" class="img-fluid rounded-4 mb-3">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h2 class="h3 fw-bold mb-0">${escapeHtml(phone.name)}</h2>
            <button class="btn btn-accent" data-action="toggle-compare" data-phone-id="${phone.phone_id}">Add to Compare</button>
          </div>
          <div class="text-muted">${escapeHtml(phone.brand)}</div>
          <div class="fw-bold fs-3 text-primary my-2">${formatMoney(phone.price)}</div>
          <ul class="list-unstyled mb-0">
            <li class="mb-2"><span class="metric-badge">RAM</span> ${phone.ram} GB</li>
            <li class="mb-2"><span class="metric-badge">Storage</span> ${phone.storage} GB</li>
            <li class="mb-2"><span class="metric-badge">Camera</span> ${phone.camera} MP</li>
            <li class="mb-2"><span class="metric-badge">Battery</span> ${phone.battery} mAh</li>
            <li class="mb-2"><span class="metric-badge">Processor</span> ${escapeHtml(phone.processor)}</li>
            <li><span class="metric-badge">Performance</span> ${phone.performance_score}/10</li>
          </ul>
        </div>
      </div>
      <div class="col-lg-7">
        <div class="page-card p-3 mb-4">
          <h3 class="h5 fw-bold">Pros and Cons</h3>
          <div class="row g-3 mt-1">
            <div class="col-md-6"><div class="alert alert-success mb-0"><strong>Pros</strong><ul class="mb-0">${phone.pros.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></div>
            <div class="col-md-6"><div class="alert alert-warning mb-0"><strong>Cons</strong><ul class="mb-0">${phone.cons.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></div>
          </div>
        </div>
        <div class="page-card p-3 mb-4">
          <h3 class="h5 fw-bold">Price Trend</h3>
          <canvas id="detailTrendChart" height="130"></canvas>
        </div>
        <div class="page-card p-3 mb-4">
          <h3 class="h5 fw-bold">User Reviews</h3>
          <div class="mb-3" data-review-list></div>
          <form data-review-form class="row g-2">
            <div class="col-md-2"><input class="form-control" type="number" min="1" max="5" name="rating" placeholder="Rating"></div>
            <div class="col-md-8"><input class="form-control" type="text" name="comment" placeholder="Write a review"></div>
            <div class="col-md-2 d-grid"><button class="btn btn-primary">Submit</button></div>
          </form>
        </div>
      </div>
    </div>
  `;
  await renderDetailReviews(phone.phone_id);
  await renderDetailTrend(phone.phone_id);
  const form = target.querySelector('[data-review-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!getToken()) {
      toast('Please log in to submit a review', 'warning');
      window.location.href = '/login.html';
      return;
    }
    const rating = Number(form.querySelector('[name="rating"]').value);
    const comment = form.querySelector('[name="comment"]').value.trim();
    try {
      await apiRequest('/reviews', {
        method: 'POST',
        body: JSON.stringify({ phone_id: phone.phone_id, rating, comment }),
      });
      toast('Review submitted', 'success');
      form.reset();
      await renderDetailReviews(phone.phone_id);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function renderDetailReviews(phoneId) {
  const list = document.querySelector('[data-review-list]');
  if (!list) {
    return;
  }
  const reviews = await apiRequest(`/reviews/${phoneId}`);
  list.innerHTML = reviews.length
    ? reviews.map((review) => `
        <div class="border rounded-4 p-3 mb-2 bg-white">
          <div class="d-flex justify-content-between"><strong>${escapeHtml(review.user_name || 'User')}</strong><span>${renderStars(review.rating)}</span></div>
          <div class="text-muted small mb-1">${escapeHtml(review.created_at || '')}</div>
          <div>${escapeHtml(review.comment)}</div>
        </div>
      `).join('')
    : '<div class="text-muted">No reviews yet.</div>';
}

async function renderDetailTrend(phoneId) {
  const response = await apiRequest(`/trend?phone_id=${phoneId}`);
  const canvas = document.getElementById('detailTrendChart');
  if (!canvas || typeof Chart === 'undefined') {
    return;
  }
  // Constrain the chart container to prevent uncontrolled growth
  try {
    const parent = canvas.parentElement;
    if (parent) {
      parent.style.height = parent.style.height || '220px';
      parent.style.maxHeight = '360px';
    }
    canvas.style.height = canvas.style.height || '180px';
    canvas.style.maxHeight = '360px';
  } catch (e) {
    // ignore styling errors
  }
  const labels = [...response.historical_labels, ...response.predicted_labels];
  const historical = [...response.historical_prices, ...Array(response.predicted_prices.length).fill(null)];
  const future = [...Array(response.historical_prices.length).fill(null), ...response.predicted_prices];
  if (window.__detailChart && typeof window.__detailChart.destroy === 'function') {
    try { window.__detailChart.destroy(); } catch (e) { console.warn('Error destroying detailChart', e); }
    window.__detailChart = null;
  }
  // fixed y-axis bounds for detail chart with padding
  const detailAll = [...response.historical_prices, ...response.predicted_prices].filter((v) => v != null && !Number.isNaN(Number(v)));
  let dMin = 0;
  let dMax = 100;
  if (detailAll.length) {
    const minV = Math.min(...detailAll);
    const maxV = Math.max(...detailAll);
    const pad = Math.max(5, (maxV - minV) * 0.1);
    dMin = Math.max(0, Math.floor(minV - pad));
    dMax = Math.ceil(maxV + pad);
  }
  if (window.__detailChart && typeof window.__detailChart.destroy === 'function') {
    try { window.__detailChart.destroy(); } catch (e) { console.warn('Error destroying detailChart', e); }
    window.__detailChart = null;
  }
  window.__detailChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Historical', data: historical, borderColor: '#0f766e', backgroundColor: 'rgba(15,118,110,0.12)', tension: 0.35, pointRadius: 3, borderWidth: 2, spanGaps: true },
        { label: 'Predicted', data: future, borderColor: '#f97316', borderDash: [8, 6], tension: 0.35, pointRadius: 3, borderWidth: 2, spanGaps: true },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 8 } },
        y: { min: dMin, max: dMax, grid: { color: '#eee' }, ticks: { callback: (value) => formatMoney(value) } },
      },
    },
  });
}

async function initAdminPage() {
  const panel = document.querySelector('[data-admin-panel]');
  if (!panel) {
    return;
  }
  const user = getUser();
  if (!user || user.role !== 'admin') {
    panel.innerHTML = '<div class="alert alert-danger">Admin access required.</div>';
    return;
  }
  const [phones, users] = await Promise.all([apiRequest('/phones'), apiRequest('/admin/users')]);
  const phoneTable = document.querySelector('[data-admin-phone-table]');
  const userTable = document.querySelector('[data-admin-user-table]');
  if (phoneTable) {
    phoneTable.innerHTML = phones.map((phone) => `
      <tr>
        <td>${phone.phone_id}</td>
        <td>${escapeHtml(phone.brand)}</td>
        <td>${escapeHtml(phone.name)}</td>
        <td>${formatMoney(phone.price)}</td>
        <td>${phone.ram} GB</td>
        <td>${phone.storage} GB</td>
        <td>
          <button class="btn btn-sm btn-outline-primary me-1" data-admin-edit-phone='${escapeHtml(JSON.stringify(phone))}'>Edit</button>
          <button class="btn btn-sm btn-outline-danger" data-admin-delete-phone="${phone.phone_id}">Delete</button>
        </td>
      </tr>
    `).join('');
  }
  if (userTable) {
    userTable.innerHTML = users.map((item) => `<tr><td>${item.user_id}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(item.role)}</td></tr>`).join('');
  }
  const form = document.querySelector('[data-admin-phone-form]');
  const resetForm = () => form?.reset();
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      payload.price = Number(payload.price);
      payload.ram = Number(payload.ram);
      payload.storage = Number(payload.storage);
      payload.camera = Number(payload.camera);
      payload.battery = Number(payload.battery);
      payload.performance_score = Number(payload.performance_score);
      const phoneId = payload.phone_id;
      try {
        if (phoneId) {
          await apiRequest(`/admin/devices/${phoneId}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await apiRequest('/admin/devices', { method: 'POST', body: JSON.stringify(payload) });
        }
        toast('Device saved', 'success');
        await initAdminPage();
        resetForm();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  document.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-admin-delete-phone]');
    if (deleteButton) {
      const phoneId = deleteButton.getAttribute('data-admin-delete-phone');
      try {
        await apiRequest(`/admin/devices/${phoneId}`, { method: 'DELETE' });
        toast('Phone deleted', 'success');
        await initAdminPage();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    const editButton = event.target.closest('[data-admin-edit-phone]');
    if (editButton && form) {
      const phone = JSON.parse(editButton.getAttribute('data-admin-edit-phone'));
      for (const [key, value] of Object.entries(phone)) {
        const field = form.querySelector(`[name="${key}"]`);
        if (field) {
          field.value = value;
        }
      }
    }
    const syncButton = event.target.closest('[data-sync-json]');
    if (syncButton) {
      try {
        await apiRequest('/sync-json', { method: 'POST', body: JSON.stringify({}) });
        toast('JSON data synchronized', 'success');
        await initAdminPage();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  }, { once: true });
}

function renderPageChrome() {
  ensureChrome();
  updateNav();
  updateFooter();
  bindGlobalActions();
}

export async function initCurrentPage() {
  renderPageChrome();
  await validateSession();
  const page = document.body?.dataset?.page;
  if (page === 'index') {
    await initIndexPage();
  } else if (page === 'search') {
    await initSearchPage();
  } else if (page === 'recommend') {
    await initRecommendPage();
  } else if (page === 'compare') {
    await initComparePage();
  } else if (page === 'trends') {
    await initTrendsPage();
  } else if (page === 'login') {
    await initLoginPage();
  } else if (page === 'register') {
    await initRegisterPage();
  } else if (page === 'detail') {
    await initDetailPage();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initCurrentPage();
});

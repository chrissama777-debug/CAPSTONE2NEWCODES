import { apiRequest, escapeHtml, formatMoney, getToken, getUser, setToken, toast } from './main.js';

const state = {
  dashboard: null,
  phones: [],
  brands: [],
  users: [],
  orders: [],
  reviews: [],
  notifications: [],
  profile: null,
  mobileSearch: '',
  mobileBrand: 'all',
  mobilePrice: 'all',
  mobileSort: 'recent',
  mobilePage: 1,
  mobilePerPage: 5,
  brandSearch: '',
  brandPage: 1,
  brandPerPage: 5,
};

const ORDER_STATUSES = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
const PAYMENT_STATUSES = ['Pending', 'Paid', 'Refunded'];

function qs(selector) {
  return document.querySelector(selector);
}

function asString(value) {
  return value == null ? '' : String(value);
}

function escapeDataAttr(value) {
  return escapeHtml(JSON.stringify(value));
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderEmpty(target, message) {
  target.innerHTML = `<tr><td colspan="12"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
}

function renderList(target, items, renderer, emptyMessage) {
  if (!target) {
    return;
  }
  if (!items.length) {
    target.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  target.innerHTML = items.map(renderer).join('');
}

function getMobileFilteredItems() {
  let items = [...state.phones];
  const query = state.mobileSearch.trim().toLowerCase();
  if (query) {
    items = items.filter((phone) => `${phone.brand} ${phone.name} ${phone.processor}`.toLowerCase().includes(query));
  }
  if (state.mobileBrand !== 'all') {
    items = items.filter((phone) => phone.brand === state.mobileBrand);
  }
  if (state.mobilePrice !== 'all') {
    items = items.filter((phone) => {
      const price = Number(phone.price || 0);
      if (state.mobilePrice === '900+') {
        return price >= 900;
      }
      const [minValue, maxValue] = state.mobilePrice.split('-');
      return price >= Number(minValue) && price < Number(maxValue);
    });
  }
  switch (state.mobileSort) {
    case 'name':
      items.sort((left, right) => left.name.localeCompare(right.name));
      break;
    case 'price-asc':
      items.sort((left, right) => Number(left.price || 0) - Number(right.price || 0));
      break;
    case 'price-desc':
      items.sort((left, right) => Number(right.price || 0) - Number(left.price || 0));
      break;
    case 'stock-asc':
      items.sort((left, right) => Number(left.stock_quantity || 0) - Number(right.stock_quantity || 0));
      break;
    case 'views-desc':
      items.sort((left, right) => Number(right.view_count || 0) - Number(left.view_count || 0));
      break;
    case 'purchases-desc':
      items.sort((left, right) => Number(right.purchase_count || 0) - Number(left.purchase_count || 0));
      break;
    default:
      items.sort((left, right) => Number(right.phone_id || 0) - Number(left.phone_id || 0));
      break;
  }
  return items;
}

async function readFileAsDataUrl(file) {
  if (!file) {
    return '';
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(asString(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function setPreview(targetId, value, altText) {
  const preview = qs(targetId);
  if (!preview) {
    return;
  }
  preview.innerHTML = value ? `<img src="${escapeHtml(value)}" alt="${escapeHtml(altText)}">` : 'No image selected';
}

function refreshBrandOptions() {
  const filter = qs('#mobileBrandFilter');
  const datalist = qs('#brandSuggestions');
  if (filter) {
    filter.innerHTML = ['<option value="all">All brands</option>', ...state.brands.map((brand) => `<option value="${escapeHtml(brand.name)}">${escapeHtml(brand.name)}</option>`)].join('');
    filter.value = state.mobileBrand;
  }
  if (datalist) {
    datalist.innerHTML = state.brands.map((brand) => `<option value="${escapeHtml(brand.name)}"></option>`).join('');
  }
}

function renderDashboardCards() {
  const target = qs('#statsCards');
  if (!target || !state.dashboard) {
    return;
  }
  const stats = state.dashboard.stats || {};
  const cards = [
    ['Total Mobiles', stats.total_mobiles || 0, 'fa-mobile-screen'],
    ['Total Brands', stats.total_brands || 0, 'fa-copyright'],
    ['Total Users', stats.total_users || 0, 'fa-users'],
    ['Total Orders', stats.total_orders || 0, 'fa-bag-shopping'],
    ['Total Reviews', stats.total_reviews || 0, 'fa-star'],
  ];
  target.innerHTML = cards.map(([label, value, icon]) => `
    <div class="stat-card">
      <div class="stat-icon"><i class="fa-solid ${icon}"></i></div>
      <div>
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(asString(value))}</div>
      </div>
    </div>
  `).join('');
}

function renderCharts() {
  if (!state.dashboard || typeof Chart === 'undefined') {
    return;
  }
  const salesCanvas = document.getElementById('salesChart');
  const usersCanvas = document.getElementById('usersChart');
  const salesSeries = state.dashboard.monthly_sales || [];
  const userSeries = state.dashboard.monthly_user_registrations || [];
  if (window.__adminSalesChart && typeof window.__adminSalesChart.destroy === 'function') {
    window.__adminSalesChart.destroy();
  }
  if (window.__adminUsersChart && typeof window.__adminUsersChart.destroy === 'function') {
    window.__adminUsersChart.destroy();
  }
  if (salesCanvas) {
    window.__adminSalesChart = new Chart(salesCanvas, {
      type: 'line',
      data: {
        labels: salesSeries.map((item) => item.label),
        datasets: [{
          label: 'Sales',
          data: salesSeries.map((item) => item.value),
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15,118,110,0.16)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(15,23,42,0.06)' } },
        },
      },
    });
  }
  if (usersCanvas) {
    window.__adminUsersChart = new Chart(usersCanvas, {
      type: 'bar',
      data: {
        labels: userSeries.map((item) => item.label),
        datasets: [{
          label: 'Users',
          data: userSeries.map((item) => item.value),
          backgroundColor: '#2563eb',
          borderRadius: 12,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: 'rgba(15,23,42,0.06)' } },
        },
      },
    });
  }
}

function renderDashboardLists() {
  renderList(qs('#recentUsersList'), state.dashboard?.recent_users || [], (item) => `
    <div class="mini-row">
      <div>
        <div class="mini-title">${escapeHtml(item.name)}</div>
        <div class="mini-subtitle">${escapeHtml(item.email)}</div>
      </div>
      <span class="mini-badge">${escapeHtml(item.role || 'user')}</span>
    </div>
  `, 'No recent users yet.');

  renderList(qs('#recentOrdersList'), state.dashboard?.recent_orders || [], (item) => `
    <div class="mini-row">
      <div>
        <div class="mini-title">#${escapeHtml(asString(item.order_id))} · ${escapeHtml(item.customer_name)}</div>
        <div class="mini-subtitle">${escapeHtml(formatDate(item.order_date))}</div>
      </div>
      <div class="text-end">
        <div class="mini-title">${formatMoney(item.total_amount)}</div>
        <div class="mini-subtitle">${escapeHtml(item.delivery_status || 'Pending')}</div>
      </div>
    </div>
  `, 'No recent orders yet.');

  renderList(qs('#lowStockList'), state.dashboard?.low_stock_mobiles || [], (item) => `
    <div class="mini-row">
      <div>
        <div class="mini-title">${escapeHtml(item.name)}</div>
        <div class="mini-subtitle">${escapeHtml(item.brand)} · Stock ${escapeHtml(asString(item.stock_quantity || 0))}</div>
      </div>
      <span class="mini-badge danger">Low</span>
    </div>
  `, 'No low stock warnings.');

  renderList(qs('#mostViewedList'), state.dashboard?.most_viewed_mobiles || [], (item) => `
    <div class="mini-row">
      <div>
        <div class="mini-title">${escapeHtml(item.name)}</div>
        <div class="mini-subtitle">${escapeHtml(item.brand)}</div>
      </div>
      <span class="mini-badge">${escapeHtml(asString(item.view_count || 0))} views</span>
    </div>
  `, 'No view metrics yet.');

  renderList(qs('#mostPurchasedList'), state.dashboard?.most_purchased_mobiles || [], (item) => `
    <div class="mini-row">
      <div>
        <div class="mini-title">${escapeHtml(item.name)}</div>
        <div class="mini-subtitle">${escapeHtml(item.brand)}</div>
      </div>
      <span class="mini-badge">${escapeHtml(asString(item.purchase_count || 0))} sold</span>
    </div>
  `, 'No purchase metrics yet.');

  renderList(qs('#notificationsList'), state.notifications || [], (item) => `
    <div class="mini-row ${item.is_read ? 'is-read' : ''}">
      <div>
        <div class="mini-title">${escapeHtml(item.title)}</div>
        <div class="mini-subtitle">${escapeHtml(item.message)}</div>
      </div>
      <button class="btn btn-sm btn-outline-primary" data-notification-read="${item.notification_id}">${item.is_read ? 'Read' : 'Mark read'}</button>
    </div>
  `, 'No notifications yet.');
}

function renderMobileTable() {
  const target = qs('#mobileTableBody');
  if (!target) {
    return;
  }
  const filtered = getMobileFilteredItems();
  const perPage = state.mobilePerPage;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  state.mobilePage = Math.min(state.mobilePage, totalPages);
  const pageItems = filtered.slice((state.mobilePage - 1) * perPage, state.mobilePage * perPage);
  const paginationInfo = qs('#mobilePaginationInfo');
  if (paginationInfo) {
    paginationInfo.textContent = `Showing ${pageItems.length ? ((state.mobilePage - 1) * perPage) + 1 : 0}-${Math.min(filtered.length, state.mobilePage * perPage)} of ${filtered.length}`;
  }
  if (!pageItems.length) {
    renderEmpty(target, 'No mobiles match the current filters.');
    return;
  }
  target.innerHTML = pageItems.map((phone) => `
    <tr>
      <td><img class="table-thumb" src="${escapeHtml(phone.image_url || '')}" alt="${escapeHtml(phone.name)}"></td>
      <td>
        <div class="fw-bold">${escapeHtml(phone.name)}</div>
        <div class="text-muted small">${escapeHtml(phone.processor || '')}</div>
      </td>
      <td>${escapeHtml(phone.brand)}</td>
      <td>${formatMoney(phone.price)}</td>
      <td>${escapeHtml(asString(phone.ram || 0))} GB</td>
      <td>${escapeHtml(asString(phone.storage || 0))} GB</td>
      <td><span class="status-pill ${Number(phone.stock_quantity || 0) <= 15 ? 'danger' : 'success'}">${escapeHtml(asString(phone.stock_quantity || 0))}</span></td>
      <td><span class="status-pill ${escapeHtml(asString(phone.status || 'active')).toLowerCase()}">${escapeHtml(phone.status || 'active')}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-outline-primary" data-mobile-edit="${escapeDataAttr(phone)}">Edit</button>
          <button class="btn btn-sm btn-outline-danger" data-mobile-delete="${phone.phone_id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderBrandTable() {
  const target = qs('#brandTableBody');
  if (!target) {
    return;
  }
  let filtered = [...state.brands];
  const query = state.brandSearch.trim().toLowerCase();
  if (query) {
    filtered = filtered.filter((brand) => `${brand.name} ${brand.description || ''}`.toLowerCase().includes(query));
  }
  const perPage = state.brandPerPage;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  state.brandPage = Math.min(state.brandPage, totalPages);
  const pageItems = filtered.slice((state.brandPage - 1) * perPage, state.brandPage * perPage);
  const paginationInfo = qs('#brandPaginationInfo');
  if (paginationInfo) {
    paginationInfo.textContent = `Showing ${pageItems.length ? ((state.brandPage - 1) * perPage) + 1 : 0}-${Math.min(filtered.length, state.brandPage * perPage)} of ${filtered.length}`;
  }
  if (!pageItems.length) {
    renderEmpty(target, 'No brands match the current search.');
    return;
  }
  target.innerHTML = pageItems.map((brand) => `
    <tr>
      <td><img class="table-thumb brand-thumb" src="${escapeHtml(brand.logo_url || '')}" alt="${escapeHtml(brand.name)}"></td>
      <td class="fw-bold">${escapeHtml(brand.name)}</td>
      <td>${escapeHtml(brand.description || '')}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-outline-primary" data-brand-edit="${escapeDataAttr(brand)}">Edit</button>
          <button class="btn btn-sm btn-outline-danger" data-brand-delete="${brand.brand_id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderUserTable() {
  const target = qs('#userTableBody');
  if (!target) {
    return;
  }
  if (!state.users.length) {
    renderEmpty(target, 'No users found.');
    return;
  }
  const currentUser = getUser();
  target.innerHTML = state.users.map((user) => `
    <tr>
      <td class="fw-bold">${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(formatDate(user.created_at))}</td>
      <td>${escapeHtml(user.role || 'user')}</td>
      <td><span class="status-pill ${escapeHtml(asString(user.status || 'active')).toLowerCase()}">${escapeHtml(user.status || 'active')}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-outline-success" data-user-status="${user.user_id}" data-status="active">Activate</button>
          <button class="btn btn-sm btn-outline-warning" data-user-status="${user.user_id}" data-status="suspended">Suspend</button>
          <button class="btn btn-sm btn-outline-danger" data-user-delete="${user.user_id}" ${String(currentUser?.email || '') === String(user.email || '') ? 'disabled' : ''}>Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderOrderTable() {
  const target = qs('#orderTableBody');
  if (!target) {
    return;
  }
  if (!state.orders.length) {
    renderEmpty(target, 'No orders found.');
    return;
  }
  target.innerHTML = state.orders.map((order) => {
    const products = (order.products || []).map((product) => `${product.name}${product.quantity ? ` x${product.quantity}` : ''}`).join(', ');
    return `
      <tr>
        <td>#${escapeHtml(asString(order.order_id))}</td>
        <td>
          <div class="fw-bold">${escapeHtml(order.customer_name)}</div>
          <div class="text-muted small">${escapeHtml(order.customer_email || '')}</div>
        </td>
        <td>${escapeHtml(products)}</td>
        <td>${formatMoney(order.total_amount)}</td>
        <td>${escapeHtml(formatDate(order.order_date))}</td>
        <td>
          <select class="form-select form-select-sm" data-order-payment="${order.order_id}">
            ${PAYMENT_STATUSES.map((status) => `<option value="${status}" ${status === order.payment_status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="form-select form-select-sm" data-order-status="${order.order_id}">
            ${ORDER_STATUSES.map((status) => `<option value="${status}" ${status === order.delivery_status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-outline-primary" data-order-update="${order.order_id}">Update</button>
            <button class="btn btn-sm btn-outline-danger" data-order-delete="${order.order_id}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderReviewTable() {
  const target = qs('#reviewTableBody');
  if (!target) {
    return;
  }
  if (!state.reviews.length) {
    renderEmpty(target, 'No reviews found.');
    return;
  }
  target.innerHTML = state.reviews.map((review) => `
    <tr>
      <td>
        <div class="fw-bold">${escapeHtml(review.comment)}</div>
        <div class="text-muted small">${escapeHtml(formatDate(review.created_at))}</div>
      </td>
      <td>${escapeHtml(review.user_name || '')}</td>
      <td>${escapeHtml(review.phone_name || '')}</td>
      <td>${escapeHtml(asString(review.rating || 0))}/5</td>
      <td><span class="status-pill ${review.is_hidden ? 'danger' : review.is_approved ? 'success' : 'warning'}">${review.is_hidden ? 'Hidden' : review.is_approved ? 'Approved' : 'Pending'}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-outline-success" data-review-action="approve" data-review-id="${review.review_id}">Approve</button>
          <button class="btn btn-sm btn-outline-warning" data-review-action="hide" data-review-id="${review.review_id}">Hide</button>
          <button class="btn btn-sm btn-outline-danger" data-review-delete="${review.review_id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderReportCards() {
  const target = qs('#reportStatsCards');
  if (!target || !state.dashboard) {
    return;
  }
  const stats = state.dashboard.stats || {};
  target.innerHTML = [
    ['Revenue', formatMoney(stats.total_sales || 0)],
    ['Users', asString(stats.total_users || 0)],
    ['Mobiles', asString(stats.total_mobiles || 0)],
    ['Orders', asString(stats.total_orders || 0)],
  ].map(([label, value]) => `
    <div class="col-md-3">
      <div class="report-card">
        <div class="report-label">${escapeHtml(label)}</div>
        <div class="report-value">${escapeHtml(value)}</div>
      </div>
    </div>
  `).join('');
}

function renderProfileForm() {
  const form = qs('#profileForm');
  if (!form || !state.profile) {
    return;
  }
  form.elements.name.value = state.profile.name || '';
  form.elements.email.value = state.profile.email || '';
  form.elements.avatar_url.value = state.profile.avatar_url || '';
  setPreview('#profilePicturePreview', state.profile.avatar_url || '', state.profile.name || 'Profile picture');
}

function renderAll() {
  renderDashboardCards();
  renderCharts();
  renderDashboardLists();
  refreshBrandOptions();
  renderMobileTable();
  renderBrandTable();
  renderUserTable();
  renderOrderTable();
  renderReviewTable();
  renderReportCards();
  renderProfileForm();
}

async function loadData() {
  const [dashboard, phones, brands, users, orders, reviews, notifications, profile] = await Promise.all([
    apiRequest('/admin/dashboard'),
    apiRequest('/phones'),
    apiRequest('/admin/brands'),
    apiRequest('/admin/users'),
    apiRequest('/admin/orders'),
    apiRequest('/admin/reviews'),
    apiRequest('/admin/notifications'),
    apiRequest('/admin/profile'),
  ]);

  state.dashboard = dashboard;
  state.phones = phones;
  state.brands = brands;
  state.users = users;
  state.orders = orders;
  state.reviews = reviews;
  state.notifications = notifications;
  state.profile = profile;
}

function bindFilterEvents() {
  const mobileSearch = qs('#mobileSearch');
  const mobileBrand = qs('#mobileBrandFilter');
  const mobilePrice = qs('#mobilePriceFilter');
  const mobileSort = qs('#mobileSort');
  const mobilePerPage = qs('#mobilePerPage');
  const brandSearch = qs('#brandSearch');
  const brandPerPage = qs('#brandPerPage');

  mobileSearch?.addEventListener('input', (event) => {
    state.mobileSearch = event.target.value;
    state.mobilePage = 1;
    renderMobileTable();
  });
  mobileBrand?.addEventListener('change', (event) => {
    state.mobileBrand = event.target.value;
    state.mobilePage = 1;
    renderMobileTable();
  });
  mobilePrice?.addEventListener('change', (event) => {
    state.mobilePrice = event.target.value;
    state.mobilePage = 1;
    renderMobileTable();
  });
  mobileSort?.addEventListener('change', (event) => {
    state.mobileSort = event.target.value;
    state.mobilePage = 1;
    renderMobileTable();
  });
  mobilePerPage?.addEventListener('change', (event) => {
    state.mobilePerPage = Number(event.target.value || 5);
    state.mobilePage = 1;
    renderMobileTable();
  });
  brandSearch?.addEventListener('input', (event) => {
    state.brandSearch = event.target.value;
    state.brandPage = 1;
    renderBrandTable();
  });
  brandPerPage?.addEventListener('change', (event) => {
    state.brandPerPage = Number(event.target.value || 5);
    state.brandPage = 1;
    renderBrandTable();
  });

  qs('[data-mobile-prev]')?.addEventListener('click', () => {
    state.mobilePage = Math.max(1, state.mobilePage - 1);
    renderMobileTable();
  });
  qs('[data-mobile-next]')?.addEventListener('click', () => {
    state.mobilePage += 1;
    renderMobileTable();
  });
  qs('[data-brand-prev]')?.addEventListener('click', () => {
    state.brandPage = Math.max(1, state.brandPage - 1);
    renderBrandTable();
  });
  qs('[data-brand-next]')?.addEventListener('click', () => {
    state.brandPage += 1;
    renderBrandTable();
  });

  qs('[data-mobile-reset]')?.addEventListener('click', () => {
    state.mobileSearch = '';
    state.mobileBrand = 'all';
    state.mobilePrice = 'all';
    state.mobileSort = 'recent';
    state.mobilePage = 1;
    if (mobileSearch) mobileSearch.value = '';
    if (mobileBrand) mobileBrand.value = 'all';
    if (mobilePrice) mobilePrice.value = 'all';
    if (mobileSort) mobileSort.value = 'recent';
    renderMobileTable();
  });
  qs('[data-brand-reset]')?.addEventListener('click', () => {
    state.brandSearch = '';
    state.brandPage = 1;
    if (brandSearch) brandSearch.value = '';
    renderBrandTable();
  });
}

function bindForms() {
  const mobileForm = qs('#mobileForm');
  const brandForm = qs('#brandForm');
  const profileForm = qs('#profileForm');
  const mobileImageFile = qs('#mobileImageFile');
  const brandLogoFile = qs('#brandLogoFile');
  const profilePictureFile = qs('#profilePictureFile');

  mobileImageFile?.addEventListener('change', async () => {
    const file = mobileImageFile.files?.[0];
    if (!file || !mobileForm) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    mobileForm.elements.image_url.value = dataUrl;
    setPreview('#mobileImagePreview', dataUrl, 'Mobile image');
  });

  brandLogoFile?.addEventListener('change', async () => {
    const file = brandLogoFile.files?.[0];
    if (!file || !brandForm) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    brandForm.elements.logo_url.value = dataUrl;
    setPreview('#brandLogoPreview', dataUrl, 'Brand logo');
  });

  profilePictureFile?.addEventListener('change', async () => {
    const file = profilePictureFile.files?.[0];
    if (!file || !profileForm) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    profileForm.elements.avatar_url.value = dataUrl;
    setPreview('#profilePicturePreview', dataUrl, 'Profile picture');
  });

  mobileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(mobileForm).entries());
    payload.price = Number(payload.price || 0);
    payload.ram = Number(payload.ram || 0);
    payload.storage = Number(payload.storage || 0);
    payload.camera = Number(payload.camera || 0);
    payload.battery = Number(payload.battery || 0);
    payload.stock_quantity = Number(payload.stock_quantity || 0);
    payload.performance_score = Number(payload.performance_score || 0);
    payload.featured = payload.featured === 'true' || payload.featured === true;
    if (!payload.image_url && mobileImageFile?.files?.[0]) {
      payload.image_url = await readFileAsDataUrl(mobileImageFile.files[0]);
    }
    try {
      if (payload.phone_id) {
        await apiRequest(`/admin/devices/${payload.phone_id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest('/admin/devices', { method: 'POST', body: JSON.stringify(payload) });
      }
      toast('Mobile saved successfully', 'success');
      mobileForm.reset();
      mobileForm.elements.phone_id.value = '';
      mobileForm.elements.image_url.value = '';
      if (mobileImageFile) mobileImageFile.value = '';
      setPreview('#mobileImagePreview', '', 'Mobile image');
      await refreshData();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  brandForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(brandForm).entries());
    try {
      if (payload.brand_id) {
        await apiRequest(`/admin/brands/${payload.brand_id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest('/admin/brands', { method: 'POST', body: JSON.stringify(payload) });
      }
      toast('Brand saved successfully', 'success');
      brandForm.reset();
      brandForm.elements.brand_id.value = '';
      brandForm.elements.logo_url.value = '';
      if (brandLogoFile) brandLogoFile.value = '';
      setPreview('#brandLogoPreview', '', 'Brand logo');
      await refreshData();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(profileForm).entries());
    try {
      const response = await apiRequest('/admin/profile', { method: 'PATCH', body: JSON.stringify(payload) });
      const token = getToken();
      if (token && response.user) {
        setToken(token, { name: response.user.name, role: 'admin', email: response.user.email });
      }
      toast('Profile updated successfully', 'success');
      await refreshData();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  qs('[data-mobile-cancel]')?.addEventListener('click', () => {
    if (!mobileForm) {
      return;
    }
    mobileForm.reset();
    mobileForm.elements.phone_id.value = '';
    mobileForm.elements.image_url.value = '';
    setPreview('#mobileImagePreview', '', 'Mobile image');
  });
}

function bindTableActions() {
  document.addEventListener('click', async (event) => {
    const mobileEdit = event.target.closest('[data-mobile-edit]');
    if (mobileEdit) {
      const phone = JSON.parse(mobileEdit.getAttribute('data-mobile-edit'));
      const form = qs('#mobileForm');
      if (form) {
        Object.entries(phone).forEach(([key, value]) => {
          if (form.elements[key]) {
            form.elements[key].value = value ?? '';
          }
        });
        form.elements.featured.value = String(Boolean(phone.featured));
        setPreview('#mobileImagePreview', phone.image_url || '', phone.name || 'Mobile image');
      }
      window.location.hash = '#mobile-management';
      return;
    }

    const mobileDelete = event.target.closest('[data-mobile-delete]');
    if (mobileDelete) {
      if (!window.confirm('Delete this mobile?')) {
        return;
      }
      try {
        await apiRequest(`/admin/devices/${mobileDelete.getAttribute('data-mobile-delete')}`, { method: 'DELETE' });
        toast('Mobile deleted successfully', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const brandEdit = event.target.closest('[data-brand-edit]');
    if (brandEdit) {
      const brand = JSON.parse(brandEdit.getAttribute('data-brand-edit'));
      const form = qs('#brandForm');
      if (form) {
        Object.entries(brand).forEach(([key, value]) => {
          if (form.elements[key]) {
            form.elements[key].value = value ?? '';
          }
        });
        setPreview('#brandLogoPreview', brand.logo_url || '', brand.name || 'Brand logo');
      }
      window.location.hash = '#brand-management';
      return;
    }

    const brandDelete = event.target.closest('[data-brand-delete]');
    if (brandDelete) {
      if (!window.confirm('Delete this brand? Mobiles must be reassigned first.')) {
        return;
      }
      try {
        await apiRequest(`/admin/brands/${brandDelete.getAttribute('data-brand-delete')}`, { method: 'DELETE' });
        toast('Brand deleted successfully', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const userStatus = event.target.closest('[data-user-status]');
    if (userStatus) {
      try {
        await apiRequest(`/admin/users/${userStatus.getAttribute('data-user-status')}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: userStatus.getAttribute('data-status') }),
        });
        toast('User status updated', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const userDelete = event.target.closest('[data-user-delete]');
    if (userDelete) {
      if (!window.confirm('Delete this user?')) {
        return;
      }
      try {
        await apiRequest(`/admin/users/${userDelete.getAttribute('data-user-delete')}`, { method: 'DELETE' });
        toast('User deleted successfully', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const orderUpdate = event.target.closest('[data-order-update]');
    if (orderUpdate) {
      const orderId = orderUpdate.getAttribute('data-order-update');
      const paymentStatus = qs(`[data-order-payment="${orderId}"]`)?.value;
      const deliveryStatus = qs(`[data-order-status="${orderId}"]`)?.value;
      try {
        await apiRequest(`/admin/orders/${orderId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ payment_status: paymentStatus, delivery_status: deliveryStatus }),
        });
        toast('Order updated successfully', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const orderDelete = event.target.closest('[data-order-delete]');
    if (orderDelete) {
      if (!window.confirm('Delete this order?')) {
        return;
      }
      try {
        await apiRequest(`/admin/orders/${orderDelete.getAttribute('data-order-delete')}`, { method: 'DELETE' });
        toast('Order deleted successfully', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const reviewAction = event.target.closest('[data-review-action]');
    if (reviewAction) {
      try {
        await apiRequest(`/admin/reviews/${reviewAction.getAttribute('data-review-id')}`, {
          method: 'PATCH',
          body: JSON.stringify({ action: reviewAction.getAttribute('data-review-action') }),
        });
        toast('Review updated', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const reviewDelete = event.target.closest('[data-review-delete]');
    if (reviewDelete) {
      if (!window.confirm('Delete this review?')) {
        return;
      }
      try {
        await apiRequest(`/admin/reviews/${reviewDelete.getAttribute('data-review-delete')}`, { method: 'DELETE' });
        toast('Review deleted successfully', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const notificationRead = event.target.closest('[data-notification-read]');
    if (notificationRead) {
      try {
        await apiRequest(`/admin/notifications/${notificationRead.getAttribute('data-notification-read')}/read`, { method: 'PATCH', body: JSON.stringify({}) });
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const syncButton = event.target.closest('[data-sync-json]');
    if (syncButton) {
      try {
        await apiRequest('/sync-json', { method: 'POST', body: JSON.stringify({}) });
        toast('Catalog synchronized', 'success');
        await refreshData();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  document.querySelectorAll('[data-admin-refresh]').forEach((button) => {
    button.addEventListener('click', async () => {
      await refreshData();
      toast('Dashboard refreshed', 'success');
    });
  });
}

function bindSectionNav() {
  const navLinks = document.querySelectorAll('.admin-nav-link');
  const sectionIds = ['dashboard', 'mobile-management', 'brand-management', 'user-management', 'order-management', 'review-management', 'reports', 'settings', 'profile'];
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
    });
  }, { rootMargin: '-35% 0px -55% 0px', threshold: 0.15 });
  sectionIds.forEach((id) => {
    const section = document.getElementById(id);
    if (section) {
      observer.observe(section);
    }
  });
}

function ensureAdminAccess() {
  const user = getUser();
  if (!user || user.role !== 'admin') {
    const content = document.querySelector('.admin-content');
    if (content) {
      content.innerHTML = '<div class="panel-card p-4"><div class="alert alert-danger mb-0">Admin access required.</div></div>';
    }
    return false;
  }
  return true;
}

async function refreshData() {
  await loadData();
  renderAll();
}

async function initAdminDashboard() {
  if (!ensureAdminAccess()) {
    return;
  }
  bindSectionNav();
  bindFilterEvents();
  bindForms();
  bindTableActions();
  await refreshData();
}

document.addEventListener('DOMContentLoaded', () => {
  initAdminDashboard().catch((error) => {
    toast(error.message, 'error');
  });
});
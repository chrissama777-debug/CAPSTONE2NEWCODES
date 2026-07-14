function formatMoney(value) {
  const numeric = Number(value) || 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric);
}

async function loadDevices() {
  const status = document.getElementById('graphStatus');
  const debug = document.getElementById('graphDebug');
  try {
    if (status) status.textContent = 'Loading devices...';
    const res = await fetch('/phones');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const phones = await res.json();
    console.debug('loaded phones', phones);
    const sel = document.getElementById('graphDevice');
    if (!phones || !phones.length) {
      sel.innerHTML = `<option value="">(no devices)</option>`;
      if (status) status.textContent = 'No devices available.';
      if (debug) debug.textContent = 'API returned no phones.';
      return;
    }
    sel.innerHTML = phones.map(p => `<option value="${p.phone_id}">${p.name}</option>`).join('');
    sel.addEventListener('change', renderGraph);
    sel.value = phones[0].phone_id;
    if (status) status.textContent = '';
    await renderGraph();
  } catch (e) {
    console.error('Failed to load phones', e);
    if (status) status.textContent = 'Failed to load devices. See console.';
    if (debug) debug.textContent = String(e);
  }
}

async function renderGraph() {
  const sel = document.getElementById('graphDevice');
  const id = sel.value;
  const canvas = document.getElementById('priceGraph');
  try {
    const res = await fetch(`/trend?phone_id=${id}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const labels = [...data.historical_labels, ...data.predicted_labels];
    const hist = [...data.historical_prices, ...Array(data.predicted_prices.length).fill(null)];
    const fut = [...Array(data.historical_prices.length).fill(null), ...data.predicted_prices];
    if (window.__priceGraphChart && typeof window.__priceGraphChart.destroy === 'function') {
      try { window.__priceGraphChart.destroy(); } catch (e) { console.warn('Error destroying priceGraphChart', e); }
      window.__priceGraphChart = null;
    }
    const ctx = canvas.getContext('2d');
    window.__priceGraphChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Historical', data: hist, borderColor: '#0f766e', backgroundColor: 'rgba(15,118,110,0.12)', fill: true, tension: 0.3 },
          { label: 'Predicted', data: fut, borderColor: '#f97316', borderDash: [6,4], backgroundColor: 'rgba(249,115,22,0.08)', fill: true, tension: 0.3 },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#eee' }, ticks: { callback: (v)=> formatMoney(v) } } }
    });
  } catch (err) {
    console.error('Graph render failed', err);
    const debug = document.getElementById('graphDebug');
    if (debug) debug.textContent = String(err);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadDevices().catch(e => {
    console.error('loadDevices failed', e);
    const debug = document.getElementById('graphDebug');
    if (debug) debug.textContent = String(e);
  });
});

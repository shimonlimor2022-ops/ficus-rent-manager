/* Ficus Investments - rent payment tracking (open payments, history). */
(function () {
  var API = '/api/payments';
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var openList = [];
  var curPropId = null;
  var histTimer = null;
  window.openPaymentsInfo = { count: 0, remaining: 0 };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(x) { return Number(x || 0); }
  function money(x) { return '€' + num(x).toLocaleString('en-EU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function dateTxt(s) {
    if (!s) return '—';
    return new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysFromToday(s) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var d = new Date(String(s).slice(0, 10) + 'T00:00:00');
    return Math.round((d - t) / 86400000);
  }
  async function api(url, opts) {
    var r = await fetch(url, opts);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }
  function post(body) {
    return api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '.pay-card{border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fff;}',
    '.pay-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}',
    '.pay-nums{font-size:12.5px;color:var(--muted);margin-top:8px;line-height:1.7;}',
    '.pay-nums b{color:var(--text);}',
    '.pay-over{color:var(--danger);font-weight:600;}',
    '.pay-entries{margin-top:8px;border-top:1px dashed

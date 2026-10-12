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
    '.pay-entries{margin-top:8px;border-top:1px dashed #E4DFD8;padding-top:6px;}',
    '.pay-entry{display:flex;gap:10px;align-items:center;font-size:12.5px;padding:3px 0;}',
    '.pay-entry .muted{color:var(--muted);}',
    '.pay-x{margin-inline-start:auto;border:none;background:none;color:var(--hint);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;}',
    '.pay-x:hover{background:var(--danger-light);color:var(--danger);}',
    '.pay-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}',
    '.pay-btn{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:99px;padding:7px 14px;font-size:12.5px;cursor:pointer;font-family:Inter,sans-serif;}',
    '.pay-btn:hover{background:var(--bg);}',
    '.pay-btn.ok{background:var(--ok);border-color:var(--ok);color:#fff;}',
    '.pay-btn.bad{color:var(--danger);border-color:#E8C4BC;}',
    '.pay-add{display:none;margin-top:10px;padding:10px;background:var(--stripe);border-radius:8px;gap:8px;flex-wrap:wrap;align-items:flex-end;}',
    '.pay-add.show{display:flex;}',
    '.pay-add label{font-size:11.5px;color:var(--muted);display:block;margin-bottom:3px;}',
    '.pay-add input{font-family:Inter,sans-serif;border:1px solid var(--border);border-radius:8px;padding:8px 9px;font-size:13.5px;background:#fff;width:140px;}',
    '.pay-add input.note{width:170px;}',
    '.pay-empty{text-align:center;color:var(--muted);padding:30px 10px;font-size:13.5px;}',
    '.hist-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}',
    '.hist-filters input,.hist-filters select{font-family:Inter,sans-serif;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13.5px;background:#FCFBFA;}',
    '.hist-filters input[type=text]{flex:1;min-width:140px;}',
    '.hist-filters input[type=number]{width:90px;}',
    '.hist-sum{font-size:12.5px;color:var(--muted);margin-bottom:10px;}',
    '.hist-sum b{color:var(--text);}',
    '.prop-tabs{display:none;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--border);}',
    '.prop-tab{border:none;background:none;padding:9px 14px;font-size:13.5px;font-family:Inter,sans-serif;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;}',
    '.prop-tab.active{color:var(--text);font-weight:600;border-bottom-color:var(--text);}',
    '.sum-nav{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:14px;}',
    '.sum-nav button{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:#fff;cursor:pointer;color:var(--muted);font-size:16px;}',
    '.sum-label{font-family:Outfit,sans-serif;font-weight:600;font-size:15px;min-width:150px;text-align:center;}',
    '.sum-cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;}',
    '@media(max-width:560px){.sum-cards{grid-template-columns:1fr;}}',
    '.sum-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 13px;}',
    '.sum-card .l{font-size:10.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.02em;}',
    '.sum-card .v{font-family:Outfit,sans-serif;font-size:20px;font-weight:700;margin-top:4px;}',
    '.sum-card.ok

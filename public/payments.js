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
    '.sum-card.ok .v{color:var(--ok);}',
    '.sum-card.bad{background:#111008;border-color:#111008;cursor:pointer;}',
    '.sum-card.bad .l{color:#F0958A;}',
    '.sum-card.bad .v{color:#F6B8AE;}',
    '.sum-tip{display:none;background:#111008;border-radius:12px;padding:14px 16px;margin-bottom:14px;}',
    '.sum-tip.show{display:block;}',
    '.sum-tip .t{color:#F0958A;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;}',
    '.sum-tip .r{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;color:#EFECEA;padding:7px 0;border-top:1px solid #2A281F;}',
    '.sum-tip .r:first-of-type{border-top:none;}',
    '.sum-export{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 4px;}',
    '.pay-badge{display:inline-block;min-width:18px;padding:1px 6px;border-radius:99px;background:var(--danger);color:#fff;font-size:11px;font-weight:700;text-align:center;}',
    '.pay-add input,.pay-add select{height:40px;box-sizing:border-box;}',
    '.dsel{display:flex;gap:4px;}',
    '.dsel select{font-family:Inter,sans-serif;border:1px solid var(--border);border-radius:8px;padding:0 6px;font-size:13.5px;background:#fff;color:var(--text);}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- modals ---------- */
  var monthOpts = '<option value="">All months</option>' + MONTHS.map(function (m, i) {
    return '<option value="' + (i + 1) + '">' + m + '</option>';
  }).join('');
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="overlay" id="openPayOverlay"><div class="modal" style="max-width:720px;">' +
      '<h2>Open payments</h2>' +
      '<div class="settings-hint">When a payment date arrives it stays here until you mark it paid or unpaid.</div>' +
      '<div id="openPayList"></div>' +
      '<div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeOpenPayments()">Close</button></div>' +
    '</div></div>' +
    '<div class="overlay" id="histOverlay"><div class="modal" style="max-width:720px;">' +
      '<h2>Payment history</h2>' +
      '<div class="hist-filters">' +
        '<input type="text" id="histTenant" placeholder="Tenant name">' +
        '<select id="histMonth">' + monthOpts + '</select>' +
        '<input type="number" id="histYear" placeholder="Year" min="2000" max="2100">' +
        '<button type="button" class="pay-btn" id="histClear">Clear</button>' +
      '</div>' +
      '<div class="hist-sum" id="histSum"></div>' +
      '<div id="histList"></div>' +
      '<div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeHistory()">Close</button></div>' +
    '</div></div>' +
    '<div class="overlay" id="sumOverlay"><div class="modal" style="max-width:720px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;">' +
        '<h2 style="margin-bottom:0;">Monthly summary</h2>' +
        '<div style="display:flex;gap:6px;">' +
          '<button type="button" class="icon-round-btn" id="sumPrint" title="Print" aria-label="Print">'+ '<svg width="16" height="16" viewBox="0 0 90 90"><path d="M 82.316 20.766 H 69.021 V 7.764 c 0 -2.664 -2.167 -4.831 -4.831 -4.831 H 25.811 c -2.664 0 -4.831 2.167 -4.831 4.831 v 13.002 H 7.683 C 3.447 20.766 0 24.213 0 28.449 v 34.511 c 0 4.236 3.447 7.683 7.683 7.683 h 13.296 v 11.593 c 0 2.664 2.167 4.831 4.831 4.831 h 38.379 c 2.664 0 4.831 -2.167 4.831 -4.831 V 70.643 h 13.296 c 4.236 0 7.684 -3.446 7.684 -7.683 V 28.449 C 90 24.213 86.553 20.766 82.316 20.766 z M 22.979 7.764 c 0 -1.561 1.27 -2.831 2.831 -2.831 h 38.379 c 1.562 0 2.831 1.27 2.831 2.831 v 13.002 H 22.979 V 7.764 z M 67.021 82.236 c 0 1.562 -1.27 2.831 -2.831 2.831 H 25.811 c -1.561 0 -2.831 -1.27 -2.831 -2.831 V 55.953 h 44.041 V 82.236 z M 67 30.628 c -0.828 0 -1.5 -0.672 -1.5 -1.5 s 0.672 -1.5 1.5 -1.5 s 1.5 0.672 1.5 1.5 S 67.828 30.628 67 30.628 z M 74 30.628 c -0.828 0 -1.5 -0.672 -1.5 -1.5 s 0.672 -1.5 1.5 -1.5 s 1.5 0.672 1.5 1.5 S 74.828 30.628 74 30.628 z M 81 30.628 c -0.828 0 -1.5 -0.672 -1.5 -1.5 s 0.672 -1.5 1.5 -1.5 s 1.5 0.672 1.5 1.5 S 81.828 30.628 81 30.628 z" fill="currentColor"/><path d="M 59.705 65.953 h -30 c -0.552 0 -1 -0.447 -1 -1 s 0.448 -1 1 -1 h 30 c 0.553 0 1 0.447 1 1 S 60.258 65.953 59.705 65.953 z" fill="currentColor"/><path d="M 59.705 75.953 h -30 c -0.552 0 -1 -0.447 -1 -1 s 0.448 -1 1 -1 h 30 c 0.553 0 1 0.447 1 1 S 60.258 75.953 59.705 75.953 z" fill="currentColor"/></svg></button>' +
          '<button type="button" class="icon-round-btn" id="sumExcel" title="Export to Excel" aria-label="Export to Excel">'+ '<svg width="16" height="16" viewBox="0 0 90 90"><path d="M 80.959 78.79 H 19.13 c -1.588 0 -2.876 -1.288 -2.876 -2.876 V 14.085 c 0 -1.588 1.288 -2.876 2.876 -2.876 h 61.829 c 1.588 0 2.876 1.288 2.876 2.876 v 61.829 C 83.835 77.503 82.547 78.79 80.959 78.79 z" fill="rgb(255,255,255)"/><path d="M 80.959 80.79 H 19.13 c -2.688 0 -4.876 -2.187 -4.876 -4.875 v -61.83 c 0 -2.688 2.188 -4.876 4.876 -4.876 h 61.829 c 2.688 0 4.876 2.188 4.876 4.876 v 61.83 C 85.835 78.604 83.647 80.79 80.959 80.79 z M 19.13 13.209 c -0.483 0 -0.876 0.393 -0.876 0.876 v 61.83 c 0 0.482 0.393 0.875 0.876 0.875 h 61.829 c 0.483 0 0.876 -0.393 0.876 -0.875 v -61.83 c 0 -0.483 -0.393 -0.876 -0.876 -0.876 H 19.13 z" fill="rgb(25,117,76)"/><rect x="61.05" y="20.47" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="61.05" y="31.74" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="61.05" y="43" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="61.05" y="54.26" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="61.05" y="65.53" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="39.76" y="20.47" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="39.76" y="31.74" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="39.76" y="43" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="39.76" y="54.26" width="15.93" height="4" fill="rgb(25,117,76)"/><rect x="39.76" y="65.53" width="15.93" height="4" fill="rgb(25,117,76)"/><polygon points="51.33,90 6.17,78.79 6.17,11.21 51.33,0" fill="rgb(25,117,76)"/><polygon points="38.15,28.21 31.01,28.62 26.67,37.72 22.56,29.1 15.8,29.48 23.2,45 15.8,60.52 22.56,60.9 26.67,52.28 31.01,61.38 38.15,61.79 30.14,45" fill="rgb(255,255,255)"/></svg></button>' +
          '<button type="button" class="icon-round-btn" id="sumEmail" title="Email summary" aria-label="Email summary">'+ '<svg width="16" height="16" viewBox="0 0 90 90"><path d="M 81.055 84.001 H 8.945 C 4.013 84.001 0 79.988 0 75.056 V 30.34 c 0 -4.933 4.013 -8.945 8.945 -8.945 H 49.19 c 0.553 0 1 0.448 1 1 s -0.447 1 -1 1 H 8.945 C 5.116 23.395 2 26.511 2 30.34 v 44.715 c 0 3.83 3.116 6.945 6.945 6.945 h 72.109 c 3.83 0 6.945 -3.115 6.945 -6.945 V 42.671 c 0 -0.552 0.447 -1 1 -1 s 1 0.448 1 1 v 32.385 C 90 79.988 85.987 84.001 81.055 84.001 z" fill="currentColor"/><path d="M 44.797 61.203 c -1.531 0 -3.065 -0.549 -4.29 -1.655 l -29.433 -26.62 c -0.41 -0.371 -0.441 -1.003 -0.071 -1.413 c 0.37 -0.41 1.003 -0.441 1.413 -0.071 l 29.432 26.62 c 1.747 1.578 4.413 1.506 6.07 -0.166 l 13.65 -13.762 c 0.391 -0.393 1.022 -0.394 1.414 -0.006 c 0.393 0.389 0.395 1.022 0.006 1.414 l -13.65 13.762 C 48.089 60.567 46.444 61.203 44.797 61.203 z" fill="currentColor"/><path d="M 73.604 38.791 c -9.041 0 -16.396 -7.355 -16.396 -16.396 S 64.563 5.999 73.604 5.999 C 82.645 5.999 90 13.354 90 22.395 S 82.645 38.791 73.604 38.791 z M 73.604 7.999 c -7.938 0 -14.396 6.458 -14.396 14.396 s 6.458 14.396 14.396 14.396 C 81.542 36.791 88 30.333 88 22.395 S 81.542 7.999 73.604 7.999 z" fill="currentColor"/><path d="M 77.294 27.831 h -2.604 V 15.959 c 0 -0.396 -0.233 -0.754 -0.596 -0.915 c -0.361 -0.161 -0.784 -0.092 -1.077 0.175 l -3.775 3.433 c -0.408 0.372 -0.438 1.004 -0.067 1.413 c 0.372 0.41 1.006 0.438 1.413 0.067 l 2.103 -1.912 v 9.611 h -2.775 c -0.553 0 -1 0.448 -1 1 s 0.447 1 1 1 h 7.38 c 0.553 0 1 -0.448 1 -1 S 77.847 27.831 77.294 27.831 z" fill="currentColor"/></svg></button>' +
        '</div>' +
      '</div>' +
      '<div class="sum-nav"><button type="button" id="sumPrev" aria-label="Previous month">‹</button>' +
        '<div class="sum-label" id="sumLabel"></div>' +
        '<button type="button" id="sumNext" aria-label="Next month">›</button></div>' +
      '<div class="sum-cards">' +
        '<div class="sum-card"><div class="l">Opening balance</div><div class="v" id="sumOpen">€0</div></div>' +
        '<div class="sum-card ok"><div class="l">Paid</div><div class="v" id="sumPaid">€0</div></div>' +
        '<div class="sum-card bad" id="sumBad"><div class="l">Outstanding (tap for list)</div><div class="v" id="sumOut">€0</div></div>' +
      '</div>' +
      '<div class="sum-tip" id="sumTip"></div>' +
      '<div style="margin-bottom:12px;"><button type="button" class="pay-btn" id="spOpen">+ Add payment</button></div>' +
      '<div class="pay-add" id="spForm">' +
        '<div><label>Property</label><select id="spProp" style="font-family:Inter,sans-serif;border:1px solid var(--border);border-radius:8px;padding:8px 9px;font-size:13.5px;background:#fff;width:200px;"></select></div>' +
        '<div><label>Payment due date</label><input type="date" id="spDue"></div>' +
        '<div><label>Expected (€)</label><input type="number" step="0.01" min="0" id="spExpected"></div>' +
        '<div><label>Status</label><select id="spStatus" style="font-family:Inter,sans-serif;border:1px solid var(--border);border-radius:8px;padding:8px 9px;font-size:13.5px;background:#fff;width:140px;">' +
          '<option value="paid">Paid</option><option value="partial">Partially paid</option><option value="unpaid">Not paid</option></select></div>' +
        '<div id="spPayFields" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
          '<div><label>Date paid</label><input type="date" id="spDate"></div>' +
          '<div><label>Amount paid (€)</label><input type="number" step="0.01" min="0" id="spAmount"></div>' +
        '</div>' +
        '<button type="button" class="pay-btn ok" id="spSave">Save</button>' +
        '<button type="button" class="pay-btn" id="spCancel">Cancel</button>' +
      '</div>' +
      '<div id="sumList" style="margin-top:10px;"></div>' +
      '<div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeSummary()">Close</button></div>' +
    '</div></div>';
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

  /* ---------- card ---------- */
  function pill(status) {
    if (status === 'paid') return '<span class="pill pill-ok">Paid</span>';
    if (status === 'partial') return '<span class="pill pill-warn">Partially paid</span>';
    if (status === 'unpaid') return '<span class="pill pill-danger">Not paid</span>';
    return '<span class="pill pill-danger">Open</span>';
  }

  function card(p, showProperty) {
    var paid = num(p.paid_total);
    var hasExp = p.expected_amount !== null && p.expected_amount !== undefined;
    var exp = hasExp ? num(p.expected_amount) : null;
    var rem = hasExp ? Math.max(0, exp - paid) : null;
    var over = '';
    if ((p.status === 'open' || p.status === 'partial') && daysFromToday(p.due_date) < 0) {
      over = ' <span class="pay-over">Overdue ' + Math.abs(daysFromToday(p.due_date)) + 'd</span>';
    }
    var entries = (p.entries || []).map(function (e) {
      return '<div class="pay-entry"><span>' + dateTxt(e.paid_date) + '</span><b>' + money(e.amount) + '</b>' +
        (e.note ? '<span class="muted">' + esc(e.note) + '</span>' : '') +
        '<button type="button" class="pay-x" data-act="del" data-eid="' + e.id + '" title="Delete this payment entry" aria-label="Delete this payment entry">✕</button></div>';
    }).join('');
    var actions = '';
    if (p.status === 'open' || p.status === 'partial') {
      actions =
        '<button type="button" class="pay-btn ok" data-act="paid">Mark fully paid</button>' +
        '<button type="button" class="pay-btn" data-act="add">Add payment</button>' +
        '<button type="button" class="pay-btn bad" data-act="unpaid">Mark not paid</button>';
    } else if (p.status === 'unpaid') {
      actions =
        '<button type="button" class="pay-btn" data-act="add">Add payment</button>' +
        '<button type="button" class="pay-btn" data-act="reopen">Reopen</button>';
    }
    var title = showProperty
      ? '<div><div class="prop-name">' + esc(p.property_name) + '</div><div class="contact-sub">' + esc(p.contact_name || '—') + '</div></div>'
      : '<div><div class="prop-name">Due ' + dateTxt(p.due_date) + '</div></div>';
    var nums = (showProperty ? 'Due <b>' + dateTxt(p.due_date) + '</b>' + over + ' · ' : (over ? over.trim() + ' · ' : '')) +
      'Expected <b>' + (hasExp ? money(exp) : '—') + '</b> · Paid <b>' + money(paid) + '</b>' +
      (rem !== null && p.status !== 'paid' ? ' · Remaining <b>' + money(rem) + '</b>' : '');
    return '<div class="pay-card" data-pid="' + p.id + '" data-rem="' + (rem === null ? '' : rem) + '">' +
      '<div class="pay-top">' + title + pill(p.status) + '</div>' +
      '<div class="pay-nums">' + nums + '</div>' +
      (entries ? '<div class="pay-entries">' + entries + '</div>' : '') +
      (actions ? '<div class="pay-actions">' + actions + '</div>' : '') +
      '<div class="pay-add">' +
        '<div><label>Payment date</label><input type="date" class="f-date"></div>' +
        '<div><label>Amount (€)</label><input type="number" step="0.01" min="0" class="f-amount"></div>' +
        '<div><label>Note (optional)</label><input type="text" class="f-note note"></div>' +
        '<button type="button" class="pay-btn ok" data-act="save-add">Save</button>' +
        '<button type="button" class="pay-btn" data-act="cancel-add">Cancel</button>' +
      '</div>' +
    '</div>';
  }

  function defaultExpected() {
    try {
      if (typeof properties !== 'undefined' && typeof totalWithTax === 'function') {
        var pr = properties.find(function (x) { return x.id === curPropId; });
        var t = pr ? totalWithTax(pr) : null;
        return t === null || t === undefined ? '' : t;
      }
    } catch (err) {}
    return '';
  }
  function ppToggle() {
    var unpaid = document.getElementById('ppStatus').value === 'unpaid';
    document.getElementById('ppPayFields').style.display = unpaid ? 'none' : 'flex';
  }

  async function onAction(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var cardEl = btn.closest('.pay-card');
    var act = btn.getAttribute('data-act');
    if (act === 'pp-open') {
      var f = document.getElementById('ppForm');
      f.classList.add('show');
      document.getElementById('ppDue').value = '';
      document.getElementById('ppStatus').value = 'paid';
      document.getElementById('ppDate').value = todayIso();
      document.getElementById('ppExpected').value = defaultExpected();
      document.getElementById('ppAmount').value = defaultExpected();
      ppToggle();
      return;
    }
    if (act === 'pp-cancel') { document.getElementById('ppForm').classList.remove('show'); return; }
    if (act === 'pp-save') {
      var due = document.getElementById('ppDue').value;
      var st = document.getElementById('ppStatus').value;
      var exp = document.getElementById('ppExpected').value;
      var pdate = document.getElementById('ppDate').value;
      var pamt = Number(document.getElementById('ppAmount').value);
      if (!due) { alert('Please choose the payment due date.'); return; }
      if (st !== 'unpaid') {
        if (!pdate) { alert('Please choose the date the payment was made.'); return; }
        if (!(pamt > 0)) { alert('Please enter the amount paid.'); return; }
      }
      try {
        await post({
          action: 'create_period', property_id: curPropId, due_date: due, status: st,
          expected_amount: exp === '' ? null : Number(exp),
          paid_date: st === 'unpaid' ? null : pdate, amount: st === 'unpaid' ? null : pamt
        });
        await refreshAll();
      } catch (err) { alert(err.message || 'Something went wrong.'); }
      return;
    }
    var pid = cardEl ? Number(cardEl.getAttribute('data-pid')) : null;
    try {
      if (act === 'add') {
        var form = cardEl.querySelector('.pay-add');
        form.classList.add('show');
        cardEl.querySelector('.f-date').value = todayIso();
        cardEl.querySelector('.f-amount').value = cardEl.getAttribute('data-rem') || '';
        return;
      }
      if (act === 'cancel-add') { cardEl.querySelector('.pay-add').classList.remove('show'); return; }
      if (act === 'save-add') {
        var d = cardEl.querySelector('.f-date').value;
        var a = Number(cardEl.querySelector('.f-amount').value);
        if (!d) { alert('Please choose the payment date.'); return; }
        if (!(a > 0)) { alert('Please enter an amount greater than 0.'); return; }
        await post({ action: 'add_entry', period_id: pid, paid_date: d, amount: a, note: cardEl.querySelector('.f-note').value || null });
      } else if (act === 'paid') {
        if (!confirm('Mark this payment as fully paid (today)?')) return;
        await post({ action: 'set_status', period_id: pid, status: 'paid', paid_date: todayIso() });
      } else if (act === 'unpaid') {
        if (!confirm('Mark this payment as NOT paid?')) return;
        await post({ action: 'set_status', period_id: pid, status: 'unpaid' });
      } else if (act === 'reopen') {
        await post({ action: 'set_status', period_id: pid, status: 'open' });
      } else if (act === 'del') {
        if (!confirm('Delete this payment entry?')) return;
        await post({ action: 'delete_entry', entry_id: Number(btn.getAttribute('data-eid')) });
      } else { return; }
      await refreshAll();
    } catch (err) {
      alert(err.message || 'Something went wrong.');
    }
  }

  ['openPayList', 'histList'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', onAction);
  });

  /* ---------- open payments ---------- */
  async function refreshOpenPayments() {
    try {
      openList = await api(API + '?view=open');
    } catch (err) {
      openList = [];
    }
    var remaining = 0;
    openList.forEach(function (p) {
      if (p.expected_amount !== null && p.expected_amount !== undefined) {
        remaining += Math.max(0, num(p.expected_amount) - num(p.paid_total));
      }
    });
    window.openPaymentsInfo = { count: openList.length, remaining: remaining };
    var badge = document.getElementById('openPayBadge');
    if (badge) {
      badge.textContent = openList.length;
      badge.style.display = openList.length ? 'inline-block' : 'none';
    }
    if (typeof window.renderSummary === 'function') window.renderSummary();
  }

  function renderOpenModal() {
    var el = document.getElementById('openPayList');
    if (!openList.length) {
      el.innerHTML = '<div class="pay-empty">No open payments. Everything that was due has been handled.</div>';
      return;
    }
    el.innerHTML = openList.map(function (p) { return card(p, true); }).join('');
  }

  window.openOpenPayments = async function () {
    document.getElementById('openPayOverlay').classList.add('open');
    document.getElementById('openPayList').innerHTML = '<div class="pay-empty">Loading…</div>';
    await refreshOpenPayments();
    renderOpenModal();
  };
  window.closeOpenPayments = function () { document.getElementById('openPayOverlay').classList.remove('open'); };
  window.refreshOpenPayments = refreshOpenPayments;

  /* ---------- global history ---------- */
  async function loadHistory() {
    var tenant = document.getElementById('histTenant').value.trim();
    var month = document.getElementById('histMonth').value;
    var year = document.getElementById('histYear').value;
    var qs = new URLSearchParams({ view: 'history' });
    if (tenant) qs.set('tenant', tenant);
    if (month) qs.set('month', month);
    if (year) qs.set('year', year);
    var list = document.getElementById('histList');
    try {
      var rows = await api(API + '?' + qs.toString());
      var paidSum = 0;
      rows.forEach(function (r) { paidSum += num(r.paid_total); });
      document.getElementById('histSum').innerHTML = rows.length
        ? '<b>' + rows.length + '</b> payment period' + (rows.length === 1 ? '' : 's') + ' · Total paid <b>' + money(paidSum) + '</b>'
        : '';
      list.innerHTML = rows.length
        ? rows.map(function (p) { return card(p, true); }).join('')
        : '<div class="pay-empty">No payments found for this filter.</div>';
    } catch (err) {
      list.innerHTML = '<div class="pay-empty">Could not load the history.</div>';
    }
  }
  window.openHistory = function () {
    document.getElementById('histOverlay').classList.add('open');
    loadHistory();
  };
  window.closeHistory = function () { document.getElementById('histOverlay').classList.remove('open'); };
  function histChanged() { clearTimeout(histTimer); histTimer = setTimeout(loadHistory, 300); }
  document.getElementById('histTenant').addEventListener('input', histChanged);
  document.getElementById('histMonth').addEventListener('change', loadHistory);
  document.getElementById('histYear').addEventListener('input', histChanged);
  document.getElementById('histClear').addEventListener('click', function () {
    document.getElementById('histTenant').value = '';
    document.getElementById('histMonth').value = '';
    document.getElementById('histYear').value = '';
    loadHistory();
  });
  ['openPayOverlay', 'histOverlay'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      if (e.target.id === id) document.getElementById(id).classList.remove('open');
    });
  });

  /* ---------- per-property history tab ---------- */
  async function loadPropertyHistory(propId) {
    var box = document.getElementById('propHistoryList');
    if (!box) return;
    if (!propId) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="pay-empty">Loading…</div>';
    var head =
      '<div style="margin-bottom:12px;"><button type="button" class="pay-btn" data-act="pp-open">+ Add past payment</button></div>' +
      '<div class="pay-add" id="ppForm">' +
        '<div><label>Payment due date</label><input type="date" id="ppDue"></div>' +
        '<div><label>Expected (€)</label><input type="number" step="0.01" min="0" id="ppExpected"></div>' +
        '<div><label>Status</label><select id="ppStatus" style="font-family:Inter,sans-serif;border:1px solid var(--border);border-radius:8px;padding:8px 9px;font-size:13.5px;background:#fff;width:140px;">' +
          '<option value="paid">Paid</option><option value="partial">Partially paid</option><option value="unpaid">Not paid</option></select></div>' +
        '<div id="ppPayFields" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
          '<div><label>Date paid</label><input type="date" id="ppDate"></div>' +
          '<div><label>Amount paid (€)</label><input type="number" step="0.01" min="0" id="ppAmount"></div>' +
        '</div>' +
        '<button type="button" class="pay-btn ok" data-act="pp-save">Save</button>' +
        '<button type="button" class="pay-btn" data-act="pp-cancel">Cancel</button>' +
      '</div>';
    try {
      var rows = await api(API + '?view=history&property_id=' + encodeURIComponent(propId));
      box.innerHTML = head + (rows.length
        ? rows.map(function (p) { return card(p, false); }).join('')
        : '<div class="pay-empty">No payments yet. Payments appear here once a due date arrives (with "Track rent payments" turned on), or add a past payment above.</div>');
      document.getElementById('ppStatus').addEventListener('change', ppToggle);
    } catch (err) {
      box.innerHTML = head + '<div class="pay-empty">Could not load the history.</div>';
    }
  }
  window.loadPropertyHistory = loadPropertyHistory;

  var propHist = document.getElementById('propHistoryList');
  if (propHist) propHist.addEventListener('click', onAction);

  window.setPropTabs = function (isEdit, propId) {
    curPropId = isEdit ? propId : null;
    var tabs = document.getElementById('propTabs');
    if (tabs) tabs.style.display = isEdit ? 'flex' : 'none';
    window.propTab('details');
  };
  window.propTab = function (name) {
    var form = document.getElementById('propForm');
    var hist = document.getElementById('propHistoryBox');
    if (!form || !hist) return;
    var showHist = name === 'history' && curPropId;
    form.style.display = showHist ? 'none' : '';
    hist.style.display = showHist ? 'block' : 'none';
    document.querySelectorAll('.prop-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === (showHist ? 'history' : 'details'));
    });
    if (showHist) loadPropertyHistory(curPropId);
  };

  /* ---------- monthly summary ---------- */
  var sumDate = new Date();
  var sumRows = [];
  function sumRemaining(p) {
    if (p.status === 'paid') return 0;
    if (p.expected_amount === null || p.expected_amount === undefined) return 0;
    return Math.max(0, num(p.expected_amount) - num(p.paid_total));
  }
  async function loadSummary() {
    var y = sumDate.getFullYear();
    var m = sumDate.getMonth() + 1;
    document.getElementById('sumLabel').textContent = MONTHS[m - 1] + ' ' + y;
    document.getElementById('sumTip').classList.remove('show');
    var list = document.getElementById('sumList');
    try {
      sumRows = await api(API + '?view=history&month=' + m + '&year=' + y);
    } catch (err) {
      sumRows = [];
      list.innerHTML = '<div class="pay-empty">Could not load the summary.</div>';
      return;
    }
    var opening = 0, paid = 0, out = 0;
    sumRows.forEach(function (p) {
      opening += num(p.expected_amount);
      paid += num(p.paid_total);
      out += sumRemaining(p);
    });
    document.getElementById('sumOpen').textContent = money(opening);
    document.getElementById('sumPaid').textContent = money(paid);
    document.getElementById('sumOut').textContent = money(out);
    list.innerHTML = sumRows.length
      ? sumRows.map(function (p) { return card(p, true); }).join('')
      : '<div class="pay-empty">No payments came due in this month.</div>';
  }
  function statusText(s) {
    return { paid: 'Paid', partial: 'Partially paid', unpaid: 'Not paid', open: 'Open' }[s] || s;
  }
  function showSumTip() {
    var tip = document.getElementById('sumTip');
    var unpaid = sumRows.filter(function (p) { return sumRemaining(p) > 0 || p.status === 'unpaid' || p.status === 'open'; })
      .filter(function (p) { return p.status !== 'paid'; });
    var total = 0;
    var html = unpaid.map(function (p) {
      var r = sumRemaining(p);
      total += r;
      return '<div class="r"><span>' + esc(p.property_name) + ' · ' + esc(p.contact_name || '—') + '</span><b>' + money(r) + '</b></div>';
    }).join('');
    tip.innerHTML = '<div class="t">Not yet paid (' + unpaid.length + ') — ' + money(total) + ' outstanding</div>' +
      (html || '<div class="r"><span>Everything is paid.</span></div>');
    tip.classList.toggle('show');
  }
  function sumTitle() {
    return MONTHS[sumDate.getMonth()] + ' ' + sumDate.getFullYear();
  }
  function sumPrint() {
    var rows = sumRows.map(function (p) {
      return '<tr><td>' + esc(p.property_name) + '</td><td>' + esc(p.contact_name || '') + '</td><td>' + dateTxt(p.due_date) +
        '</td><td style="text-align:right">' + money(p.expected_amount) + '</td><td style="text-align:right">' + money(p.paid_total) +
        '</td><td style="text-align:right">' + money(sumRemaining(p)) + '</td><td>' + statusText(p.status) + '</td></tr>';
    }).join('');
    var w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to print.'); return; }
    w.document.write('<html><head><title>Monthly summary - ' + sumTitle() + '</title><style>' +
      'body{font-family:Arial,sans-serif;padding:24px;color:#111008}h1{font-size:20px;margin:0 0 4px}p{color:#6B6560;margin:0 0 16px;font-size:13px}' +
      'table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border:1px solid #D6D0C8;padding:7px 9px;text-align:left}th{background:#EEF3F8}' +
      '.tot{margin-top:14px;font-size:14px}</style></head><body>' +
      '<h1>Ficus Investments — Monthly Rent Summary</h1><p>' + sumTitle() + '</p>' +
      '<table><thead><tr><th>Property</th><th>Tenant</th><th>Due</th><th>Expected</th><th>Paid</th><th>Remaining</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="tot">Opening balance: <b>' + document.getElementById('sumOpen').textContent + '</b> · Paid: <b>' +
      document.getElementById('sumPaid').textContent + '</b> · Outstanding: <b>' + document.getElementById('sumOut').textContent + '</b></div>' +
      '</body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 300);
  }
  function csvCell(v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }
  function sumExcel() {
    var lines = [['Property', 'Tenant', 'Due date', 'Expected', 'Paid', 'Remaining', 'Status'].map(csvCell).join(',')];
    sumRows.forEach(function (p) {
      lines.push([p.property_name, p.contact_name || '', p.due_date, num(p.expected_amount).toFixed(2), num(p.paid_total).toFixed(2),
        sumRemaining(p).toFixed(2), statusText(p.status)].map(csvCell).join(','));
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'monthly-summary-' + sumDate.getFullYear() + '-' + String(sumDate.getMonth() + 1).padStart(2, '0') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  window.openSummary = function () {
    sumDate = new Date();
    sumDate.setDate(1);
    document.getElementById('sumOverlay').classList.add('open');
    loadSummary();
  };
  window.closeSummary = function () { document.getElementById('sumOverlay').classList.remove('open'); };
  document.getElementById('sumPrev').addEventListener('click', function () { sumDate.setMonth(sumDate.getMonth() - 1); loadSummary(); });
  document.getElementById('sumNext').addEventListener('click', function () { sumDate.setMonth(sumDate.getMonth() + 1); loadSummary(); });
  document.getElementById('sumBad').addEventListener('click', showSumTip);
  document.getElementById('sumPrint').addEventListener('click', sumPrint);
  document.getElementById('sumExcel').addEventListener('click', sumExcel);
  document.getElementById('sumEmail').addEventListener('click', function () {
    alert('Email summary will be connected in the next update.');
  });
  document.getElementById('sumList').addEventListener('click', onAction);
  document.getElementById('sumOverlay').addEventListener('click', function (e) {
    if (e.target.id === 'sumOverlay') window.closeSummary();
  });

  /* ---------- add payment from the summary ---------- */
  function spProperty() {
    var id = Number(document.getElementById('spProp').value);
    try {
      return properties.find(function (x) { return x.id === id; }) || null;
    } catch (err) { return null; }
  }
  function spDefaults() {
    var pr = spProperty();
    var t = pr && typeof totalWithTax === 'function' ? totalWithTax(pr) : null;
    var v = t === null || t === undefined ? '' : t;
    document.getElementById('spExpected').value = v;
    document.getElementById('spAmount').value = v;
  }
  function spToggle() {
    var unpaid = document.getElementById('spStatus').value === 'unpaid';
    document.getElementById('spPayFields').style.display = unpaid ? 'none' : 'flex';
  }
  document.getElementById('spOpen').addEventListener('click', function () {
    var sel = document.getElementById('spProp');
    var list = [];
    try { list = properties.slice(); } catch (err) {}
    if (!list.length) { alert('No properties found.'); return; }
    sel.innerHTML = list.map(function (x) {
      return '<option value="' + x.id + '">' + esc(x.property_name) + (x.contact_name ? ' — ' + esc(x.contact_name) : '') + '</option>';
    }).join('');
    document.getElementById('spForm').classList.add('show');
    var first = new Date(sumDate.getFullYear(), sumDate.getMonth(), 1);
    document.getElementById('spDue').value = first.getFullYear() + '-' + String(first.getMonth() + 1).padStart(2, '0') + '-01';
    document.getElementById('spStatus').value = 'paid';
    document.getElementById('spDate').value = todayIso();
    spDefaults();
    spToggle();
  });
  document.getElementById('spProp').addEventListener('change', spDefaults);
  document.getElementById('spStatus').addEventListener('change', spToggle);
  document.getElementById('spCancel').addEventListener('click', function () {
    document.getElementById('spForm').classList.remove('show');
  });
  document.getElementById('spSave').addEventListener('click', async function () {
    var pid = Number(document.getElementById('spProp').value);
    var due = document.getElementById('spDue').value;
    var st = document.getElementById('spStatus').value;
    var exp = document.getElementById('spExpected').value;
    var pdate = document.getElementById('spDate').value;
    var pamt = Number(document.getElementById('spAmount').value);
    if (!pid) { alert('Please choose a property.'); return; }
    if (!due) { alert('Please choose the payment due date.'); return; }
    if (st !== 'unpaid') {
      if (!pdate) { alert('Please choose the date the payment was made.'); return; }
      if (!(pamt > 0)) { alert('Please enter the amount paid.'); return; }
    }
    try {
      await post({
        action: 'create_period', property_id: pid, due_date: due, status: st,
        expected_amount: exp === '' ? null : Number(exp),
        paid_date: st === 'unpaid' ? null : pdate, amount: st === 'unpaid' ? null : pamt
      });
      document.getElementById('spForm').classList.remove('show');
      // show the month of the payment that was just added
      var dd = new Date(due + 'T00:00:00');
      sumDate = new Date(dd.getFullYear(), dd.getMonth(), 1);
      await refreshOpenPayments();
      await loadSummary();
    } catch (err) {
      alert(err.message || 'Something went wrong.');
    }
  });

  /* ---------- dates: day / month name / year selects (value stays in the hidden date input) ---------- */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function buildDate(inp) {
    var box = document.createElement('div');
    box.className = 'dsel';
    var d = document.createElement('select'), m = document.createElement('select'), y = document.createElement('select');
    d.innerHTML = '<option value="">Day</option>';
    for (var i = 1; i <= 31; i++) d.innerHTML += '<option value="' + i + '">' + i + '</option>';
    m.innerHTML = '<option value="">Month</option>' + MONTHS.map(function (n, k) { return '<option value="' + (k + 1) + '">' + n + '</option>'; }).join('');
    y.innerHTML = '<option value="">Year</option>';
    for (var yy = 2015; yy <= 2035; yy++) y.innerHTML += '<option value="' + yy + '">' + yy + '</option>';
    [d, m, y].forEach(function (el) {
      el.addEventListener('change', function () {
        if (d.value && m.value && y.value) {
          var dim = new Date(Number(y.value), Number(m.value), 0).getDate();
          inp.value = y.value + '-' + pad2(m.value) + '-' + pad2(Math.min(Number(d.value), dim));
        } else {
          inp.value = '';
        }
        inp._last = inp.value;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
      box.appendChild(el);
    });
    inp.style.display = 'none';
    inp.parentNode.insertBefore(box, inp.nextSibling);
    inp._dsel = { d: d, m: m, y: y };
    inp._last = '\u0000';
  }
  function syncDates() {
    document.querySelectorAll('input[type=date]').forEach(function (inp) {
      if (!inp._dsel) buildDate(inp);
      if (inp.value === inp._last) return;
      inp._last = inp.value;
      var s = inp._dsel;
      var p = inp.value ? inp.value.split('-') : ['', '', ''];
      s.y.value = p[0] ? String(Number(p[0])) : '';
      s.m.value = p[1] ? String(Number(p[1])) : '';
      s.d.value = p[2] ? String(Number(p[2])) : '';
    });
  }
  setInterval(syncDates, 300);

  // header button (added here so index.html does not need to change)
  (function () {
    var bar = document.querySelector('.header-actions');
    if (!bar) return;
    var b = document.createElement('button');
    b.className = 'btn-pill';
    b.type = 'button';
    b.textContent = 'Monthly summary';
    b.addEventListener('click', window.openSummary);
    bar.insertBefore(b, bar.children[1] ? bar.children[1] : null);
  })();

  /* ---------- refresh everything visible ---------- */
  async function refreshAll() {
    await refreshOpenPayments();
    if (document.getElementById('openPayOverlay').classList.contains('open')) renderOpenModal();
    if (document.getElementById('histOverlay').classList.contains('open')) await loadHistory();
    if (document.getElementById('sumOverlay').classList.contains('open')) await loadSummary();
    var hb = document.getElementById('propHistoryBox');
    if (hb && hb.style.display === 'block' && curPropId) await loadPropertyHistory(curPropId);
  }
})();

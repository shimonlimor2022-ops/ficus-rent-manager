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
    '.pay-badge{display:inline-block;min-width:18px;padding:1px 6px;border-radius:99px;background:var(--danger);color:#fff;font-size:11px;font-weight:700;text-align:center;}'
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

  /* ---------- refresh everything visible ---------- */
  async function refreshAll() {
    await refreshOpenPayments();
    if (document.getElementById('openPayOverlay').classList.contains('open')) renderOpenModal();
    if (document.getElementById('histOverlay').classList.contains('open')) await loadHistory();
    var hb = document.getElementById('propHistoryBox');
    if (hb && hb.style.display === 'block' && curPropId) await loadPropertyHistory(curPropId);
  }
})();

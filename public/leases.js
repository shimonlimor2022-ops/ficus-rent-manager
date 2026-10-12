/* Ficus Investments - lease expiry tracking (open leases, history). */
(function () {
  var API = '/api/leases';
  var openList = [];
  var tab = 'open';
  window.latestLeaseByProp = {};

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dateTxt(s) {
    if (!s) return '—';
    return new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function daysFromToday(s) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var d = new Date(String(s).slice(0, 10) + 'T00:00:00');
    return Math.round((d - t) / 86400000);
  }
  function plusYear(s) {
    var d = new Date(String(s).slice(0, 10) + 'T00:00:00');
    d.setFullYear(d.getFullYear() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="overlay" id="leaseOverlay"><div class="modal" style="max-width:720px;">' +
      '<h2>Lease expiry</h2>' +
      '<div class="prop-tabs" style="display:flex;">' +
        '<button type="button" class="prop-tab active" id="leaseTabOpen">Open</button>' +
        '<button type="button" class="prop-tab" id="leaseTabHistory">History</button>' +
      '</div>' +
      '<div class="settings-hint" id="leaseHint">When a lease expires it stays here until you mark it renewed or not renewed.</div>' +
      '<div id="leaseList"></div>' +
      '<div class="modal-actions"><button type="button" class="btn-secondary" onclick="closeLeases()">Close</button></div>' +
    '</div></div>';
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

  function pill(status) {
    if (status === 'renewed') return '<span class="pill pill-ok">Renewed</span>';
    if (status === 'not_renewed') return '<span class="pill pill-muted">Not renewed</span>';
    return '<span class="pill pill-danger">Needs action</span>';
  }

  function card(p) {
    var late = '';
    if (p.status === 'open') {
      var d = Math.abs(daysFromToday(p.expiry_date));
      late = ' <span class="pay-over">Expired ' + d + ' day' + (d === 1 ? '' : 's') + ' ago</span>';
    }
    var nums = 'Expiry date <b>' + dateTxt(p.expiry_date) + '</b>' + late +
      (p.status === 'renewed' && p.new_expiry_date ? ' · Renewed until <b>' + dateTxt(p.new_expiry_date) + '</b>' : '');
    var actions = '';
    if (p.status === 'open') {
      actions =
        '<button type="button" class="pay-btn ok" data-lact="renew-open">Renewed</button>' +
        '<button type="button" class="pay-btn bad" data-lact="notrenew">Not renewed</button>';
    } else if (p.status === 'not_renewed') {
      actions = '<button type="button" class="pay-btn" data-lact="reopen">Reopen</button>';
    }
    return '<div class="pay-card" data-lid="' + p.id + '" data-exp="' + esc(p.expiry_date) + '">' +
      '<div class="pay-top"><div><div class="prop-name">' + esc(p.property_name) + '</div><div class="contact-sub">' + esc(p.contact_name || '—') + '</div></div>' + pill(p.status) + '</div>' +
      '<div class="pay-nums">' + nums + '</div>' +
      (actions ? '<div class="pay-actions">' + actions + '</div>' : '') +
      '<div class="pay-add">' +
        '<div><label>New expiry date</label><input type="date" class="l-date"></div>' +
        '<button type="button" class="pay-btn ok" data-lact="renew-save">Save</button>' +
        '<button type="button" class="pay-btn" data-lact="renew-cancel">Cancel</button>' +
      '</div>' +
    '</div>';
  }

  async function render() {
    var el = document.getElementById('leaseList');
    el.innerHTML = '<div class="pay-empty">Loading…</div>';
    document.getElementById('leaseHint').style.display = tab === 'open' ? '' : 'none';
    try {
      var rows = tab === 'open' ? openList : await api(API + '?view=history');
      if (!rows.length) {
        el.innerHTML = '<div class="pay-empty">' + (tab === 'open'
          ? 'No open leases. Nothing has expired that needs your decision.'
          : 'No lease history yet.') + '</div>';
        return;
      }
      el.innerHTML = rows.map(card).join('');
    } catch (err) {
      el.innerHTML = '<div class="pay-empty">Could not load the leases.</div>';
    }
  }

  async function refreshLeases() {
    try {
      openList = await api(API + '?view=open');
    } catch (err) {
      openList = [];
    }
    try {
      var latest = await api(API + '?view=latest');
      var map = {};
      latest.forEach(function (r) { map[r.property_id] = r; });
      window.latestLeaseByProp = map;
    } catch (err) {}
    var badge = document.getElementById('openLeaseBadge');
    if (badge) {
      badge.textContent = openList.length;
      badge.style.display = openList.length ? 'inline-block' : 'none';
    }
    if (typeof window.render === 'function') window.render();
  }

  async function afterChange() {
    await refreshLeases();
    if (typeof window.load === 'function') window.load();
    if (document.getElementById('leaseOverlay').classList.contains('open')) await render();
  }

  document.getElementById('leaseList').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-lact]');
    if (!btn) return;
    var cardEl = btn.closest('.pay-card');
    var act = btn.getAttribute('data-lact');
    var id = Number(cardEl.getAttribute('data-lid'));
    try {
      if (act === 'renew-open') {
        cardEl.querySelector('.pay-add').classList.add('show');
        cardEl.querySelector('.l-date').value = plusYear(cardEl.getAttribute('data-exp'));
        return;
      }
      if (act === 'renew-cancel') { cardEl.querySelector('.pay-add').classList.remove('show'); return; }
      if (act === 'renew-save') {
        var nd = cardEl.querySelector('.l-date').value;
        if (!nd) { alert('Please choose the new expiry date.'); return; }
        await post({ action: 'set_status', period_id: id, status: 'renewed', new_expiry_date: nd });
      } else if (act === 'notrenew') {
        if (!confirm('Mark this lease as NOT renewed?')) return;
        await post({ action: 'set_status', period_id: id, status: 'not_renewed' });
      } else if (act === 'reopen') {
        await post({ action: 'set_status', period_id: id, status: 'open' });
      } else { return; }
      await afterChange();
    } catch (err) {
      alert(err.message || 'Something went wrong.');
    }
  });

  function setTab(t) {
    tab = t;
    document.getElementById('leaseTabOpen').classList.toggle('active', t === 'open');
    document.getElementById('leaseTabHistory').classList.toggle('active', t === 'history');
    render();
  }
  document.getElementById('leaseTabOpen').addEventListener('click', function () { setTab('open'); });
  document.getElementById('leaseTabHistory').addEventListener('click', function () { setTab('history'); });

  window.openLeases = async function () {
    document.getElementById('leaseOverlay').classList.add('open');
    await refreshLeases();
    setTab('open');
  };
  window.closeLeases = function () { document.getElementById('leaseOverlay').classList.remove('open'); };
  window.refreshLeases = refreshLeases;
  document.getElementById('leaseOverlay').addEventListener('click', function (e) {
    if (e.target.id === 'leaseOverlay') window.closeLeases();
  });

  // header button
  (function () {
    var bar = document.querySelector('.header-actions');
    if (!bar) return;
    var b = document.createElement('button');
    b.className = 'btn-pill';
    b.type = 'button';
    b.innerHTML = 'Lease expiry <span class="pay-badge" id="openLeaseBadge" style="display:none;">0</span>';
    b.addEventListener('click', window.openLeases);
    var after = null;
    Array.prototype.forEach.call(bar.children, function (c) {
      if (c.textContent.trim() === 'Payment history') after = c;
    });
    if (after) bar.insertBefore(b, after.nextSibling); else bar.appendChild(b);
  })();

  refreshLeases();
})();

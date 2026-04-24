// production-report.js — Production Report / Master Dashboard (Phase C)
//
// Read-only dashboard that joins Live Fish Intake + Production Log into
// one manager/owner view. Three tabs:
//
//   📊 Summary   — hero metrics for a chosen period (intake, production, yield)
//   🚜 Farmers   — scorecard table (volume, $ paid, avg size, deductions)
//   📈 Trends    — daily charts (intake lbs, production lbs, payments)
//
// Period presets: This Week (Sun-Sat), Last 7 Days, Month-to-Date,
// Year-to-Date, and a Custom range. Printable via the shared printReport().
//
// All three server actions (get_summary, get_farmers, get_trends) hit
// /api/production-report with the same start/end params.

(function () {
  var _prs = {
    tab: 'summary',
    preset: 'this_week',
    start: '',
    end: '',
    summary: null,
    farmers: null,
    trends: null,
    farmerSort: { field: 'net_lbs', dir: 'desc' },
    charts: {} // holds Chart.js instances so we can destroy on redraw
  };

  var BTN = 'padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
  var BTN_P = BTN + ';background:#1a3a6b;color:#fff';
  var BTN_SUB = BTN + ';background:#f1f5f9;color:#334155';
  var BTN_ACT = BTN + ';background:#1e40af;color:#fff';

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isoDate(d) { return d.toISOString().split('T')[0]; }
  function fmtLbs(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' lbs';
  }
  function fmtNum(n, opts) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', opts || { maximumFractionDigits: 0 });
  }
  function fmtMoney(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPrice(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toFixed(3) + '/lb';
  }
  function fmtPct(n, digits) {
    if (n == null || n === '' || isNaN(n)) return '—';
    return Number(n).toFixed(digits == null ? 1 : digits) + '%';
  }
  function prettyDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function prettyFullDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Resolve a preset into a concrete { start, end } range. All dates are ISO
  // YYYY-MM-DD in local time (the server interprets them as date-only, no TZ
  // math needed).
  function resolvePreset(preset) {
    var now = new Date();
    var today = isoDate(now);
    if (preset === 'this_week') {
      var d = new Date(now); d.setDate(d.getDate() - d.getDay()); // Sunday
      var sat = new Date(d); sat.setDate(sat.getDate() + 6);
      return { start: isoDate(d), end: isoDate(sat) };
    }
    if (preset === 'last_7') {
      var seven = new Date(now); seven.setDate(seven.getDate() - 6);
      return { start: isoDate(seven), end: today };
    }
    if (preset === 'last_30') {
      var thirty = new Date(now); thirty.setDate(thirty.getDate() - 29);
      return { start: isoDate(thirty), end: today };
    }
    if (preset === 'mtd') {
      var mStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: isoDate(mStart), end: today };
    }
    if (preset === 'ytd') {
      var yStart = new Date(now.getFullYear(), 0, 1);
      return { start: isoDate(yStart), end: today };
    }
    // Default: last 7
    var fallback = new Date(now); fallback.setDate(fallback.getDate() - 6);
    return { start: isoDate(fallback), end: today };
  }

  // ═══ ENTRY ═════════════════════════════════════════════════════════════
  function buildProductionReportWidget() {
    var wt = document.getElementById('widget-tabs');
    var tabs = [
      { id: 'summary',  label: '📊 Summary' },
      { id: 'farmers',  label: '🚜 Farmers' },
      { id: 'trends',   label: '📈 Trends' }
    ];
    wt.innerHTML = tabs.map(function (t) {
      return '<button class="wtab" id="prs-tab-' + t.id + '" onclick="prsShowTab(\'' + t.id + '\')" '
        + 'style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;'
        + 'border-bottom:2px solid transparent;color:#94a3b8">' + t.label + '</button>';
    }).join('');

    if (!_prs.start || !_prs.end) {
      var r = resolvePreset(_prs.preset);
      _prs.start = r.start;
      _prs.end = r.end;
    }
    prsShowTab('summary');
  }

  function prsShowTab(tab) {
    _prs.tab = tab;
    ['summary', 'farmers', 'trends'].forEach(function (t) {
      var btn = document.getElementById('prs-tab-' + t);
      if (!btn) return;
      var active = (t === tab);
      btn.style.color = active ? '#1a3a6b' : '#94a3b8';
      btn.style.borderBottomColor = active ? '#1a3a6b' : 'transparent';
    });
    prsLoadAndRender();
  }

  // ── Top bar: period selector + print ─────────────────────────────────
  function periodBar() {
    var opts = [
      { k: 'this_week', label: 'This Week' },
      { k: 'last_7',    label: 'Last 7d' },
      { k: 'last_30',   label: 'Last 30d' },
      { k: 'mtd',       label: 'Month' },
      { k: 'ytd',       label: 'YTD' },
      { k: 'custom',    label: 'Custom' }
    ];
    var html = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px;background:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">';
    opts.forEach(function (o) {
      var active = (_prs.preset === o.k);
      html += '<button onclick="prsSetPreset(\'' + o.k + '\')" style="'
        + (active ? BTN_ACT : BTN_SUB) + '">' + o.label + '</button>';
    });
    // Custom date inputs only visible when preset === 'custom'
    if (_prs.preset === 'custom') {
      html += '<div style="display:flex;gap:6px;align-items:center;margin-left:8px">'
        + '<input type="date" id="prs-start" value="' + esc(_prs.start) + '" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.78rem">'
        + '<span style="color:#64748b;font-size:.78rem">→</span>'
        + '<input type="date" id="prs-end" value="' + esc(_prs.end) + '" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:.78rem">'
        + '<button onclick="prsApplyCustom()" style="' + BTN_P + '">Apply</button>'
        + '</div>';
    }
    html += '<div style="flex:1"></div>'
      + '<div style="font-size:.78rem;color:#64748b;font-weight:600">'
      + prettyFullDate(_prs.start) + ' – ' + prettyFullDate(_prs.end)
      + '</div>'
      + '<button onclick="prsPrintCurrent()" style="' + BTN_SUB + ';margin-left:8px" title="Print this report">🖨️ Print</button>'
      + '</div>';
    return html;
  }

  function prsSetPreset(k) {
    _prs.preset = k;
    if (k !== 'custom') {
      var r = resolvePreset(k);
      _prs.start = r.start;
      _prs.end = r.end;
    }
    prsLoadAndRender();
  }
  function prsApplyCustom() {
    var s = document.getElementById('prs-start');
    var e = document.getElementById('prs-end');
    if (!s || !e) return;
    if (!s.value || !e.value) { toast('⚠️ Pick both start and end dates'); return; }
    if (s.value > e.value) { toast('⚠️ Start must be on or before end'); return; }
    _prs.start = s.value;
    _prs.end = e.value;
    prsLoadAndRender();
  }

  // ── Dispatch + load ──────────────────────────────────────────────────
  function prsLoadAndRender() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    panel.innerHTML = periodBar()
      + '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading report…</div>';

    var qs = '?start=' + encodeURIComponent(_prs.start) + '&end=' + encodeURIComponent(_prs.end);
    if (_prs.tab === 'summary') {
      apiCall('GET', '/api/production-report?action=get_summary' + qs)
        .then(function (r) { _prs.summary = r; prsRenderSummary(); })
        .catch(function (err) { prsRenderError(err); });
    } else if (_prs.tab === 'farmers') {
      apiCall('GET', '/api/production-report?action=get_farmers' + qs)
        .then(function (r) { _prs.farmers = r; prsRenderFarmers(); })
        .catch(function (err) { prsRenderError(err); });
    } else if (_prs.tab === 'trends') {
      apiCall('GET', '/api/production-report?action=get_trends' + qs)
        .then(function (r) { _prs.trends = r; prsRenderTrends(); })
        .catch(function (err) { prsRenderError(err); });
    }
  }

  function prsRenderError(err) {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    panel.innerHTML = periodBar()
      + '<div style="padding:20px;color:#ef4444;background:#fef2f2;border-radius:8px">Failed to load: '
      + esc(err && err.message ? err.message : 'unknown error') + '</div>';
  }

  // ═══ SUMMARY TAB ═══════════════════════════════════════════════════════
  function prsRenderSummary() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    var r = _prs.summary || {};
    var ix = r.intake || {};
    var pr = r.production || {};
    var yd = r.yield || {};

    var html = periodBar();

    // Hero KPIs — 6 cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px">'
      + kpiCard('🐟 Fish Received',    fmtLbs(ix.net_lbs),               '#0369a1',
               (ix.load_count || 0) + ' load' + (ix.load_count === 1 ? '' : 's'))
      + kpiCard('💵 Paid to Farmers',  fmtMoney(ix.payable_total),       '#065f46',
               ix.avg_price_per_lb != null ? ('avg ' + fmtPrice(ix.avg_price_per_lb)) : 'no pricing')
      + kpiCard('✂️ Deductions',       fmtLbs(ix.deduction_lbs),          '#991b1b',
               ix.gross_lbs > 0 ? fmtPct(ix.deduction_lbs / ix.gross_lbs * 100) + ' of gross' : '—')
      + kpiCard('📦 Cases Produced',   fmtNum(pr.cases_produced),         '#1a3a6b',
               fmtLbs(pr.lbs_produced) + ' finished')
      + kpiCard('🚚 Cases Shipped',    fmtNum(pr.cases_shipped),          '#7c3aed',
               fmtLbs(pr.lbs_shipped) + ' out')
      + kpiCard('🎯 Yield',            yd.pct == null ? '—' : fmtPct(yd.pct),  '#1e40af',
               yd.pct == null ? 'need intake + production' : 'finished / net received')
      + '</div>';

    // Size band breakdown
    var sizeTotal = (ix.size_0_4_lbs || 0) + (ix.size_4_6_lbs || 0)
      + (ix.size_6_8_lbs || 0) + (ix.size_8_plus_lbs || 0);
    html += '<div style="background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<div style="font-size:.78rem;font-weight:700;color:#1a3a6b;margin-bottom:8px">📏 Size Breakdown</div>';
    if (sizeTotal > 0) {
      html += sizeBandStrip(ix.size_0_4_lbs, ix.size_4_6_lbs, ix.size_6_8_lbs, ix.size_8_plus_lbs);
    } else {
      html += '<div style="color:#94a3b8;font-size:.78rem;font-style:italic">No size-graded loads in this period.</div>';
    }
    html += '</div>';

    // Production by pool
    html += '<div style="background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<div style="font-size:.78rem;font-weight:700;color:#1a3a6b;margin-bottom:8px">📊 Production by Pool</div>';
    if (!pr.by_pool || pr.by_pool.length === 0) {
      html += '<div style="color:#94a3b8;font-size:.78rem;font-style:italic">No production logged in this period.</div>';
    } else {
      html += '<table style="width:100%;font-size:.82rem;border-collapse:collapse">'
        + '<thead><tr style="border-bottom:2px solid #e2e8f0">'
        + '<th style="text-align:left;padding:6px 8px">Pool</th>'
        + '<th style="text-align:right;padding:6px 8px">Cases Produced</th>'
        + '<th style="text-align:right;padding:6px 8px">Lbs Produced</th>'
        + '<th style="text-align:right;padding:6px 8px">Cases Shipped</th>'
        + '<th style="text-align:right;padding:6px 8px">Lbs Shipped</th>'
        + '</tr></thead><tbody>';
      pr.by_pool.forEach(function (p) {
        html += '<tr style="border-bottom:1px solid #f1f5f9">'
          + '<td style="padding:6px 8px;font-weight:600">' + esc(p.pool) + '</td>'
          + '<td style="padding:6px 8px;text-align:right">' + fmtNum(p.cases_produced) + '</td>'
          + '<td style="padding:6px 8px;text-align:right;color:#1a3a6b;font-weight:600">' + fmtLbs(p.lbs_produced) + '</td>'
          + '<td style="padding:6px 8px;text-align:right">' + fmtNum(p.cases_shipped) + '</td>'
          + '<td style="padding:6px 8px;text-align:right">' + fmtLbs(p.lbs_shipped) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // Yield disclaimer on short periods
    if (yd.pct != null) {
      var dayCount = daysBetween(r.period.start, r.period.end) + 1;
      if (dayCount < 5) {
        html += '<div style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:8px 12px;border-radius:6px;font-size:.74rem;margin-bottom:10px">'
          + '⚠️ Yield over short periods can be misleading — fish received today may not be processed until tomorrow. Look at weekly or longer for a reliable number.'
          + '</div>';
      }
    }

    panel.innerHTML = html;
  }

  function daysBetween(a, b) {
    var d1 = new Date(a + 'T00:00:00');
    var d2 = new Date(b + 'T00:00:00');
    return Math.round((d2 - d1) / 86400000);
  }

  function kpiCard(label, value, color, sub) {
    return '<div style="background:#fff;border-radius:10px;padding:12px 14px;box-shadow:0 1px 4px rgba(0,0,0,.08);border-left:4px solid ' + color + '">'
      + '<div style="font-size:.68rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em">' + label + '</div>'
      + '<div style="font-size:1.25rem;font-weight:700;color:' + color + ';margin-top:2px">' + value + '</div>'
      + (sub ? '<div style="font-size:.72rem;color:#94a3b8;margin-top:2px">' + sub + '</div>' : '')
      + '</div>';
  }

  function sizeBandStrip(s04, s46, s68, s8p) {
    var total = (s04 || 0) + (s46 || 0) + (s68 || 0) + (s8p || 0);
    var bands = [
      { label: '0–4 lb',     lbs: s04 || 0, color: '#0369a1' },
      { label: '4.01–5.99',  lbs: s46 || 0, color: '#0891b2' },
      { label: '6–7.99',     lbs: s68 || 0, color: '#059669' },
      { label: '8+ lb',      lbs: s8p || 0, color: '#ca8a04' }
    ];
    var bar = '<div style="display:flex;height:22px;border-radius:4px;overflow:hidden;background:#f1f5f9;margin-bottom:8px">';
    bands.forEach(function (b) {
      if (b.lbs <= 0) return;
      var pct = (b.lbs / total) * 100;
      bar += '<div title="' + b.label + ': ' + fmtLbs(b.lbs) + ' (' + pct.toFixed(1) + '%)" '
        + 'style="width:' + pct + '%;background:' + b.color + '"></div>';
    });
    bar += '</div>';
    var legend = '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:.74rem;color:#475569">';
    bands.forEach(function (b) {
      var pct = total > 0 ? ((b.lbs / total) * 100).toFixed(1) : '0';
      legend += '<div style="display:flex;align-items:center;gap:5px">'
        + '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + b.color + '"></span>'
        + '<span>' + b.label + ': <strong>' + fmtLbs(b.lbs) + '</strong> (' + pct + '%)</span>'
        + '</div>';
    });
    legend += '</div>';
    return bar + legend;
  }

  // ═══ FARMERS TAB ═══════════════════════════════════════════════════════
  function prsRenderFarmers() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    var r = _prs.farmers || {};
    var farmers = (r.farmers || []).slice();

    // Client-side sort (the API returns default net_lbs DESC)
    var sf = _prs.farmerSort.field;
    var sd = _prs.farmerSort.dir === 'asc' ? 1 : -1;
    farmers.sort(function (a, b) {
      var av = a[sf], bv = b[sf];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;     // nulls sort last regardless of dir
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * sd;
      return (av - bv) * sd;
    });

    var html = periodBar();

    if (farmers.length === 0) {
      html += '<div style="background:#fff;border-radius:10px;padding:40px 20px;text-align:center;color:#94a3b8;font-size:.88rem;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
        + 'No farmer intake loads recorded in this period.'
        + '</div>';
      panel.innerHTML = html;
      return;
    }

    html += '<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow-x:auto">'
      + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;min-width:760px">'
      + '<thead><tr style="background:#1a3a6b;color:#fff">'
      + sortHeader('Farmer', 'farmer_name', 'left')
      + sortHeader('Loads', 'load_count', 'right')
      + sortHeader('Net Lbs', 'net_lbs', 'right')
      + sortHeader('Avg Lbs/Load', 'avg_lbs_per_load', 'right')
      + sortHeader('Avg Fish Size', 'avg_fish_size_lbs', 'right')
      + sortHeader('Deductions', 'deduction_lbs', 'right')
      + sortHeader('Ded %', 'deduction_pct', 'right')
      + sortHeader('$ Paid', 'payable_total', 'right')
      + sortHeader('Avg $/lb', 'avg_price_per_lb', 'right')
      + '</tr></thead><tbody>';
    farmers.forEach(function (f) {
      var tagInactive = f.active === false
        ? ' <span style="font-size:.68rem;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px;font-weight:600">archived</span>'
        : '';
      html += '<tr style="border-bottom:1px solid #f1f5f9">'
        + '<td style="padding:8px 10px;font-weight:600"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(f.color || '#1a3a6b') + ';margin-right:8px"></span>'
        + esc(f.farmer_name) + tagInactive + '</td>'
        + '<td style="padding:8px 10px;text-align:right">' + fmtNum(f.load_count) + '</td>'
        + '<td style="padding:8px 10px;text-align:right;color:#1a3a6b;font-weight:700">' + fmtNum(f.net_lbs) + '</td>'
        + '<td style="padding:8px 10px;text-align:right">' + (f.avg_lbs_per_load != null ? fmtNum(f.avg_lbs_per_load) : '—') + '</td>'
        + '<td style="padding:8px 10px;text-align:right">' + (f.avg_fish_size_lbs != null ? Number(f.avg_fish_size_lbs).toFixed(1) + ' lb' : '—') + '</td>'
        + '<td style="padding:8px 10px;text-align:right;color:#991b1b">' + fmtNum(f.deduction_lbs) + '</td>'
        + '<td style="padding:8px 10px;text-align:right">' + (f.deduction_pct != null ? fmtPct(f.deduction_pct) : '—') + '</td>'
        + '<td style="padding:8px 10px;text-align:right;color:#065f46;font-weight:700">' + fmtMoney(f.payable_total) + '</td>'
        + '<td style="padding:8px 10px;text-align:right">' + (f.avg_price_per_lb != null ? fmtPrice(f.avg_price_per_lb) : '—') + '</td>'
        + '</tr>';
    });

    // Totals row
    var totals = farmers.reduce(function (acc, f) {
      acc.load_count += f.load_count || 0;
      acc.net_lbs += f.net_lbs || 0;
      acc.deduction_lbs += f.deduction_lbs || 0;
      acc.gross_lbs += f.gross_lbs || 0;
      acc.payable_lbs += f.payable_lbs || 0;
      acc.payable_total += f.payable_total || 0;
      return acc;
    }, { load_count: 0, net_lbs: 0, deduction_lbs: 0, gross_lbs: 0, payable_lbs: 0, payable_total: 0 });
    var totalAvgPrice = totals.payable_lbs > 0 ? totals.payable_total / totals.payable_lbs : null;
    var totalDedPct = totals.gross_lbs > 0 ? (totals.deduction_lbs / totals.gross_lbs) * 100 : null;
    var totalAvgLoad = totals.load_count > 0 ? totals.net_lbs / totals.load_count : null;

    html += '<tr style="background:#e0e7ff;font-weight:700;border-top:3px double #1a3a6b">'
      + '<td style="padding:9px 10px;color:#1a3a6b">TOTAL</td>'
      + '<td style="padding:9px 10px;text-align:right">' + fmtNum(totals.load_count) + '</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#1a3a6b">' + fmtNum(totals.net_lbs) + '</td>'
      + '<td style="padding:9px 10px;text-align:right">' + (totalAvgLoad != null ? fmtNum(totalAvgLoad) : '—') + '</td>'
      + '<td style="padding:9px 10px;text-align:right">—</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#991b1b">' + fmtNum(totals.deduction_lbs) + '</td>'
      + '<td style="padding:9px 10px;text-align:right">' + (totalDedPct != null ? fmtPct(totalDedPct) : '—') + '</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#065f46">' + fmtMoney(totals.payable_total) + '</td>'
      + '<td style="padding:9px 10px;text-align:right">' + (totalAvgPrice != null ? fmtPrice(totalAvgPrice) : '—') + '</td>'
      + '</tr>';

    html += '</tbody></table></div>';
    panel.innerHTML = html;
  }

  function sortHeader(label, field, align) {
    var arrow = '';
    if (_prs.farmerSort.field === field) {
      arrow = _prs.farmerSort.dir === 'asc' ? ' ▲' : ' ▼';
    }
    return '<th onclick="prsSortFarmers(\'' + field + '\')" style="padding:8px 10px;text-align:' + align
      + ';cursor:pointer;user-select:none;font-size:.74rem;font-weight:700">'
      + esc(label) + arrow + '</th>';
  }
  function prsSortFarmers(field) {
    if (_prs.farmerSort.field === field) {
      _prs.farmerSort.dir = _prs.farmerSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      _prs.farmerSort.field = field;
      // sensible default direction per column
      _prs.farmerSort.dir = (field === 'farmer_name') ? 'asc' : 'desc';
    }
    prsRenderFarmers();
  }

  // ═══ TRENDS TAB ════════════════════════════════════════════════════════
  function prsRenderTrends() {
    var panel = document.getElementById('widget-content');
    if (!panel) return;
    var t = _prs.trends || {};
    var labels = t.labels || [];

    var html = periodBar();

    if (labels.length === 0) {
      html += '<div style="background:#fff;border-radius:10px;padding:40px 20px;text-align:center;color:#94a3b8;font-size:.88rem;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
        + 'No data in this period.'
        + '</div>';
      panel.innerHTML = html;
      return;
    }

    html += '<div style="background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<div style="font-size:.88rem;font-weight:700;color:#1a3a6b;margin-bottom:8px">🐟 Daily Fish Intake (lbs)</div>'
      + '<canvas id="prs-chart-intake" height="80"></canvas>'
      + '</div>';

    html += '<div style="background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<div style="font-size:.88rem;font-weight:700;color:#1a3a6b;margin-bottom:8px">📦 Daily Production (finished lbs)</div>'
      + '<canvas id="prs-chart-prod" height="80"></canvas>'
      + '</div>';

    html += '<div style="background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
      + '<div style="font-size:.88rem;font-weight:700;color:#1a3a6b;margin-bottom:8px">💵 Daily Payments ($)</div>'
      + '<canvas id="prs-chart-pay" height="80"></canvas>'
      + '</div>';

    panel.innerHTML = html;

    // Pretty-print labels for the X axis: "Apr 18" not "2026-04-18"
    var prettyLabels = labels.map(prettyDate);

    withChartJs(function () {
      destroyCharts();
      _prs.charts.intake = renderBarChart('prs-chart-intake', prettyLabels, [
        { label: 'Net Received (lbs)', data: t.series.intake_net_lbs, color: '#0369a1' },
        { label: 'Deductions (lbs)',   data: t.series.intake_deductions, color: '#991b1b' }
      ]);
      _prs.charts.prod = renderLineChart('prs-chart-prod', prettyLabels, [
        { label: 'Produced (lbs)', data: t.series.prod_lbs, color: '#065f46' },
        { label: 'Shipped (lbs)',  data: t.series.prod_shipped_lbs, color: '#7c3aed' }
      ]);
      _prs.charts.pay = renderBarChart('prs-chart-pay', prettyLabels, [
        { label: 'Paid ($)', data: t.series.intake_paid, color: '#065f46' }
      ]);
    });
  }

  // Chart.js helpers — destroys + rebuilds on each tab load so stale canvases
  // don't pile up across period changes
  function destroyCharts() {
    Object.keys(_prs.charts).forEach(function (k) {
      var c = _prs.charts[k];
      if (c && typeof c.destroy === 'function') {
        try { c.destroy(); } catch (e) {}
      }
    });
    _prs.charts = {};
  }

  function withChartJs(cb) {
    if (typeof Chart !== 'undefined') { cb(); return; }
    // Use jsdelivr to match the site's CSP script-src allowlist. cdnjs is
    // blocked. index.html already loads Chart.js from the same host on
    // page boot so this fallback is defensive only.
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = cb;
    s.onerror = function () {
      toast('⚠️ Chart library failed to load');
    };
    document.head.appendChild(s);
  }

  function renderBarChart(canvasId, labels, datasets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    var ctx = canvas.getContext('2d');
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets.map(function (d) {
          return {
            label: d.label,
            data: d.data,
            backgroundColor: d.color,
            borderColor: d.color,
            borderWidth: 1
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.parsed.y || 0;
                return ctx.dataset.label + ': ' + v.toLocaleString();
              }
            }
          }
        },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  function renderLineChart(canvasId, labels, datasets) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    var ctx = canvas.getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets.map(function (d) {
          return {
            label: d.label,
            data: d.data,
            borderColor: d.color,
            backgroundColor: d.color + '33',
            tension: 0.25,
            fill: true,
            pointRadius: 2
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } }
        },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  // ═══ PRINT ═════════════════════════════════════════════════════════════
  // Build a self-contained HTML snapshot of the current tab and hand it to
  // the shared printReport() helper. We render tables (even for trends) in
  // the print view since Chart.js canvases don't transfer reliably across
  // window.open() — numbers are more valuable on paper anyway.
  function prsPrintCurrent() {
    var title, body = '';
    var periodStr = prettyFullDate(_prs.start) + ' – ' + prettyFullDate(_prs.end);

    if (_prs.tab === 'summary' && _prs.summary) {
      title = 'Production Report — Summary';
      body = buildPrintSummary(_prs.summary, periodStr);
    } else if (_prs.tab === 'farmers' && _prs.farmers) {
      title = 'Production Report — Farmer Scorecard';
      body = buildPrintFarmers(_prs.farmers, periodStr);
    } else if (_prs.tab === 'trends' && _prs.trends) {
      title = 'Production Report — Daily Trends';
      body = buildPrintTrends(_prs.trends, periodStr);
    } else {
      toast('⚠️ Load the tab first, then print.');
      return;
    }
    if (typeof printReport === 'function') {
      printReport(title, body);
    } else {
      toast('⚠️ Print helper not loaded');
    }
  }

  function buildPrintSummary(r, periodStr) {
    var ix = r.intake || {}, pr = r.production || {}, yd = r.yield || {};
    var sub = '<p style="margin-bottom:14px;color:#64748b">Period: <strong>' + esc(periodStr) + '</strong></p>';

    var kpi = '<table>'
      + '<tr><th>Metric</th><th>Value</th><th>Detail</th></tr>'
      + printRow('Fish Received',      fmtLbs(ix.net_lbs),            (ix.load_count || 0) + ' loads')
      + printRow('Paid to Farmers',    fmtMoney(ix.payable_total),    ix.avg_price_per_lb != null ? ('avg ' + fmtPrice(ix.avg_price_per_lb)) : '—')
      + printRow('Deductions',         fmtLbs(ix.deduction_lbs),      ix.gross_lbs > 0 ? fmtPct(ix.deduction_lbs / ix.gross_lbs * 100) + ' of gross' : '—')
      + printRow('Cases Produced',     fmtNum(pr.cases_produced),     fmtLbs(pr.lbs_produced) + ' finished')
      + printRow('Cases Shipped',      fmtNum(pr.cases_shipped),      fmtLbs(pr.lbs_shipped) + ' out')
      + printRow('Yield',              yd.pct == null ? '—' : fmtPct(yd.pct), 'finished / net received')
      + '</table>';

    var size = '';
    var sizeTotal = (ix.size_0_4_lbs || 0) + (ix.size_4_6_lbs || 0)
      + (ix.size_6_8_lbs || 0) + (ix.size_8_plus_lbs || 0);
    if (sizeTotal > 0) {
      size = '<h2 style="margin-top:22px;color:#1a3a6b;font-size:1rem">Size Breakdown</h2>'
        + '<table><tr><th>Band</th><th>Lbs</th><th>% of Total</th></tr>'
        + printSizeRow('0–4 lb',    ix.size_0_4_lbs,    sizeTotal)
        + printSizeRow('4.01–5.99', ix.size_4_6_lbs,    sizeTotal)
        + printSizeRow('6–7.99',    ix.size_6_8_lbs,    sizeTotal)
        + printSizeRow('8+ lb',     ix.size_8_plus_lbs, sizeTotal)
        + '</table>';
    }

    var pool = '';
    if (pr.by_pool && pr.by_pool.length) {
      pool = '<h2 style="margin-top:22px;color:#1a3a6b;font-size:1rem">Production by Pool</h2>'
        + '<table><tr><th>Pool</th><th>Cases Produced</th><th>Lbs Produced</th><th>Cases Shipped</th><th>Lbs Shipped</th></tr>';
      pr.by_pool.forEach(function (p) {
        pool += '<tr><td>' + esc(p.pool) + '</td><td>' + fmtNum(p.cases_produced) + '</td><td>' + fmtLbs(p.lbs_produced)
          + '</td><td>' + fmtNum(p.cases_shipped) + '</td><td>' + fmtLbs(p.lbs_shipped) + '</td></tr>';
      });
      pool += '</table>';
    }

    return sub + kpi + size + pool;
  }
  function printRow(label, value, sub) {
    return '<tr><td><strong>' + label + '</strong></td><td>' + value + '</td><td style="color:#64748b">' + sub + '</td></tr>';
  }
  function printSizeRow(label, v, total) {
    var n = Number(v) || 0;
    var pct = total > 0 ? (n / total * 100).toFixed(1) + '%' : '—';
    return '<tr><td>' + label + '</td><td>' + fmtLbs(n) + '</td><td>' + pct + '</td></tr>';
  }

  function buildPrintFarmers(r, periodStr) {
    var farmers = r.farmers || [];
    var sub = '<p style="margin-bottom:14px;color:#64748b">Period: <strong>' + esc(periodStr) + '</strong></p>';
    if (!farmers.length) return sub + '<p>No farmer intake loads recorded in this period.</p>';
    var html = sub + '<table>'
      + '<tr><th>Farmer</th><th>Loads</th><th>Net Lbs</th><th>Avg Lbs/Load</th><th>Avg Size</th>'
      + '<th>Deductions</th><th>Ded %</th><th>$ Paid</th><th>Avg $/lb</th></tr>';
    farmers.forEach(function (f) {
      html += '<tr>'
        + '<td>' + esc(f.farmer_name) + (f.active === false ? ' (archived)' : '') + '</td>'
        + '<td>' + fmtNum(f.load_count) + '</td>'
        + '<td>' + fmtNum(f.net_lbs) + '</td>'
        + '<td>' + (f.avg_lbs_per_load != null ? fmtNum(f.avg_lbs_per_load) : '—') + '</td>'
        + '<td>' + (f.avg_fish_size_lbs != null ? Number(f.avg_fish_size_lbs).toFixed(1) + ' lb' : '—') + '</td>'
        + '<td>' + fmtNum(f.deduction_lbs) + '</td>'
        + '<td>' + (f.deduction_pct != null ? fmtPct(f.deduction_pct) : '—') + '</td>'
        + '<td>' + fmtMoney(f.payable_total) + '</td>'
        + '<td>' + (f.avg_price_per_lb != null ? fmtPrice(f.avg_price_per_lb) : '—') + '</td>'
        + '</tr>';
    });
    html += '</table>';
    return html;
  }

  function buildPrintTrends(r, periodStr) {
    var labels = r.labels || [];
    var s = r.series || {};
    var sub = '<p style="margin-bottom:14px;color:#64748b">Period: <strong>' + esc(periodStr) + '</strong></p>';
    if (!labels.length) return sub + '<p>No data in this period.</p>';
    var html = sub + '<table>'
      + '<tr><th>Date</th><th>Loads</th><th>Net Lbs (intake)</th><th>Deductions</th><th>Paid ($)</th>'
      + '<th>Cases Produced</th><th>Lbs Produced</th><th>Lbs Shipped</th></tr>';
    labels.forEach(function (d, i) {
      html += '<tr>'
        + '<td>' + prettyDate(d) + '</td>'
        + '<td>' + fmtNum(s.intake_load_count[i]) + '</td>'
        + '<td>' + fmtNum(s.intake_net_lbs[i]) + '</td>'
        + '<td>' + fmtNum(s.intake_deductions[i]) + '</td>'
        + '<td>' + fmtMoney(s.intake_paid[i]) + '</td>'
        + '<td>' + fmtNum(s.prod_cases[i]) + '</td>'
        + '<td>' + fmtNum(s.prod_lbs[i]) + '</td>'
        + '<td>' + fmtNum(s.prod_shipped_lbs[i]) + '</td>'
        + '</tr>';
    });
    html += '</table>';
    return html;
  }

  // Expose globally for inline onclicks
  window.buildProductionReportWidget = buildProductionReportWidget;
  window.prsShowTab = prsShowTab;
  window.prsSetPreset = prsSetPreset;
  window.prsApplyCustom = prsApplyCustom;
  window.prsSortFarmers = prsSortFarmers;
  window.prsPrintCurrent = prsPrintCurrent;
})();

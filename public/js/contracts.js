// contracts.js — Union Contract widget (MVP)
//
// Three tabs:
//   📄 Contract        — at-a-glance facts + all articles + wage table
//   🤖 Ask the Lawyer  — scenario Q&A with preset buttons + free-text
//   📋 Consultation Log — saved Q&A pairs for reference
//
// Data flow: get_state pulls the active contract's extracted_data; ask_lawyer
// ships scenario text to /api/contracts, which loads the full contract and
// calls Claude to return structured guidance. Every ask auto-saves to the log.

(function () {
  var _cs = {
    tab: 'contract',
    contract: null,           // current contract row (metadata + extracted_data)
    has_seed: false,          // true if no contract yet but seed is bakable
    consultations: [],        // cached consultation log
    askLoading: false,
    lastResponse: null,       // last ask_lawyer response for inline render
    lastScenario: '',
    expandedArticleId: null,  // which article is open in the Contract tab
    expandedLogId: null       // which log row is expanded
  };

  var BTN = 'padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
  var BTN_P = BTN + ';background:#7c2d12;color:#fff';
  var BTN_SUB = BTN + ';background:#f1f5f9;color:#334155';
  var BTN_D = 'padding:2px 8px;border-radius:5px;border:none;cursor:pointer;font-size:.68rem;background:#fee2e2;color:#b91c1c';
  var INP = 'width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:.88rem;box-sizing:border-box';
  var CARD = 'background:#fff;border-radius:10px;padding:14px 16px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)';

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = (iso instanceof Date) ? iso : new Date(String(iso));
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function daysUntil(iso) {
    if (!iso) return null;
    var d = new Date(String(iso));
    if (isNaN(d.getTime())) return null;
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }
  function fmtDollar(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Number(n).toFixed(2);
  }

  // Preset scenarios (the "common HR problems" shortcuts)
  var PRESETS = [
    { title: 'No-call / no-show', prompt: 'An employee missed their scheduled shift three days in a row without calling in. What are our options under the contract?' },
    { title: 'Progressive discipline', prompt: 'A supervisor wants to issue a written warning for repeated tardiness. What does the contract require us to do, and what rights does the employee have?' },
    { title: 'Subcontracting', prompt: 'We have a large order that exceeds our processing capacity this week. Can we subcontract it out to another processor, and what conditions apply?' },
    { title: 'Overtime refusal', prompt: 'We need to schedule mandatory overtime this weekend. One of our senior employees doesn\'t want to work it. Can we require them to?' },
    { title: 'Holiday pay dispute', prompt: 'An employee missed the scheduled workday immediately before a holiday. Do we still have to pay holiday pay?' },
    { title: 'Suspected drug use', prompt: 'A supervisor smells alcohol on an employee\'s breath during their shift. What are our options? Do we need to follow progressive discipline?' },
    { title: 'Schedule change', prompt: 'We need to change the plant\'s start time from 6 AM to 5 AM starting Monday. How much notice must we give and can the Union block it?' },
    { title: 'Shutdown due to cold', prompt: 'Outdoor temperatures dropped below freezing and we can\'t run production today. Are we required to pay the crew?' },
    { title: 'Fish supply gap', prompt: 'A farmer cancelled tomorrow\'s scheduled delivery and we won\'t have enough fish to run. Do we still owe show-up pay or wages?' },
    { title: 'New job classification', prompt: 'We\'re creating a new position (e.g., quality control lead) that isn\'t in Appendix A. What process must we follow on pay rate?' },
    { title: 'Grievance filing', prompt: 'An employee claims we violated the contract when we denied their vacation request. Walk me through the grievance process and our obligations.' },
    { title: 'Layoff due to slow orders', prompt: 'We may need to lay off 15 production employees temporarily due to reduced orders. What seniority rules apply?' }
  ];

  // ═══ ENTRY ════════════════════════════════════════════════════════════
  function buildContractsWidget() {
    var wt = document.getElementById('widget-tabs');
    var tabs = [
      { id: 'contract', label: '📄 Contract' },
      { id: 'ask',      label: '🤖 Ask the Lawyer' },
      { id: 'log',      label: '📋 Log' }
    ];
    wt.innerHTML = tabs.map(function (t) {
      return '<button class="wtab" id="ct-tab-' + t.id + '" onclick="ctShowTab(\'' + t.id + '\')" '
        + 'style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;'
        + 'border-bottom:2px solid transparent;color:#94a3b8">' + t.label + '</button>';
    }).join('');
    ctShowTab('contract');
  }

  function ctShowTab(tab) {
    _cs.tab = tab;
    ['contract', 'ask', 'log'].forEach(function (t) {
      var btn = document.getElementById('ct-tab-' + t);
      if (!btn) return;
      var active = (t === tab);
      btn.style.color = active ? '#7c2d12' : '#94a3b8';
      btn.style.borderBottomColor = active ? '#7c2d12' : 'transparent';
    });
    if (tab === 'contract') loadContract();
    else if (tab === 'ask') renderAsk();
    else if (tab === 'log') loadLog();
  }

  // ═══ CONTRACT TAB ════════════════════════════════════════════════════
  function loadContract() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading contract…</div>';
    apiCall('GET', '/api/contracts?action=get_state').then(function (r) {
      _cs.contract = r.current || null;
      _cs.has_seed = !!r.has_seed_available;
      renderContract();
    }).catch(function (err) {
      panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed to load: ' + esc(err.message) + '</div>';
    });
  }

  function renderContract() {
    var panel = document.getElementById('widget-content');
    var isAdmin = (typeof userCan === 'function') && userCan('settings', 'view');

    if (!_cs.contract) {
      var html = '<div style="padding:20px;max-width:680px;margin:0 auto">';
      html += '<div style="' + CARD + ';text-align:center;padding:30px 20px">'
        + '<div style="font-size:2.2rem;margin-bottom:8px">⚖️</div>'
        + '<div style="font-weight:700;color:#7c2d12;font-size:1.05rem;margin-bottom:8px">No Union Contract Loaded</div>'
        + '<div style="font-size:.88rem;color:#475569;margin-bottom:14px">This widget is ready to store your current collective bargaining agreement. '
        + (_cs.has_seed && isAdmin
          ? 'Your 2025–2028 UFCW Local 1529 contract is pre-loaded on the server — one click to install:'
          : (isAdmin ? 'Use the Load button below once the seed is deployed.' : 'Ask an admin to install the current contract.'))
        + '</div>';
      if (_cs.has_seed && isAdmin) {
        html += '<button style="' + BTN_P + ';padding:10px 18px;font-size:.85rem" onclick="ctSeedCurrent()">⚡ Install 2025–2028 Contract</button>';
      }
      html += '</div></div>';
      panel.innerHTML = html;
      return;
    }

    var c = _cs.contract;
    var d = c.extracted_data || {};
    var days = daysUntil(c.expiration_date);
    var termBadge = days == null ? ''
      : days < 0 ? '<span style="background:#fecaca;color:#991b1b;padding:3px 9px;border-radius:10px;font-size:.7rem;font-weight:700">EXPIRED ' + Math.abs(days) + ' DAYS AGO</span>'
      : days < 120 ? '<span style="background:#fed7aa;color:#9a3412;padding:3px 9px;border-radius:10px;font-size:.7rem;font-weight:700">EXPIRES IN ' + days + ' DAYS</span>'
      : '<span style="background:#d1fae5;color:#065f46;padding:3px 9px;border-radius:10px;font-size:.7rem;font-weight:700">ACTIVE · ' + days + ' DAYS LEFT</span>';

    var html = '<div style="padding:14px;max-width:900px;margin:0 auto">';

    // Header card
    html += '<div style="' + CARD + ';border-left:4px solid #7c2d12">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">'
      + '<div>'
      + '<div style="font-weight:700;color:#7c2d12;font-size:1.1rem">' + esc(c.title) + '</div>'
      + '<div style="font-size:.82rem;color:#475569;margin-top:4px">' + esc(c.parties || '—') + '</div>'
      + '</div>' + termBadge + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:14px">'
      + ctFact('Effective', fmtDate(c.effective_date))
      + ctFact('Expires', fmtDate(c.expiration_date))
      + (d.term && d.term.wage_reopeners ? ctFact('Wage Reopeners', d.term.wage_reopeners.map(fmtDate).join(' · ')) : '')
      + (d.key_numbers ? ctFact('Probation', (d.key_numbers.probationary_period_days || '—') + ' days') : '')
      + '</div>'
      + '</div>';

    // Wages card
    if (d.wages && d.wages.table) {
      html += '<div style="' + CARD + '">'
        + '<div style="font-weight:700;color:#7c2d12;font-size:.95rem;margin-bottom:8px">💵 Wage Scale</div>'
        + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">'
        + '<thead><tr style="background:#fef3c7">'
        + '<th style="padding:6px 10px;text-align:left;color:#7c2d12">Tenure</th>';
      (d.wages.classifications || []).forEach(function (cl) {
        html += '<th style="padding:6px 10px;text-align:right;color:#7c2d12">' + esc(cl) + '</th>';
      });
      html += '</tr></thead><tbody>';
      (d.wages.table || []).forEach(function (r, i) {
        html += '<tr style="' + (i % 2 ? 'background:#fafbfc' : '') + '">'
          + '<td style="padding:5px 10px;color:#0f172a;font-weight:500">' + esc(r.tenure) + '</td>'
          + '<td style="padding:5px 10px;text-align:right;color:#0f172a">' + fmtDollar(r.production) + '</td>'
          + '<td style="padding:5px 10px;text-align:right;color:#0f172a">' + fmtDollar(r.skilled) + '</td>'
          + '<td style="padding:5px 10px;text-align:right;color:#0f172a">' + fmtDollar(r.leaders) + '</td>'
          + '<td style="padding:5px 10px;text-align:right;color:#0f172a">' + fmtDollar(r.maintenance) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
      if (d.wages.trimmer_incentives) {
        html += '<div style="margin-top:10px;font-size:.78rem;color:#475569"><strong>Trimmer incentives:</strong> ';
        html += d.wages.trimmer_incentives.map(function (t) {
          return t.min_lbs_per_hour + '+ lbs/hr = ' + fmtDollar(t.bonus_per_hour) + '/hr';
        }).join(' · ');
        html += '. Night premium: ' + fmtDollar(d.wages.night_premium_per_hour || 0) + '/hr.</div>';
      }
      html += '</div>';
    }

    // Key facts card
    if (d.key_numbers) {
      html += '<div style="' + CARD + '">'
        + '<div style="font-weight:700;color:#7c2d12;font-size:.95rem;margin-bottom:8px">📐 Key Thresholds</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px;font-size:.82rem">';
      var keyLabels = {
        probationary_period_days: 'Probationary period',
        daily_hour_cap: 'Daily hour cap',
        weekly_ot_threshold: 'OT threshold / week',
        show_up_pay_hours: 'Show-up pay',
        written_reprimand_expiration_months: 'Reprimand expires',
        layoff_max_seniority_months: 'Max layoff w/ seniority',
        compensable_injury_seniority_months: 'Injury leave w/ seniority',
        leave_of_absence_max_months: 'Max leave of absence',
        no_call_no_show_days_to_lose_seniority: 'No-call / no-show limit',
        grievance_first_step_days: 'Grievance 1st step',
        arbitration_notice_days: 'Arbitration notice',
        perfect_attendance_weekly_bonus_per_hour: 'Perfect attendance (wk)',
        perfect_attendance_yearly_bonus: 'Perfect attendance (yr)'
      };
      var units = {
        probationary_period_days: ' days', daily_hour_cap: ' hrs', weekly_ot_threshold: ' hrs',
        show_up_pay_hours: ' hrs', written_reprimand_expiration_months: ' months',
        layoff_max_seniority_months: ' months', compensable_injury_seniority_months: ' months',
        leave_of_absence_max_months: ' months', no_call_no_show_days_to_lose_seniority: ' days',
        grievance_first_step_days: ' days', arbitration_notice_days: ' days',
        perfect_attendance_weekly_bonus_per_hour: '/hr',
        perfect_attendance_yearly_bonus: ''
      };
      Object.keys(keyLabels).forEach(function (k) {
        if (d.key_numbers[k] != null) {
          var val = d.key_numbers[k];
          var isMoney = k.indexOf('bonus') >= 0;
          var display = isMoney ? fmtDollar(val) : val;
          html += '<div style="padding:5px 8px;background:#f8fafc;border-radius:5px">'
            + '<span style="color:#64748b">' + esc(keyLabels[k]) + ':</span> '
            + '<strong style="color:#0f172a">' + display + (units[k] || '') + '</strong>'
            + '</div>';
        }
      });
      html += '</div></div>';
    }

    // Holidays
    if (d.holidays && d.holidays.length) {
      html += '<div style="' + CARD + '">'
        + '<div style="font-weight:700;color:#7c2d12;font-size:.95rem;margin-bottom:8px">🎄 Recognized Holidays (' + d.holidays.length + ')</div>'
        + '<div style="font-size:.82rem;color:#334155;line-height:1.6">' + d.holidays.map(esc).join(' · ') + '</div>'
        + '</div>';
    }

    // Articles list (click to expand)
    if (d.articles && d.articles.length) {
      html += '<div style="' + CARD + ';padding:0;overflow:hidden">'
        + '<div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#7c2d12;font-size:.95rem">'
        + '📑 All Articles (' + d.articles.length + ') · click to expand'
        + '</div>';
      d.articles.forEach(function (a) {
        var open = _cs.expandedArticleId === a.id;
        html += '<div style="border-bottom:1px solid #f1f5f9">'
          + '<button onclick="ctToggleArticle(\'' + a.id + '\')" style="width:100%;text-align:left;background:' + (open ? '#fef3c7' : '#fff') + ';border:none;padding:10px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">'
          + '<div><span style="font-weight:700;color:#7c2d12;font-size:.8rem;margin-right:8px">Art ' + esc(a.id) + '</span>'
          + '<span style="color:#0f172a;font-weight:600;font-size:.85rem">' + esc(a.title) + '</span></div>'
          + '<span style="color:#64748b;font-size:.9rem">' + (open ? '▾' : '▸') + '</span>'
          + '</button>';
        if (open) {
          html += '<div style="padding:10px 16px 14px;background:#fef3c7;font-size:.82rem;color:#334155;line-height:1.5">'
            + esc(a.summary || '') + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;
  }

  function ctFact(label, val) {
    return '<div style="background:#fafbfc;border-radius:6px;padding:7px 10px">'
      + '<div style="font-size:.66rem;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:700">' + esc(label) + '</div>'
      + '<div style="font-size:.88rem;color:#0f172a;font-weight:600;margin-top:2px">' + esc(val) + '</div>'
      + '</div>';
  }

  function ctToggleArticle(id) {
    _cs.expandedArticleId = (_cs.expandedArticleId === id) ? null : id;
    renderContract();
  }

  function ctSeedCurrent() {
    if (!confirm('Install the 2025–2028 UFCW Local 1529 contract on the server? This is a one-time setup.')) return;
    apiCall('POST', '/api/contracts?action=seed_current', {})
      .then(function (r) {
        toast(r.skipped ? 'Already installed.' : 'Contract installed.');
        loadContract();
      })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  // ═══ ASK THE LAWYER ════════════════════════════════════════════════════
  function renderAsk() {
    var panel = document.getElementById('widget-content');
    var canAsk = (typeof userCan === 'function') && userCan('contracts', 'ask');

    if (!_cs.contract && !_cs.askLoading && _cs.lastResponse === null) {
      // Need the contract in state to know whether to show a "need contract" banner
      apiCall('GET', '/api/contracts?action=get_state').then(function (r) {
        _cs.contract = r.current || null;
        renderAsk();
      }).catch(function () { renderAsk(); });
    }

    var html = '<div style="padding:14px;max-width:860px;margin:0 auto">';

    if (!_cs.contract) {
      html += '<div style="' + CARD + ';text-align:center;padding:20px;color:#475569">'
        + '⚠️ No active contract loaded. Switch to the <strong>📄 Contract</strong> tab to install one first.'
        + '</div></div>';
      panel.innerHTML = html;
      return;
    }

    // Header
    html += '<div style="' + CARD + ';background:linear-gradient(135deg,#fef3c7,#fed7aa);border-left:4px solid #7c2d12">'
      + '<div style="font-weight:700;color:#7c2d12;font-size:1rem;margin-bottom:4px">🤖 Ask the Lawyer</div>'
      + '<div style="font-size:.82rem;color:#7c2d12;opacity:.9">Describe a scenario. Claude reads the full CBA and returns the relevant articles, analysis, recommended action, and risks. <strong>Not legal advice</strong> — it interprets the contract only.</div>'
      + '</div>';

    // Scenario input
    html += '<div style="' + CARD + '">'
      + '<label style="display:block;font-size:.78rem;color:#475569;font-weight:600;margin-bottom:6px">Scenario</label>'
      + '<textarea id="ct-scenario" rows="4" placeholder="e.g. An employee missed three days in a row without calling. What are our options?" style="' + INP + ';resize:vertical;font-family:inherit" ' + (canAsk ? '' : 'disabled') + '>' + esc(_cs.lastScenario || '') + '</textarea>'
      + '<div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">'
      + '<button id="ct-ask-btn" ' + (canAsk ? '' : 'disabled') + ' onclick="ctAskLawyer()" style="' + BTN_P + ';padding:9px 18px;font-size:.82rem' + (canAsk ? '' : ';opacity:0.5;cursor:not-allowed') + '">' + (_cs.askLoading ? 'Thinking…' : '⚡ Ask the Lawyer') + '</button>'
      + '<span style="font-size:.7rem;color:#64748b">Takes 10–25 seconds. Response saves to the Log tab.</span>'
      + '</div>'
      + '</div>';

    // Preset scenarios
    html += '<div style="' + CARD + '">'
      + '<div style="font-weight:700;color:#334155;font-size:.82rem;margin-bottom:8px">Common scenarios · click to fill</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px">';
    PRESETS.forEach(function (p, i) {
      html += '<button onclick="ctUsePreset(' + i + ')" style="text-align:left;background:#fafbfc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;cursor:pointer;font-size:.78rem;color:#334155" onmouseover="this.style.background=\'#fef3c7\'" onmouseout="this.style.background=\'#fafbfc\'">'
        + '<div style="font-weight:700;color:#7c2d12;margin-bottom:2px">' + esc(p.title) + '</div>'
        + '<div style="color:#64748b;font-size:.72rem;line-height:1.3">' + esc(p.prompt.slice(0, 90)) + (p.prompt.length > 90 ? '…' : '') + '</div>'
        + '</button>';
    });
    html += '</div></div>';

    // Last response
    if (_cs.askLoading) {
      html += '<div style="' + CARD + ';background:#fef3c7;text-align:center;padding:28px">'
        + '<div class="spinner-wrap" style="display:inline-block"><div class="spinner"></div></div>'
        + '<div style="margin-top:8px;color:#92400e;font-weight:600;font-size:.86rem">Claude is reading the CBA…</div>'
        + '<div style="font-size:.72rem;color:#64748b;margin-top:4px">Usually 10–25 seconds for a thorough answer.</div>'
        + '</div>';
    } else if (_cs.lastResponse) {
      html += renderLawyerResponse(_cs.lastResponse);
    }

    html += '</div>';
    panel.innerHTML = html;
  }

  function renderLawyerResponse(r) {
    var confColor = r.confidence === 'high' ? '#065f46' : r.confidence === 'medium' ? '#92400e' : '#991b1b';
    var confBg = r.confidence === 'high' ? '#d1fae5' : r.confidence === 'medium' ? '#fef3c7' : '#fee2e2';
    var html = '<div style="' + CARD + ';border:2px solid #7c2d12;padding:0;overflow:hidden">';

    // Header bar
    html += '<div style="background:linear-gradient(135deg,#7c2d12,#9a3412);color:#fff;padding:12px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
      + '<span style="font-size:1.2rem">⚖️</span>'
      + '<div style="flex:1;font-weight:700;font-size:.98rem">' + esc(r.summary || 'Analysis complete') + '</div>'
      + (r.confidence ? '<span style="background:' + confBg + ';color:' + confColor + ';padding:3px 10px;border-radius:12px;font-size:.7rem;font-weight:700;text-transform:uppercase">' + esc(r.confidence) + ' confidence</span>' : '')
      + '</div>';

    html += '<div style="padding:14px 18px">';

    // Escalation flag prominently if present
    if (r.escalation_flag) {
      html += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:14px">'
        + '<div style="font-weight:700;color:#991b1b;font-size:.82rem;margin-bottom:4px">🚨 Consider Outside Counsel</div>'
        + '<div style="font-size:.82rem;color:#7f1d1d;line-height:1.5">' + esc(r.escalation_flag) + '</div>'
        + '</div>';
    }

    // Analysis
    if (r.analysis) {
      html += '<div style="margin-bottom:12px"><div style="font-weight:700;font-size:.76rem;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Analysis</div>';
      html += '<div style="font-size:.86rem;color:#0f172a;line-height:1.6;white-space:pre-wrap">' + esc(r.analysis) + '</div></div>';
    }

    // Relevant articles with quotes
    if (Array.isArray(r.relevant_articles) && r.relevant_articles.length) {
      html += '<div style="margin-bottom:14px"><div style="font-weight:700;font-size:.76rem;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Relevant Contract Language</div>';
      r.relevant_articles.forEach(function (a) {
        html += '<div style="background:#fef3c7;border-left:3px solid #7c2d12;border-radius:0 6px 6px 0;padding:8px 12px;margin-bottom:6px">'
          + '<div style="font-weight:700;color:#7c2d12;font-size:.78rem">'
          + esc(a.article || '') + (a.section ? ' · ' + esc(a.section) : '') + (a.title ? ' — ' + esc(a.title) : '')
          + '</div>'
          + '<div style="font-style:italic;color:#334155;font-size:.8rem;margin-top:4px;line-height:1.5">' + esc(a.quote || '') + '</div>'
          + '</div>';
      });
      html += '</div>';
    }

    // Recommended action + required process side by side
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-bottom:12px">';
    if (r.recommended_action) {
      html += '<div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:6px;padding:10px 12px">'
        + '<div style="font-weight:700;color:#065f46;font-size:.78rem;margin-bottom:6px">→ Recommended Action</div>'
        + '<div style="font-size:.82rem;color:#0f172a;line-height:1.5;white-space:pre-wrap">' + esc(r.recommended_action) + '</div>'
        + '</div>';
    }
    if (r.required_process) {
      html += '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 12px">'
        + '<div style="font-weight:700;color:#1e40af;font-size:.78rem;margin-bottom:6px">📋 Required Process</div>'
        + '<div style="font-size:.82rem;color:#0f172a;line-height:1.5;white-space:pre-wrap">' + esc(r.required_process) + '</div>'
        + '</div>';
    }
    html += '</div>';

    // Risks + timing
    if ((Array.isArray(r.risks) && r.risks.length) || r.timing) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px">';
      if (Array.isArray(r.risks) && r.risks.length) {
        html += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 12px">'
          + '<div style="font-weight:700;color:#991b1b;font-size:.78rem;margin-bottom:6px">⚠ Risks</div>'
          + '<ul style="margin:0;padding-left:18px;line-height:1.5">';
        r.risks.forEach(function (x) {
          html += '<li style="font-size:.8rem;color:#7f1d1d;margin-bottom:3px">' + esc(String(x)) + '</li>';
        });
        html += '</ul></div>';
      }
      if (r.timing) {
        html += '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:10px 12px">'
          + '<div style="font-weight:700;color:#9a3412;font-size:.78rem;margin-bottom:6px">⏱ Timing</div>'
          + '<div style="font-size:.82rem;color:#7c2d12;line-height:1.5">' + esc(r.timing) + '</div>'
          + '</div>';
      }
      html += '</div>';
    }

    html += '<div style="margin-top:14px;padding-top:10px;border-top:1px solid #f1f5f9;font-size:.68rem;color:#94a3b8;font-style:italic">This is contract interpretation, not legal advice. For any high-stakes decision, consult an employment attorney.</div>';

    html += '</div></div>';
    return html;
  }

  function ctUsePreset(i) {
    _cs.lastScenario = PRESETS[i].prompt;
    var el = document.getElementById('ct-scenario');
    if (el) { el.value = PRESETS[i].prompt; el.focus(); }
  }

  function ctAskLawyer() {
    var ta = document.getElementById('ct-scenario');
    var scenario = ta ? ta.value.trim() : '';
    if (!scenario) { toast('Describe the scenario first.'); return; }
    if (scenario.length > 4000) { toast('Scenario too long — keep it under 4000 characters.'); return; }
    _cs.lastScenario = scenario;
    _cs.askLoading = true;
    renderAsk();
    apiCall('POST', '/api/contracts?action=ask_lawyer', { scenario: scenario })
      .then(function (r) {
        _cs.lastResponse = r.response || null;
        _cs.askLoading = false;
        renderAsk();
      })
      .catch(function (err) {
        _cs.askLoading = false;
        toast('⚠️ ' + err.message);
        renderAsk();
      });
  }

  // ═══ LOG TAB ═══════════════════════════════════════════════════════════
  function loadLog() {
    var panel = document.getElementById('widget-content');
    panel.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner-wrap"><div class="spinner"></div></div>Loading consultation log…</div>';
    apiCall('GET', '/api/contracts?action=get_consultations&limit=100').then(function (r) {
      _cs.consultations = r.consultations || [];
      renderLog();
    }).catch(function (err) {
      panel.innerHTML = '<div style="padding:20px;color:#ef4444">Failed: ' + esc(err.message) + '</div>';
    });
  }

  function renderLog() {
    var panel = document.getElementById('widget-content');
    var canDelete = (typeof userCan === 'function') && userCan('contracts', 'delete');

    var html = '<div style="padding:14px;max-width:860px;margin:0 auto">';
    html += '<div style="' + CARD + ';display:flex;justify-content:space-between;align-items:center">'
      + '<div style="font-weight:700;color:#7c2d12;font-size:1rem">📋 Consultation Log</div>'
      + '<div style="font-size:.78rem;color:#64748b">' + _cs.consultations.length + ' consultation' + (_cs.consultations.length === 1 ? '' : 's') + '</div>'
      + '</div>';

    if (_cs.consultations.length === 0) {
      html += '<div style="' + CARD + ';text-align:center;padding:30px;color:#94a3b8">'
        + 'No consultations yet. Ask the Lawyer on the previous tab — every Q&A is saved here.'
        + '</div></div>';
      panel.innerHTML = html;
      return;
    }

    _cs.consultations.forEach(function (c) {
      var open = _cs.expandedLogId === c.id;
      var when = fmtDate(c.created_at) + ' · ' + new Date(c.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      html += '<div style="' + CARD + ';padding:0">'
        + '<button onclick="ctToggleLog(\'' + c.id + '\')" style="width:100%;text-align:left;background:transparent;border:none;padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:.7rem;color:#64748b;margin-bottom:3px">' + esc(when) + ' · ' + esc(c.username || 'unknown') + '</div>'
        + '<div style="font-weight:600;color:#0f172a;font-size:.86rem;line-height:1.35;white-space:' + (open ? 'normal' : 'nowrap') + ';overflow:hidden;text-overflow:ellipsis">' + esc(c.scenario) + '</div>'
        + '</div>'
        + '<span style="color:#64748b;font-size:1rem;flex-shrink:0">' + (open ? '▾' : '▸') + '</span>'
        + '</button>';
      if (open && c.response) {
        html += '<div style="padding:0 16px 14px;border-top:1px solid #f1f5f9">'
          + renderLawyerResponse(c.response)
          + (canDelete ? '<div style="text-align:right;margin-top:8px"><button onclick="ctDeleteConsultation(\'' + c.id + '\')" style="' + BTN_D + '">Delete</button></div>' : '')
          + '</div>';
      }
      html += '</div>';
    });

    html += '</div>';
    panel.innerHTML = html;
  }

  function ctToggleLog(id) {
    _cs.expandedLogId = (_cs.expandedLogId === id) ? null : id;
    renderLog();
  }

  function ctDeleteConsultation(id) {
    if (!confirm('Delete this saved consultation?')) return;
    apiCall('POST', '/api/contracts?action=delete_consultation', { id: id })
      .then(function () { toast('Deleted'); loadLog(); })
      .catch(function (err) { toast('⚠️ ' + err.message); });
  }

  // ═══ EXPORTS ══════════════════════════════════════════════════════════
  window.buildContractsWidget = buildContractsWidget;
  window.ctShowTab = ctShowTab;
  window.ctToggleArticle = ctToggleArticle;
  window.ctSeedCurrent = ctSeedCurrent;
  window.ctUsePreset = ctUsePreset;
  window.ctAskLawyer = ctAskLawyer;
  window.ctToggleLog = ctToggleLog;
  window.ctDeleteConsultation = ctDeleteConsultation;
})();

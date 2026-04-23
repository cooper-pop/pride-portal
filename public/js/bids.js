// bids.js — Contract Bids widget
// Upload vendor agreements / proposals → AI extracts structured data →
// side-by-side comparison within a category → AI-drafted negotiation emails.

var _bidsState = { categories: [], vendors: [], documents: [] };
var _bidsTab = 'dashboard';
var _bidsCategoryFilter = '';
var _bidsVendorFilter = '';
var _bidsSearch = '';
var _bidsCompareCategoryId = '';
// AI comparison cache — keyed by category_id, holds the last recommendation
// result so switching tabs doesn't force a re-call. Cleared when the user
// picks a different category.
var _bidsAIRecommendations = {};
var _bidsAILoading = false;

var DOC_TYPE_LABELS = {
  current_agreement: '📘 Current Agreement',
  proposal: '💼 Proposal',
  counter_offer: '↩ Counter-Offer',
  other: '📄 Other'
};
var DOC_TYPE_COLORS = {
  current_agreement: { bg:'#dbeafe', color:'#1e40af' },
  proposal:          { bg:'#d1fae5', color:'#065f46' },
  counter_offer:     { bg:'#fef3c7', color:'#92400e' },
  other:             { bg:'#f1f5f9', color:'#475569' }
};

// Button / input styles (mirror other widgets)
var BB = 'padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
var BB_P = BB + ';background:#1a3a6b;color:#fff';
var BB_S = BB + ';background:#6366f1;color:#fff';
var BB_SUB = BB + ';background:#f1f5f9;color:#334155';
var BB_D = 'padding:3px 9px;border-radius:5px;border:none;cursor:pointer;font-size:.73rem;background:#fee2e2;color:#b91c1c';
var BINP = 'width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.83rem;margin-bottom:8px;box-sizing:border-box';
var CARD2 = 'background:#fff;border-radius:10px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)';

function bidsEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ═══ Entry point ════════════════════════════════════════════════════════════
function buildBidsWidget(){
  var wt = document.getElementById('widget-tabs');
  var wc = document.getElementById('widget-content');
  var tabs = [
    { id:'dashboard', label:'📊 Dashboard' },
    { id:'documents', label:'📄 Documents' },
    { id:'compare',   label:'⚖️ Compare' },
    { id:'setup',     label:'🛠️ Setup' }
  ];
  wt.innerHTML = tabs.map(function(t){
    return '<button class="wtab" id="btab-'+t.id+'" onclick="bidsShowTab(\''+t.id+'\')" '
      + 'style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;'
      + 'border-bottom:2px solid transparent;color:#94a3b8">'+t.label+'</button>';
  }).join('');
  wc.innerHTML = '<div id="bids-panel" style="padding:0"></div>';
  bidsLoadState(function(){ bidsShowTab('dashboard'); });
}
window.buildBidsWidget = buildBidsWidget;

function bidsShowTab(tab){
  _bidsTab = tab;
  ['dashboard','documents','compare','setup'].forEach(function(t){
    var b = document.getElementById('btab-'+t);
    if(!b) return;
    var active = (t===tab);
    b.style.borderBottomColor = active ? '#1a3a6b' : 'transparent';
    b.style.color = active ? '#1a3a6b' : '#94a3b8';
    b.style.fontWeight = active ? '600' : '400';
  });
  try {
    if(tab==='dashboard') bidsRenderDashboard();
    else if(tab==='documents') bidsRenderDocuments();
    else if(tab==='compare') bidsRenderCompare();
    else if(tab==='setup') bidsRenderSetup();
  } catch (err) {
    console.error('[bids] ' + tab + ' render failed:', err);
    var panel = document.getElementById('bids-panel');
    if (panel) {
      panel.innerHTML = '<div style="padding:20px;color:#dc2626;font-family:monospace;white-space:pre-wrap;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin:14px">'
        + '<div style="font-weight:700;margin-bottom:8px">Error rendering the ' + tab + ' tab</div>'
        + '<div style="font-size:.82rem">' + bidsEsc(err && err.message ? err.message : String(err)) + '</div>'
        + '</div>';
    }
  }
}
window.bidsShowTab = bidsShowTab;

// ═══ Data load ══════════════════════════════════════════════════════════════
function bidsLoadState(cb){
  apiCall('GET','/api/bids?action=get_state').then(function(d){
    _bidsState = {
      categories: Array.isArray(d && d.categories) ? d.categories : [],
      vendors: Array.isArray(d && d.vendors) ? d.vendors : [],
      documents: Array.isArray(d && d.documents) ? d.documents : []
    };
    if(cb) cb();
  }).catch(function(e){
    console.error('[bids] get_state failed:', e);
    var panel = document.getElementById('bids-panel');
    if(panel) panel.innerHTML = '<div style="padding:20px;color:#dc2626">Failed to load: '+ ((e&&e.message)||'unknown') +'</div>';
  });
}
function bidsRefresh(cb){ bidsLoadState(function(){ if(cb) cb(); else bidsShowTab(_bidsTab); }); }
window.bidsRefresh = bidsRefresh;

// ═══ Lookup helpers ════════════════════════════════════════════════════════
function bidsCategoryById(id){ return _bidsState.categories.find(function(c){return c.id===id;}); }
function bidsVendorById(id){ return _bidsState.vendors.find(function(v){return v.id===id;}); }
function bidsDocsInCategory(catId){ return _bidsState.documents.filter(function(d){return d.category_id===catId;}); }
function bidsDocsForVendorInCategory(catId, vendorId){
  return _bidsState.documents.filter(function(d){ return d.category_id===catId && d.vendor_id===vendorId; });
}
function bidsDocStatusBadge(doc){
  var s = doc.extraction_status || 'pending';
  var styles = {
    pending:    {bg:'#dbeafe',color:'#1e40af',text:'EXTRACTING'},
    processing: {bg:'#dbeafe',color:'#1e40af',text:'EXTRACTING'},
    done:       {bg:'#dcfce7',color:'#166534',text:'READY'},
    failed:     {bg:'#fee2e2',color:'#dc2626',text:'FAILED'},
    none:       {bg:'#f1f5f9',color:'#64748b',text:'NO FILE'}
  };
  var st = styles[s] || styles.pending;
  return '<span style="background:'+st.bg+';color:'+st.color+';padding:1px 7px;border-radius:10px;font-size:.64rem;font-weight:700;letter-spacing:.03em">'+st.text+'</span>';
}

// ═══ Tab: Dashboard ═════════════════════════════════════════════════════════
function bidsRenderDashboard(){
  var panel = document.getElementById('bids-panel');
  if(!panel) return;

  var html = '<div style="padding:14px;max-width:960px;margin:0 auto">';
  html += '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">'
    + '<div style="font-weight:700;font-size:.95rem;margin-right:auto">Contract Bids Dashboard</div>'
    + '<button style="'+BB_P+'" onclick="bidsShowUploadForm()">+ Upload Document</button>'
    + '<button style="'+BB_SUB+'" onclick="bidsShowTab(\'setup\')">🛠️ Setup</button>'
    + '<button style="'+BB_SUB+'" onclick="bidsRefresh()">Refresh</button>'
    + '</div>';

  if(_bidsState.categories.length === 0){
    html += '<div style="'+CARD2+';text-align:center;color:#64748b;padding:28px">'
      + '<div style="font-size:1rem;font-weight:600;margin-bottom:6px">No categories yet</div>'
      + '<div style="font-size:.82rem;margin-bottom:12px">Start by creating a category like Insurance, Packaging, or Uniforms.</div>'
      + '<button style="'+BB_P+'" onclick="bidsShowTab(\'setup\')">Go to Setup</button>'
      + '</div>';
    html += '</div>';
    panel.innerHTML = html;
    return;
  }

  // Intro / explainer
  html += '<div style="background:#f0f7ff;border-left:3px solid #3b82f6;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:.78rem;color:#1e40af">'
    + 'Upload vendor agreements and proposals per category. Claude extracts pricing, terms, exclusions, and red-flag fine print so you can compare bids side-by-side and draft negotiation emails with concrete asks.'
    + '</div>';

  // ── Expiration alerts ──────────────────────────────────────────────────
  html += bidsRenderExpirationAlerts();

  _bidsState.categories.forEach(function(cat){
    var docs = bidsDocsInCategory(cat.id);
    // Group docs by vendor
    var vendorIds = Array.from(new Set(docs.map(function(d){return d.vendor_id;}).filter(Boolean)));
    var proposalCount = docs.filter(function(d){return d.doc_type==='proposal';}).length;
    var currentCount = docs.filter(function(d){return d.is_current_agreement;}).length;

    html += '<div style="'+CARD2+';overflow:hidden;padding:0">'
      + '<div style="padding:12px 14px;background:#1a3a6b;color:#fff;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">'
      + '<div><div style="font-weight:700;font-size:.95rem">'+bidsEsc(cat.name)+'</div>'
      + (cat.description ? '<div style="font-size:.76rem;opacity:.85;margin-top:2px">'+bidsEsc(cat.description)+'</div>' : '')
      + '</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + '<button style="'+BB_SUB+';padding:4px 10px;font-size:.72rem" onclick="bidsShowUploadForm(\''+cat.id+'\')">+ Upload</button>'
      + '<button style="'+BB_SUB+';padding:4px 10px;font-size:.72rem" onclick="bidsOpenCompare(\''+cat.id+'\')">Compare ('+docs.length+')</button>'
      + '</div></div>';

    html += '<div style="padding:10px 14px;font-size:.78rem;color:#64748b;display:flex;gap:14px;flex-wrap:wrap;border-bottom:1px solid #f1f5f9">'
      + '<span><strong style="color:#334155">'+vendorIds.length+'</strong> vendor'+(vendorIds.length===1?'':'s')+'</span>'
      + '<span><strong style="color:#1e40af">'+currentCount+'</strong> current agreement'+(currentCount===1?'':'s')+'</span>'
      + '<span><strong style="color:#065f46">'+proposalCount+'</strong> proposal'+(proposalCount===1?'':'s')+'</span>'
      + '<span><strong style="color:#334155">'+docs.length+'</strong> total document'+(docs.length===1?'':'s')+'</span>'
      + '</div>';

    if(docs.length === 0){
      html += '<div style="padding:14px;color:#94a3b8;font-size:.82rem;text-align:center">No documents uploaded for this category yet.</div>';
    } else {
      html += '<div style="padding:10px 14px;display:flex;flex-direction:column;gap:6px">';
      vendorIds.forEach(function(vid){
        var v = bidsVendorById(vid);
        var vDocs = bidsDocsForVendorInCategory(cat.id, vid);
        html += '<div style="padding:8px 10px;background:#f8fafc;border-radius:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'
          + '<div style="font-weight:600;font-size:.82rem;color:#334155">'+bidsEsc(v ? v.name : '(unknown vendor)')+'</div>'
          + '<div style="display:flex;gap:4px;flex-wrap:wrap">';
        vDocs.forEach(function(d){
          var typeMeta = DOC_TYPE_COLORS[d.doc_type] || DOC_TYPE_COLORS.other;
          html += '<span style="background:'+typeMeta.bg+';color:'+typeMeta.color+';padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:600;cursor:pointer" title="Click to view details" onclick="bidsShowDocumentDetail(\''+d.id+'\')">'
            + DOC_TYPE_LABELS[d.doc_type] + ' ' + bidsDocStatusBadge(d) + '</span>';
        });
        html += '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  panel.innerHTML = html;
}
window.bidsOpenCompare = function(catId){ _bidsCompareCategoryId = catId; bidsShowTab('compare'); };

// ═══ Expiration tracking ════════════════════════════════════════════════════
// Tiers (days remaining) → styling. Negative days = already expired.
var BID_EXPIRATION_TIERS = [
  { max: -1,  key:'expired', label:'EXPIRED',         bg:'#991b1b', color:'#fff',    icon:'🚨', headerColor:'#991b1b' },
  { max: 1,   key:'tier1',   label:'≤ 1 day',         bg:'#dc2626', color:'#fff',    icon:'🚨', headerColor:'#991b1b' },
  { max: 5,   key:'tier5',   label:'≤ 5 days',        bg:'#fee2e2', color:'#991b1b', icon:'🚨', headerColor:'#991b1b' },
  { max: 10,  key:'tier10',  label:'≤ 10 days',       bg:'#fed7aa', color:'#9a3412', icon:'⚠',  headerColor:'#9a3412' },
  { max: 30,  key:'tier30',  label:'≤ 30 days',       bg:'#fef3c7', color:'#92400e', icon:'⚠',  headerColor:'#92400e' },
  { max: 60,  key:'tier60',  label:'≤ 60 days',       bg:'#fef9c3', color:'#854d0e', icon:'⏰', headerColor:'#854d0e' },
  { max: 90,  key:'tier90',  label:'≤ 90 days',       bg:'#e0f2fe', color:'#075985', icon:'⏰', headerColor:'#075985' }
];

function bidsDaysUntil(dateStr){
  if(!dateStr) return null;
  try {
    // Normalize to YYYY-MM-DD
    var iso = String(dateStr).split('T')[0];
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var then = new Date(iso + 'T00:00:00');
    var now = new Date();
    now.setHours(0,0,0,0);
    return Math.round((then - now) / 86400000);
  } catch (e) { return null; }
}
function bidsTierFor(days){
  if(days === null || days === undefined) return null;
  for(var i = 0; i < BID_EXPIRATION_TIERS.length; i++){
    if(days <= BID_EXPIRATION_TIERS[i].max) return BID_EXPIRATION_TIERS[i];
  }
  return null; // beyond 90 days = no alert
}

// Collects current agreements expiring within the alert horizon (90 days),
// bucketed into tiers from expired → 90 days.
function bidsExpiringAgreements(){
  var results = [];
  _bidsState.documents.forEach(function(d){
    if(!d.is_current_agreement) return;
    if(d.archived) return;
    var ex = d.extracted_data || {};
    var expDate = ex.expiration_date;
    if(!expDate) return;
    var days = bidsDaysUntil(expDate);
    if(days === null) return;
    var tier = bidsTierFor(days);
    if(!tier) return; // > 90 days away, skip
    results.push({ doc: d, days: days, tier: tier, expDate: expDate });
  });
  // Sort: most urgent first (ascending days, negatives first)
  results.sort(function(a, b){ return a.days - b.days; });
  return results;
}

function bidsRenderExpirationAlerts(){
  var items = bidsExpiringAgreements();
  // Group by tier key so we can collapse multiple alerts of the same tier
  var groups = {};
  BID_EXPIRATION_TIERS.forEach(function(t){ groups[t.key] = []; });
  items.forEach(function(i){ groups[i.tier.key].push(i); });

  if(items.length === 0){
    // Still render a subtle "all good" indicator, plus a note if there are
    // current agreements without expiration dates so the user knows they're
    // excluded from the alert engine.
    var missingDates = _bidsState.documents.filter(function(d){
      return d.is_current_agreement && d.extraction_status === 'done'
        && (!d.extracted_data || !d.extracted_data.expiration_date);
    }).length;
    var h = '<div style="background:#f0fdf4;border-left:3px solid #16a34a;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:.78rem;color:#166534">'
      + '✓ No contracts expiring within 90 days.';
    if(missingDates > 0){
      h += ' <span style="color:#92400e">· ' + missingDates + ' current agreement' + (missingDates===1?'':'s') + ' missing an expiration date — reindex or set one manually so alerts can fire.</span>';
    }
    h += '</div>';
    return h;
  }

  var html = '';
  BID_EXPIRATION_TIERS.forEach(function(tier){
    var list = groups[tier.key];
    if(list.length === 0) return;
    html += '<div style="'+CARD2+';padding:0;overflow:hidden;border-left:4px solid '+tier.headerColor+'">';
    var sectionTitle = tier.icon + ' ' + (tier.key === 'expired' ? 'EXPIRED — RENEWAL NEEDED' : 'EXPIRING ' + tier.label);
    html += '<div style="padding:8px 14px;background:#fafbfc;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:.82rem;color:'+tier.headerColor+'">'
      + sectionTitle
      + ' <span style="color:#64748b;font-weight:400;font-size:.74rem">('+list.length+')</span></div>';
    list.forEach(function(it){
      var d = it.doc;
      var cat = bidsCategoryById(d.category_id);
      var ven = bidsVendorById(d.vendor_id);
      var daysText = it.days < 0
        ? ('Expired ' + Math.abs(it.days) + ' day' + (Math.abs(it.days)===1?'':'s') + ' ago')
        : (it.days === 0 ? 'Expires TODAY' : ('Expires in ' + it.days + ' day' + (it.days===1?'':'s')));
      html += '<div style="padding:10px 14px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        + '<div style="flex:1;min-width:220px"><div style="font-weight:600;font-size:.86rem;color:#1e293b">'
        + bidsEsc(ven ? ven.name : 'Unknown vendor') + ' <span style="color:#64748b;font-weight:400">· ' + bidsEsc(cat ? cat.name : '—') + '</span></div>'
        + '<div style="font-size:.76rem;color:#64748b;margin-top:2px">'+bidsEsc(d.title||'Untitled')+'</div></div>'
        + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
        + '<span style="background:'+tier.bg+';color:'+tier.color+';padding:3px 10px;border-radius:10px;font-size:.74rem;font-weight:700">'+daysText+'</span>'
        + '<span style="color:#64748b;font-size:.74rem">('+bidsEsc(it.expDate)+')</span>'
        + '<button style="'+BB_SUB+';padding:3px 10px;font-size:.7rem" onclick="bidsShowDocumentDetail(\''+d.id+'\')">View</button>'
        + (d.vendor_id && d.category_id ? ' <button style="'+BB_P+';padding:3px 10px;font-size:.7rem" onclick="bidsDraftNegotiationEmail(\''+d.vendor_id+'\',\''+d.category_id+'\',\''+d.id+'\')">Start Renewal</button>' : '')
        + '</div></div>';
    });
    html += '</div>';
  });
  return html;
}

// ═══ Tab: Documents (upload + list) ═════════════════════════════════════════
function bidsRenderDocuments(){
  var panel = document.getElementById('bids-panel');
  if(!panel) return;

  // Filter dropdowns
  var catOpts = '<option value="">All Categories</option>' + _bidsState.categories.map(function(c){
    return '<option value="'+bidsEsc(c.id)+'"'+(c.id===_bidsCategoryFilter?' selected':'')+'>'+bidsEsc(c.name)+'</option>';
  }).join('');
  var venOpts = '<option value="">All Vendors</option>' + _bidsState.vendors.map(function(v){
    return '<option value="'+bidsEsc(v.id)+'"'+(v.id===_bidsVendorFilter?' selected':'')+'>'+bidsEsc(v.name)+'</option>';
  }).join('');

  // Filter docs
  var docs = _bidsState.documents.slice();
  if(_bidsCategoryFilter) docs = docs.filter(function(d){return d.category_id===_bidsCategoryFilter;});
  if(_bidsVendorFilter) docs = docs.filter(function(d){return d.vendor_id===_bidsVendorFilter;});
  if(_bidsSearch){
    var q = _bidsSearch.toLowerCase();
    docs = docs.filter(function(d){
      return (d.title||'').toLowerCase().indexOf(q) >= 0
        || (d.filename||'').toLowerCase().indexOf(q) >= 0
        || ((d.extracted_data && d.extracted_data.vendor_name)||'').toLowerCase().indexOf(q) >= 0;
    });
  }

  var html = '<div style="padding:14px;max-width:1000px;margin:0 auto">'
    + '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">'
    + '<div style="font-weight:700;font-size:.95rem;margin-right:auto">Documents</div>'
    + '<button style="'+BB_P+'" onclick="bidsShowUploadForm()">+ Upload Document</button>'
    + '</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">'
    + '<select style="'+BINP+';flex:1;min-width:150px;margin:0" onchange="_bidsCategoryFilter=this.value;bidsRenderDocuments()">'+catOpts+'</select>'
    + '<select style="'+BINP+';flex:1;min-width:150px;margin:0" onchange="_bidsVendorFilter=this.value;bidsRenderDocuments()">'+venOpts+'</select>'
    + '<input type="text" placeholder="Search title / vendor / filename…" value="'+bidsEsc(_bidsSearch)+'" oninput="_bidsSearch=this.value;bidsRenderDocuments()" style="'+BINP+';flex:2;min-width:180px;margin:0">'
    + '</div>';

  if(docs.length === 0){
    html += '<div style="'+CARD2+';color:#64748b;text-align:center;padding:30px">No documents match the filter. Click <strong>+ Upload Document</strong> to add one.</div>';
  } else {
    html += '<div style="'+CARD2+';padding:0;overflow:hidden">';
    html += '<div style="overflow-x:auto"><table style="width:100%;font-size:.78rem;border-collapse:collapse">';
    html += '<thead><tr style="background:#1a3a6b;color:#fff">'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Title / Vendor</th>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Category</th>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Type</th>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Status</th>'
      + '<th style="padding:8px 10px;text-align:left;font-weight:600">Uploaded</th>'
      + '<th style="padding:8px 10px"></th></tr></thead><tbody>';
    docs.forEach(function(d){
      var cat = bidsCategoryById(d.category_id);
      var ven = bidsVendorById(d.vendor_id);
      var typeMeta = DOC_TYPE_COLORS[d.doc_type] || DOC_TYPE_COLORS.other;
      var uploaded = d.created_at ? String(d.created_at).split('T')[0] : '';
      var currentBadge = d.is_current_agreement ? ' <span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:8px;font-size:.6rem;font-weight:700">CURRENT</span>' : '';
      html += '<tr style="border-bottom:1px solid #f1f5f9">'
        + '<td style="padding:6px 10px"><div style="font-weight:600;color:#1e293b">'+bidsEsc(d.title||'Untitled')+currentBadge+'</div>'
        + '<div style="color:#64748b;font-size:.72rem">'+bidsEsc(ven ? ven.name : '(no vendor)')+'</div></td>'
        + '<td style="padding:6px 10px;color:#334155">'+bidsEsc(cat ? cat.name : '—')+'</td>'
        + '<td style="padding:6px 10px"><span style="background:'+typeMeta.bg+';color:'+typeMeta.color+';padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:600">'+DOC_TYPE_LABELS[d.doc_type]+'</span></td>'
        + '<td style="padding:6px 10px">'+bidsDocStatusBadge(d)+'</td>'
        + '<td style="padding:6px 10px;color:#64748b;white-space:nowrap">'+uploaded+'</td>'
        + '<td style="padding:6px 10px;white-space:nowrap;text-align:right">'
          + '<button style="'+BB_SUB+';padding:3px 8px;font-size:.7rem" onclick="bidsShowDocumentDetail(\''+d.id+'\')">View</button>'
          + (d.file_url ? ' <button style="'+BB_SUB+';padding:3px 8px;font-size:.7rem" onclick="bidsOpenDocumentFile(\''+d.id+'\')">PDF</button>' : '')
          + ' <button style="'+BB_SUB+';padding:3px 8px;font-size:.7rem" onclick="bidsEditDocMeta(\''+d.id+'\')">Edit</button>'
          + ' <button style="'+BB_D+'" onclick="bidsDeleteDocument(\''+d.id+'\')">Del</button>'
        + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
  }
  html += '</div>';
  panel.innerHTML = html;
}

// Upload form
function bidsShowUploadForm(prefillCategoryId){
  var panel = document.getElementById('bids-panel');
  if(!panel) return;
  var catOpts = '<option value="">— Select Category —</option>' + _bidsState.categories.map(function(c){
    return '<option value="'+bidsEsc(c.id)+'"'+(c.id===(prefillCategoryId||'')?' selected':'')+'>'+bidsEsc(c.name)+'</option>';
  }).join('');
  var venOpts = '<option value="">— Select Vendor —</option>' + _bidsState.vendors.map(function(v){
    return '<option value="'+bidsEsc(v.id)+'">'+bidsEsc(v.name)+'</option>';
  }).join('');
  var typeOpts = Object.keys(DOC_TYPE_LABELS).map(function(k){
    return '<option value="'+k+'">'+DOC_TYPE_LABELS[k]+'</option>';
  }).join('');

  panel.innerHTML = '<div style="padding:14px;max-width:560px;margin:0 auto">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">'
    + '<button style="'+BB_SUB+'" onclick="bidsShowTab(\'documents\')">← Back</button>'
    + '<span style="font-weight:700;font-size:.95rem">Upload Contract Document</span>'
    + '</div>'
    + '<div style="background:#f0f7ff;border-left:3px solid #3b82f6;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:.78rem;color:#1e40af">'
    + 'Upload a PDF and Claude will extract the vendor, pricing, contract term, payment terms, exclusions, and any red-flag fine print. Max 20 MB.'
    + '</div>'
    + '<label style="font-size:.78rem;color:#64748b">Title</label>'
    + '<input type="text" id="bu-title" placeholder="e.g. ABC Insurance — 2026 Liability Renewal" style="'+BINP+'">'
    + '<label style="font-size:.78rem;color:#64748b">Category</label>'
    + '<select id="bu-category" style="'+BINP+'">'+catOpts+'</select>'
    + '<label style="font-size:.78rem;color:#64748b">Vendor</label>'
    + '<div style="display:flex;gap:6px;margin-bottom:8px">'
    + '<select id="bu-vendor" style="'+BINP+';margin:0;flex:1">'+venOpts+'</select>'
    + '<button style="'+BB_SUB+';flex-shrink:0" onclick="bidsQuickAddVendor()">+ New</button>'
    + '</div>'
    + '<label style="font-size:.78rem;color:#64748b">Document Type</label>'
    + '<select id="bu-doctype" style="'+BINP+'">'+typeOpts+'</select>'
    + '<label style="display:flex;gap:6px;align-items:center;margin-bottom:10px;padding:8px 10px;background:#f8fafc;border-radius:6px;font-size:.82rem">'
    + '<input type="checkbox" id="bu-current"> This is our CURRENT agreement (as opposed to a new proposal)'
    + '</label>'
    + '<label style="font-size:.78rem;color:#64748b">PDF File</label>'
    + '<input type="file" id="bu-file" accept="application/pdf" style="'+BINP+'">'
    + '<label style="font-size:.78rem;color:#64748b">Notes (optional)</label>'
    + '<textarea id="bu-notes" style="'+BINP+';resize:vertical;min-height:50px"></textarea>'
    + '<div id="bu-status" style="margin:8px 0;font-size:.82rem;min-height:18px;color:#64748b"></div>'
    + '<div style="display:flex;gap:8px">'
    + '<button style="'+BB_P+';flex:1" onclick="bidsRunUpload()">Upload &amp; Extract</button>'
    + '<button style="'+BB_SUB+'" onclick="bidsShowTab(\'documents\')">Cancel</button>'
    + '</div></div>';
}
window.bidsShowUploadForm = bidsShowUploadForm;

function bidsQuickAddVendor(){
  var name = prompt('Vendor name (e.g., ABC Insurance, Smith Packaging):');
  if(!name) return;
  var email = prompt('Contact email (optional):', '') || '';
  apiCall('POST','/api/bids?action=save_vendor', { name:name.trim(), contact_email:email.trim() })
    .then(function(r){
      if(r && r.vendor){
        _bidsState.vendors.push(r.vendor);
        _bidsState.vendors.sort(function(a,b){return a.name.localeCompare(b.name);});
        var sel = document.getElementById('bu-vendor');
        if(sel){
          var opt = document.createElement('option');
          opt.value = r.vendor.id; opt.textContent = r.vendor.name;
          opt.selected = true;
          sel.innerHTML += '';
          sel.appendChild(opt);
          sel.value = r.vendor.id;
        }
      }
    })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
window.bidsQuickAddVendor = bidsQuickAddVendor;

function bidsRunUpload(){
  var title = (document.getElementById('bu-title').value||'').trim();
  var category_id = document.getElementById('bu-category').value;
  var vendor_id = document.getElementById('bu-vendor').value;
  var doc_type = document.getElementById('bu-doctype').value;
  var is_current_agreement = document.getElementById('bu-current').checked;
  var notes = document.getElementById('bu-notes').value;
  var fileInput = document.getElementById('bu-file');
  var status = document.getElementById('bu-status');

  if(!title){ status.style.color='#dc2626'; status.textContent='Title is required.'; return; }
  if(!category_id){ status.style.color='#dc2626'; status.textContent='Pick a category.'; return; }
  if(!vendor_id){ status.style.color='#dc2626'; status.textContent='Pick a vendor.'; return; }
  if(!fileInput.files || !fileInput.files[0]){ status.style.color='#dc2626'; status.textContent='Pick a PDF file.'; return; }

  var file = fileInput.files[0];
  var maxMB = 20;
  if(file.size > maxMB*1024*1024){
    status.style.color='#dc2626';
    status.textContent = 'File too large ('+(file.size/1024/1024).toFixed(1)+' MB). Max '+maxMB+' MB.';
    return;
  }

  status.innerHTML = '<div class="spinner-wrap" style="display:inline-block;vertical-align:middle"><div class="spinner"></div></div> Preparing upload…';
  apiCall('GET','/api/bids?action=get_upload_signature').then(function(sig){
    var fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', sig.api_key);
    fd.append('timestamp', String(sig.timestamp));
    fd.append('signature', sig.signature);
    fd.append('folder', sig.folder);
    var xhr = new XMLHttpRequest();
    xhr.upload.onprogress = function(e){
      if(e.lengthComputable){
        var pct = Math.round((e.loaded/e.total)*100);
        status.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden"><div style="background:#3b82f6;height:100%;width:'+pct+'%;transition:width .15s"></div></div><span style="font-size:.78rem;color:#64748b">Uploading '+pct+'%</span></div>';
      }
    };
    xhr.onload = function(){
      if(xhr.status < 200 || xhr.status >= 300){
        status.style.color='#dc2626';
        status.textContent = 'Cloudinary upload failed: '+xhr.status;
        return;
      }
      var result;
      try { result = JSON.parse(xhr.responseText); } catch(e){
        status.style.color='#dc2626'; status.textContent = 'Upload response invalid'; return;
      }
      apiCall('POST','/api/bids?action=save_document', {
        title: title, category_id: category_id, vendor_id: vendor_id,
        doc_type: doc_type, is_current_agreement: is_current_agreement,
        notes: notes, file_url: result.secure_url,
        cloudinary_public_id: result.public_id,
        file_size_bytes: result.bytes,
        filename: result.original_filename
      }).then(function(r){
        var mid = r.poll_doc_id || (r.document && r.document.id);
        if(!mid){ status.style.color='#166534'; status.textContent='Saved.'; setTimeout(function(){ bidsRefresh(); bidsShowTab('documents'); }, 800); return; }
        bidsPollDocStatus(mid, status);
      }).catch(function(e){
        status.style.color='#dc2626'; status.textContent = 'Error: '+((e&&e.message)||'unknown');
      });
    };
    xhr.onerror = function(){ status.style.color='#dc2626'; status.textContent = 'Upload network error.'; };
    xhr.open('POST', 'https://api.cloudinary.com/v1_1/'+sig.cloud_name+'/raw/upload');
    xhr.send(fd);
  }).catch(function(e){
    status.style.color='#dc2626'; status.textContent = 'Signature error: '+((e&&e.message)||'unknown');
  });
}
window.bidsRunUpload = bidsRunUpload;

function bidsPollDocStatus(docId, statusEl){
  var pollCount = 0; var maxPolls = 120;
  function tick(){
    apiCall('POST','/api/bids?action=get_document_status', { id: docId }).then(function(d){
      var s = d.extraction_status || 'processing';
      var lastLine = ((d.extraction_log||'').split('\n').filter(function(l){return l.trim();}).slice(-1)[0]||'').slice(25,220);
      if(s === 'pending' || s === 'processing'){
        statusEl.style.color='#64748b';
        statusEl.innerHTML = '<div class="spinner-wrap" style="display:inline-block;vertical-align:middle"><div class="spinner"></div></div> Extracting…'
          + (lastLine ? '<div style="color:#94a3b8;font-size:.72rem;margin-top:4px">'+bidsEsc(lastLine)+'</div>' : '');
        pollCount++;
        if(pollCount < maxPolls) setTimeout(tick, 3000);
        else { statusEl.style.color='#dc2626'; statusEl.textContent='Taking longer than expected — check the Documents tab for status.'; }
      } else if(s === 'done'){
        var vn = (d.extracted_data && d.extracted_data.vendor_name) || '';
        statusEl.style.color='#166534';
        statusEl.innerHTML = '✓ Extracted. Vendor: '+bidsEsc(vn||'(not detected)') + '. Routing to the document…';
        setTimeout(function(){ bidsRefresh(function(){ bidsShowDocumentDetail(docId); }); }, 1500);
      } else if(s === 'failed'){
        statusEl.style.color='#dc2626';
        statusEl.innerHTML = '⚠ Extraction failed.' + (lastLine ? '<div style="font-size:.72rem;margin-top:4px">'+bidsEsc(lastLine)+'</div>' : '')
          + '<div style="margin-top:6px;font-size:.76rem">The document was saved — click <strong>Reindex</strong> on its detail view to retry.</div>';
        setTimeout(function(){ bidsRefresh(function(){ bidsShowDocumentDetail(docId); }); }, 2500);
      } else {
        statusEl.style.color='#64748b';
        statusEl.textContent = 'Status: ' + s;
      }
    }).catch(function(){
      pollCount++;
      if(pollCount < 15) setTimeout(tick, 3000);
      else { statusEl.style.color='#dc2626'; statusEl.textContent='Lost connection while tracking extraction.'; }
    });
  }
  statusEl.style.color='#64748b';
  statusEl.innerHTML = '<div class="spinner-wrap" style="display:inline-block;vertical-align:middle"><div class="spinner"></div></div> Upload complete. Starting background extraction…';
  setTimeout(tick, 2500);
}

// Document detail view (full extracted data)
function bidsShowDocumentDetail(docId){
  var panel = document.getElementById('bids-panel');
  if(!panel) return;
  var d = _bidsState.documents.find(function(x){return x.id===docId;});
  if(!d){
    panel.innerHTML = '<div style="padding:20px;color:#dc2626">Document not found.</div>';
    return;
  }
  var cat = bidsCategoryById(d.category_id);
  var ven = bidsVendorById(d.vendor_id);
  var ex = d.extracted_data || {};
  var typeMeta = DOC_TYPE_COLORS[d.doc_type] || DOC_TYPE_COLORS.other;

  var html = '<div style="padding:14px;max-width:880px;margin:0 auto">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">'
    + '<button style="'+BB_SUB+'" onclick="bidsShowTab(\'documents\')">← Back</button>'
    + '<div style="font-weight:700;font-size:.95rem;flex:1">'+bidsEsc(d.title||'Untitled')+'</div>'
    + (d.file_url ? '<button style="'+BB_SUB+'" onclick="bidsOpenDocumentFile(\''+d.id+'\')">Open PDF</button>' : '')
    + '<button style="'+BB_SUB+'" onclick="bidsReindexDocument(\''+d.id+'\')">Reindex</button>'
    + '</div>';

  html += '<div style="'+CARD2+'">'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:.82rem;color:#334155">'
    + '<span><strong>Category:</strong> '+bidsEsc(cat ? cat.name : '—')+'</span>'
    + '<span><strong>Vendor:</strong> '+bidsEsc(ven ? ven.name : '—')+'</span>'
    + '<span><strong>Type:</strong> <span style="background:'+typeMeta.bg+';color:'+typeMeta.color+';padding:1px 8px;border-radius:10px;font-size:.72rem;font-weight:600">'+DOC_TYPE_LABELS[d.doc_type]+'</span></span>'
    + '<span>'+bidsDocStatusBadge(d)+'</span>'
    + (d.is_current_agreement ? '<span style="background:#dbeafe;color:#1e40af;padding:1px 8px;border-radius:10px;font-size:.72rem;font-weight:700">CURRENT AGREEMENT</span>' : '')
    + '</div></div>';

  if(d.extraction_status !== 'done'){
    html += '<div style="'+CARD2+';color:#64748b">'
      + 'Extraction status: <strong>' + bidsEsc(d.extraction_status || 'unknown') + '</strong>. '
      + (d.extraction_status === 'failed' ? 'Click Reindex to retry.' : (d.extraction_status === 'pending' || d.extraction_status === 'processing' ? 'Check back in a minute.' : ''))
      + '</div>';
  } else {
    html += bidsRenderExtractedData(ex);
    if(cat && ven){
      html += '<div style="'+CARD2+';display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
        + '<div style="flex:1;font-size:.82rem;color:#334155">Ready to push back on this proposal?</div>'
        + '<button style="'+BB_P+'" onclick="bidsDraftNegotiationEmail(\''+d.vendor_id+'\',\''+d.category_id+'\',\''+d.id+'\')">✉️ Draft Negotiation Email</button>'
        + '</div>';
    }
  }

  panel.innerHTML = html + '</div>';
}
window.bidsShowDocumentDetail = bidsShowDocumentDetail;

function bidsRenderExtractedData(ex){
  function row(label, value){
    if(value === null || value === undefined || value === '' || value === 'not specified') return '';
    return '<tr><td style="padding:5px 10px;color:#64748b;font-size:.78rem;width:170px;vertical-align:top">'+bidsEsc(label)+'</td>'
      + '<td style="padding:5px 10px;color:#1e293b;font-size:.82rem">'+bidsEsc(value)+'</td></tr>';
  }
  function listBlock(title, items, color){
    if(!Array.isArray(items) || items.length === 0) return '';
    return '<div style="margin-bottom:10px"><div style="font-weight:700;font-size:.8rem;color:'+color+';margin-bottom:4px">'+bidsEsc(title)+'</div>'
      + '<ul style="margin:0;padding-left:22px;font-size:.8rem;color:#334155;line-height:1.5">'
      + items.map(function(i){ return '<li style="margin-bottom:2px">'+bidsEsc(String(i))+'</li>'; }).join('')
      + '</ul></div>';
  }

  var html = '';
  if(ex.executive_summary){
    html += '<div style="'+CARD2+';background:#f0f7ff;border-left:3px solid #3b82f6">'
      + '<div style="font-weight:700;font-size:.8rem;color:#1e40af;margin-bottom:4px">Executive Summary</div>'
      + '<div style="font-size:.86rem;color:#1e40af;line-height:1.5">'+bidsEsc(ex.executive_summary)+'</div></div>';
  }

  html += '<div style="'+CARD2+';padding:0;overflow:hidden">'
    + '<div style="padding:8px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:.82rem;color:#1a3a6b">Key Terms</div>'
    + '<table style="width:100%;border-collapse:collapse">'
    + row('Vendor', ex.vendor_name)
    + row('Document Type', ex.document_type)
    + row('Category', ex.category_guess)
    + row('Effective Date', ex.effective_date)
    + row('Expiration', ex.expiration_date)
    + row('Contract Term', ex.contract_term)
    + row('Auto-Renewal', ex.auto_renewal)
    + row('Auto-Renewal Details', ex.auto_renewal_details)
    + row('Cancellation Terms', ex.cancellation_terms)
    + row('Notice Required', ex.notice_required)
    + row('Price Summary', ex.price_summary)
    + row('Payment Terms', ex.payment_terms)
    + row('Price Escalation', ex.price_escalation)
    + row('Deductibles', ex.deductibles)
    + row('Liability Limits', ex.liability_limits)
    + row('Delivery Lead Time', ex.delivery_lead_time)
    + row('Minimum Order', ex.minimum_order)
    + row('Freight Terms', ex.freight_terms)
    + row('Warranty', ex.warranty)
    + '</table></div>';

  // Pricing Details table
  if(Array.isArray(ex.pricing_details) && ex.pricing_details.length > 0){
    html += '<div style="'+CARD2+';padding:0;overflow:hidden">'
      + '<div style="padding:8px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:.82rem;color:#1a3a6b">Pricing Details</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:.8rem">'
      + '<thead><tr style="color:#64748b;text-align:left;background:#fafbfc">'
      + '<th style="padding:6px 10px;font-weight:600">Item</th>'
      + '<th style="padding:6px 10px;font-weight:600">Unit</th>'
      + '<th style="padding:6px 10px;font-weight:600">Price</th>'
      + '</tr></thead><tbody>';
    ex.pricing_details.forEach(function(p){
      html += '<tr style="border-top:1px solid #f1f5f9"><td style="padding:6px 10px">'+bidsEsc(p.item||'')+'</td>'
        + '<td style="padding:6px 10px;color:#64748b">'+bidsEsc(p.unit||'')+'</td>'
        + '<td style="padding:6px 10px;font-weight:600">'+bidsEsc(p.price||'')+'</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  // Coverage Limits (insurance)
  if(Array.isArray(ex.coverage_limits) && ex.coverage_limits.length > 0){
    html += '<div style="'+CARD2+';padding:0;overflow:hidden">'
      + '<div style="padding:8px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:.82rem;color:#1a3a6b">Coverage Limits</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:.8rem"><tbody>';
    ex.coverage_limits.forEach(function(c){
      html += '<tr style="border-top:1px solid #f1f5f9"><td style="padding:6px 10px;color:#334155;width:40%">'+bidsEsc(c.type||'')+'</td>'
        + '<td style="padding:6px 10px;font-weight:600">'+bidsEsc(c.limit||'')+'</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  // Key lists
  html += '<div style="'+CARD2+'">';
  html += listBlock('✅ Strengths', ex.strengths, '#065f46');
  html += listBlock('💡 Key Benefits', ex.key_benefits, '#1e40af');
  html += listBlock('⚠ Key Concerns / Fine Print', ex.key_concerns, '#92400e');
  html += listBlock('🚩 Red Flags', ex.red_flags, '#991b1b');
  html += listBlock('🚫 Key Exclusions', ex.key_exclusions, '#7f1d1d');
  html += '</div>';

  // Contacts
  if(Array.isArray(ex.key_contacts) && ex.key_contacts.length > 0){
    html += '<div style="'+CARD2+';padding:0;overflow:hidden">'
      + '<div style="padding:8px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:.82rem;color:#1a3a6b">Key Contacts</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:.8rem"><tbody>';
    ex.key_contacts.forEach(function(c){
      html += '<tr style="border-top:1px solid #f1f5f9">'
        + '<td style="padding:6px 10px">'+bidsEsc(c.name||'')+(c.title ? ' <span style="color:#64748b">· '+bidsEsc(c.title)+'</span>' : '')+'</td>'
        + '<td style="padding:6px 10px">'+(c.email ? '<a href="mailto:'+bidsEsc(c.email)+'" style="color:#2563eb">'+bidsEsc(c.email)+'</a>' : '')+'</td>'
        + '<td style="padding:6px 10px;color:#64748b">'+bidsEsc(c.phone||'')+'</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  return html;
}

function bidsOpenDocumentFile(docId){
  var d = _bidsState.documents.find(function(x){return x.id===docId;});
  if(!d) return;
  if(d.cloudinary_public_id){
    apiCall('POST','/api/bids?action=get_document_download_url', { public_id: d.cloudinary_public_id })
      .then(function(r){
        var url = (r && r.url) || d.file_url;
        if(url){ var w = window.open(url, '_blank'); if(!w) location.href = url; }
      })
      .catch(function(){ if(d.file_url) window.open(d.file_url, '_blank'); });
  } else if(d.file_url){
    window.open(d.file_url, '_blank');
  }
}
window.bidsOpenDocumentFile = bidsOpenDocumentFile;

function bidsReindexDocument(docId){
  if(!confirm('Re-run AI extraction on this document? Existing extracted data will be replaced.')) return;
  apiCall('POST','/api/bids?action=reindex_document', { id: docId })
    .then(function(){
      var d = _bidsState.documents.find(function(x){return x.id===docId;});
      var panel = document.getElementById('bids-panel');
      if(panel){
        panel.innerHTML = '<div style="padding:14px;max-width:560px;margin:0 auto">'
          + '<div style="font-weight:700;font-size:.95rem;margin-bottom:10px">Reindexing: '+bidsEsc(d ? d.title : 'document')+'</div>'
          + '<div id="br-status" style="font-size:.82rem;color:#64748b"></div></div>';
        bidsPollDocStatus(docId, document.getElementById('br-status'));
      }
    })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
window.bidsReindexDocument = bidsReindexDocument;

function bidsDeleteDocument(docId){
  var d = _bidsState.documents.find(function(x){return x.id===docId;});
  if(!d) return;
  if(!confirm('Delete "'+(d.title||'this document')+'"?\n\nThis archives the record and deletes the PDF from Cloudinary.')) return;
  apiCall('POST','/api/bids?action=delete_document', { id: docId })
    .then(function(){ bidsRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
window.bidsDeleteDocument = bidsDeleteDocument;

function bidsEditDocMeta(docId){
  var d = _bidsState.documents.find(function(x){return x.id===docId;});
  if(!d) return;
  var newTitle = prompt('Title:', d.title || '');
  if(newTitle === null) return;
  apiCall('POST','/api/bids?action=update_document_meta', {
    id: docId, title: newTitle.trim(),
    category_id: d.category_id, vendor_id: d.vendor_id,
    doc_type: d.doc_type, is_current_agreement: d.is_current_agreement,
    notes: d.notes || ''
  }).then(function(){ bidsRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
window.bidsEditDocMeta = bidsEditDocMeta;

// ═══ Tab: Compare ═══════════════════════════════════════════════════════════
function bidsRenderCompare(){
  var panel = document.getElementById('bids-panel');
  if(!panel) return;

  var catOpts = '<option value="">— Pick a category to compare —</option>' + _bidsState.categories.map(function(c){
    var n = bidsDocsInCategory(c.id).length;
    return '<option value="'+bidsEsc(c.id)+'"'+(c.id===_bidsCompareCategoryId?' selected':'')+'>'+bidsEsc(c.name)+' ('+n+' doc'+(n===1?'':'s')+')</option>';
  }).join('');

  var html = '<div style="padding:14px;max-width:100vw;margin:0 auto">'
    + '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">'
    + '<div style="font-weight:700;font-size:.95rem;margin-right:auto">Side-by-side Comparison</div>'
    + '<select style="'+BINP+';max-width:340px;margin:0" onchange="_bidsAIRecommendations[_bidsCompareCategoryId]=undefined;_bidsCompareCategoryId=this.value;bidsRenderCompare()">'+catOpts+'</select>'
    + (_bidsCompareCategoryId ? '<button style="'+BB_SUB+';padding:8px 14px;font-size:.78rem" onclick="bidsPrintCompare()">🖨️ Print</button>' : '')
    + '</div>';

  if(!_bidsCompareCategoryId){
    html += '<div style="'+CARD2+';color:#64748b;text-align:center;padding:30px">Pick a category above to see all vendor bids lined up side-by-side.</div>';
    panel.innerHTML = html + '</div>';
    return;
  }

  var cat = bidsCategoryById(_bidsCompareCategoryId);
  var docs = bidsDocsInCategory(_bidsCompareCategoryId).filter(function(d){
    return d.extraction_status === 'done' && d.extracted_data;
  });
  if(docs.length === 0){
    html += '<div style="'+CARD2+';color:#64748b;text-align:center;padding:30px">No extracted documents in this category yet. Upload some proposals and wait for extraction to finish.</div>';
    panel.innerHTML = html + '</div>';
    return;
  }

  // AI Recommendation banner — only makes sense with 2+ vendors extracted.
  // Dedupe by vendor_id since the analyzer picks one doc per vendor.
  var uniqVendorIds = {};
  docs.forEach(function(d){ uniqVendorIds[d.vendor_id] = true; });
  var uniqVendorCount = Object.keys(uniqVendorIds).length;
  html += bidsRenderAIRecommendationBanner(uniqVendorCount);

  // Build comparison table: one column per document
  var rowLabels = [
    { key:'vendor_name', label:'Vendor' },
    { key:'price_summary', label:'Pricing' },
    { key:'contract_term', label:'Term' },
    { key:'effective_date', label:'Effective' },
    { key:'expiration_date', label:'Expiration' },
    { key:'auto_renewal', label:'Auto-renewal' },
    { key:'notice_required', label:'Notice Req.' },
    { key:'payment_terms', label:'Payment' },
    { key:'price_escalation', label:'Price Escalator' },
    { key:'deductibles', label:'Deductibles' },
    { key:'liability_limits', label:'Liability Limits' },
    { key:'delivery_lead_time', label:'Lead Time' },
    { key:'minimum_order', label:'MOQ' },
    { key:'freight_terms', label:'Freight' },
    { key:'warranty', label:'Warranty' }
  ];
  var listRowLabels = [
    { key:'strengths', label:'✅ Strengths', color:'#065f46' },
    { key:'key_benefits', label:'💡 Benefits', color:'#1e40af' },
    { key:'key_concerns', label:'⚠ Concerns', color:'#92400e' },
    { key:'red_flags', label:'🚩 Red Flags', color:'#991b1b' },
    { key:'key_exclusions', label:'🚫 Exclusions', color:'#7f1d1d' }
  ];

  html += '<div style="'+CARD2+';padding:0;overflow:auto">';
  html += '<table style="width:100%;min-width:'+(260 + 320*docs.length)+'px;border-collapse:collapse;font-size:.8rem;table-layout:fixed">';
  // Header row
  html += '<thead><tr>'
    + '<th style="position:sticky;left:0;background:#1a3a6b;color:#fff;padding:10px 12px;text-align:left;font-weight:600;width:240px">Field</th>';
  docs.forEach(function(d){
    var ven = bidsVendorById(d.vendor_id);
    var typeMeta = DOC_TYPE_COLORS[d.doc_type] || DOC_TYPE_COLORS.other;
    html += '<th style="background:#1a3a6b;color:#fff;padding:10px 12px;text-align:left;min-width:300px;vertical-align:top">'
      + '<div style="font-weight:700">'+bidsEsc(ven ? ven.name : 'Unknown')+(d.is_current_agreement ? ' <span style="background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:8px;font-size:.62rem">CURRENT</span>' : '')+'</div>'
      + '<div style="font-size:.72rem;opacity:.85;margin-top:2px">'+bidsEsc(d.title)+'</div>'
      + '<div style="margin-top:6px"><span style="background:'+typeMeta.bg+';color:'+typeMeta.color+';padding:1px 8px;border-radius:10px;font-size:.64rem;font-weight:600">'+DOC_TYPE_LABELS[d.doc_type]+'</span></div>'
      + '<div style="margin-top:6px"><button style="'+BB_SUB+';padding:3px 9px;font-size:.7rem" onclick="bidsShowDocumentDetail(\''+d.id+'\')">Details</button> '
      + '<button style="'+BB_P+';padding:3px 9px;font-size:.7rem" onclick="bidsDraftNegotiationEmail(\''+d.vendor_id+'\',\''+d.category_id+'\',\''+d.id+'\')">✉️ Negotiate</button></div>'
      + '</th>';
  });
  html += '</tr></thead><tbody>';

  rowLabels.forEach(function(rl, idx){
    var bg = idx % 2 === 0 ? '#fff' : '#fafbfc';
    html += '<tr>'
      + '<td style="position:sticky;left:0;background:'+bg+';padding:7px 12px;color:#64748b;font-weight:600;font-size:.76rem;border-right:1px solid #e2e8f0">'+bidsEsc(rl.label)+'</td>';
    docs.forEach(function(d){
      var v = (d.extracted_data || {})[rl.key];
      var display = (v === null || v === undefined || v === '') ? '<span style="color:#cbd5e1">—</span>' : bidsEsc(String(v));
      html += '<td style="padding:7px 12px;background:'+bg+';font-size:.8rem;color:#1e293b;vertical-align:top">'+display+'</td>';
    });
    html += '</tr>';
  });
  // List-field rows
  listRowLabels.forEach(function(rl){
    html += '<tr style="background:#fafbfc;border-top:2px solid #e2e8f0">'
      + '<td style="position:sticky;left:0;background:#fafbfc;padding:8px 12px;color:'+rl.color+';font-weight:700;font-size:.76rem;border-right:1px solid #e2e8f0">'+bidsEsc(rl.label)+'</td>';
    docs.forEach(function(d){
      var list = (d.extracted_data || {})[rl.key];
      if(!Array.isArray(list) || list.length === 0){
        html += '<td style="padding:8px 12px;background:#fafbfc;color:#cbd5e1">—</td>';
      } else {
        html += '<td style="padding:8px 12px;background:#fafbfc;font-size:.76rem;color:#334155;vertical-align:top">'
          + '<ul style="margin:0;padding-left:18px;line-height:1.5">'
          + list.slice(0, 8).map(function(i){ return '<li>'+bidsEsc(String(i))+'</li>'; }).join('')
          + (list.length > 8 ? '<li style="color:#94a3b8">+' + (list.length - 8) + ' more</li>' : '')
          + '</ul></td>';
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  html += '</div>';
  panel.innerHTML = html;
}

// ═══ AI RECOMMENDATION ════════════════════════════════════════════════════
// Renders the banner/card at the top of the Compare tab. Three states:
//   1. <2 vendors extracted → show disabled helper banner
//   2. No cached result + not loading → show "Run AI Recommendation" button
//   3. Loading → spinner
//   4. Cached result → render the full scorecard
// Banner is always rendered inline; the scorecard is a big card below.
function bidsRenderAIRecommendationBanner(vendorCount){
  if(vendorCount < 2){
    return '<div style="'+CARD2+';background:#f8fafc;border:1px dashed #cbd5e1;color:#64748b;padding:12px 14px;display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:1.2rem">🤖</span>'
      + '<div style="font-size:.82rem">Upload proposals from at least 2 vendors in this category to enable AI comparison.</div>'
      + '</div>';
  }

  var cached = _bidsAIRecommendations[_bidsCompareCategoryId];

  // Loading state
  if(_bidsAILoading){
    return '<div style="'+CARD2+';background:#eff6ff;border:1px solid #bfdbfe;padding:16px 18px;text-align:center">'
      + '<div class="spinner-wrap" style="display:inline-block"><div class="spinner"></div></div>'
      + '<div style="margin-top:8px;color:#1e40af;font-weight:600;font-size:.86rem">Claude is analyzing all '+vendorCount+' proposals…</div>'
      + '<div style="font-size:.74rem;color:#64748b;margin-top:4px">Usually takes 15–30 seconds.</div>'
      + '</div>';
  }

  // No cached result → CTA
  if(!cached){
    return '<div style="'+CARD2+';background:linear-gradient(135deg,#eff6ff,#ede9fe);border:1px solid #c7d2fe;padding:16px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
      + '<div style="flex:1;min-width:260px">'
      + '<div style="font-weight:700;font-size:.95rem;color:#1e293b;margin-bottom:4px">🤖 AI Recommendation</div>'
      + '<div style="font-size:.8rem;color:#475569">Let Claude read all '+vendorCount+' proposals and tell you which plan is the best deal — and why.</div>'
      + '</div>'
      + '<button style="'+BB_S+';padding:9px 18px;font-size:.82rem" onclick="bidsRunAIRecommendation()">✨ Analyze & Recommend</button>'
      + '</div>';
  }

  // Result rendered below — banner is just the header + re-run button
  var r = cached.comparison || {};
  var rec = r.recommendation || {};
  var confColor = rec.confidence === 'high' ? '#065f46'
                 : rec.confidence === 'medium' ? '#92400e'
                 : '#991b1b';
  var confBg = rec.confidence === 'high' ? '#d1fae5'
             : rec.confidence === 'medium' ? '#fef3c7'
             : '#fee2e2';
  var html = '<div style="'+CARD2+';background:#fff;border:2px solid #1a3a6b;padding:0;overflow:hidden">';

  // Header
  html += '<div style="background:linear-gradient(135deg,#1a3a6b,#3730a3);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
    + '<span style="font-size:1.4rem">🤖</span>'
    + '<div style="flex:1;min-width:220px">'
    + '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;opacity:.85">AI Recommendation</div>'
    + '<div style="font-size:1rem;font-weight:700">'+bidsEsc(rec.winner_vendor_name || 'Analysis complete')+'</div>'
    + '</div>'
    + (rec.confidence ? '<span style="background:'+confBg+';color:'+confColor+';padding:3px 10px;border-radius:12px;font-size:.7rem;font-weight:700;text-transform:uppercase">'+bidsEsc(rec.confidence)+' confidence</span>' : '')
    + '<button style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.35);padding:5px 12px;border-radius:6px;font-size:.72rem;font-weight:600;cursor:pointer" onclick="bidsRunAIRecommendation(true)">↻ Re-analyze</button>'
    + '</div>';

  // Headline + key reasons
  html += '<div style="padding:14px 18px">';
  if(rec.headline){
    html += '<div style="font-size:.9rem;color:#0f172a;margin-bottom:10px;line-height:1.5"><strong>Why:</strong> '+bidsEsc(rec.headline)+'</div>';
  }
  if(Array.isArray(rec.key_reasons) && rec.key_reasons.length){
    html += '<ul style="margin:0 0 14px;padding-left:22px;line-height:1.6">';
    rec.key_reasons.forEach(function(reason){
      html += '<li style="font-size:.82rem;color:#334155;margin-bottom:3px">'+bidsEsc(String(reason))+'</li>';
    });
    html += '</ul>';
  }

  // Scorecards
  if(Array.isArray(r.scorecards) && r.scorecards.length){
    html += '<div style="font-weight:700;font-size:.78rem;color:#475569;margin:14px 0 8px;text-transform:uppercase;letter-spacing:.05em">Vendor Scorecards</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">';
    r.scorecards.forEach(function(sc){
      var isWinner = sc.vendor_id === rec.winner_vendor_id;
      var score = Math.max(0, Math.min(10, Number(sc.score) || 0));
      var scoreColor = score >= 8 ? '#065f46' : score >= 6 ? '#1e40af' : score >= 4 ? '#92400e' : '#991b1b';
      html += '<div style="background:'+(isWinner?'#ecfdf5':'#fafbfc')+';border:1px solid '+(isWinner?'#10b981':'#e2e8f0')+';border-radius:8px;padding:10px 12px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
        + '<div style="font-weight:700;font-size:.84rem;color:#0f172a">'+bidsEsc(sc.vendor_name || '')+(isWinner ? ' 🏆' : '')+'</div>'
        + '<div style="background:'+scoreColor+';color:#fff;padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700">'+score+'/10</div>'
        + '</div>';
      if(sc.one_line_summary){
        html += '<div style="font-size:.76rem;color:#475569;margin-bottom:6px;line-height:1.4">'+bidsEsc(sc.one_line_summary)+'</div>';
      }
      if(Array.isArray(sc.pros) && sc.pros.length){
        html += '<div style="font-size:.74rem;color:#065f46;margin-bottom:3px"><strong>✅</strong> '+sc.pros.map(function(p){ return bidsEsc(String(p)); }).join(' · ')+'</div>';
      }
      if(Array.isArray(sc.cons) && sc.cons.length){
        html += '<div style="font-size:.74rem;color:#991b1b"><strong>⚠</strong> '+sc.cons.map(function(c){ return bidsEsc(String(c)); }).join(' · ')+'</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Side-by-side highlights
  if(Array.isArray(r.side_by_side_highlights) && r.side_by_side_highlights.length){
    html += '<div style="font-weight:700;font-size:.78rem;color:#475569;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.05em">Where They Differ</div>';
    html += '<div style="background:#fafbfc;border-radius:8px;padding:10px 12px">';
    r.side_by_side_highlights.forEach(function(h){
      html += '<div style="border-bottom:1px solid #e2e8f0;padding:8px 0">'
        + '<div style="font-weight:600;font-size:.78rem;color:#1a3a6b;margin-bottom:4px">'+bidsEsc(h.dimension || '')+'</div>';
      if(Array.isArray(h.values)){
        html += '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:.76rem;color:#334155;margin-bottom:4px">';
        h.values.forEach(function(v){
          html += '<span><strong>'+bidsEsc(v.vendor_name || '')+':</strong> '+bidsEsc(String(v.value || '—'))+'</span>';
        });
        html += '</div>';
      }
      if(h.note){
        html += '<div style="font-size:.74rem;color:#64748b;font-style:italic">'+bidsEsc(h.note)+'</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Risks + next steps side-by-side
  if((Array.isArray(r.risks_to_discuss) && r.risks_to_discuss.length)
      || (Array.isArray(r.recommended_next_steps) && r.recommended_next_steps.length)){
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:18px">';
    if(Array.isArray(r.risks_to_discuss) && r.risks_to_discuss.length){
      html += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px">'
        + '<div style="font-weight:700;font-size:.78rem;color:#991b1b;margin-bottom:6px">⚠ Risks to Discuss</div>'
        + '<ul style="margin:0;padding-left:18px;line-height:1.5">';
      r.risks_to_discuss.forEach(function(rr){
        html += '<li style="font-size:.76rem;color:#7f1d1d;margin-bottom:3px">'+bidsEsc(String(rr))+'</li>';
      });
      html += '</ul></div>';
    }
    if(Array.isArray(r.recommended_next_steps) && r.recommended_next_steps.length){
      html += '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px">'
        + '<div style="font-weight:700;font-size:.78rem;color:#1e40af;margin-bottom:6px">→ Recommended Next Steps</div>'
        + '<ul style="margin:0;padding-left:18px;line-height:1.5">';
      r.recommended_next_steps.forEach(function(ns){
        html += '<li style="font-size:.76rem;color:#1e3a8a;margin-bottom:3px">'+bidsEsc(String(ns))+'</li>';
      });
      html += '</ul></div>';
    }
    html += '</div>';
  }

  html += '</div></div>';
  return html;
}

function bidsRunAIRecommendation(force){
  if(!_bidsCompareCategoryId) return;
  if(_bidsAILoading) return;
  // `force=true` from the Re-analyze button blows away the cache.
  if(force) _bidsAIRecommendations[_bidsCompareCategoryId] = undefined;

  _bidsAILoading = true;
  bidsRenderCompare();

  apiCall('POST','/api/bids?action=compare_vendors', {
    category_id: _bidsCompareCategoryId
  }).then(function(r){
    _bidsAIRecommendations[_bidsCompareCategoryId] = r;
  }).catch(function(err){
    toast('⚠️ AI recommendation failed: ' + (err && err.message || 'unknown error'));
  }).finally(function(){
    _bidsAILoading = false;
    bidsRenderCompare();
  });
}

window.bidsRunAIRecommendation = bidsRunAIRecommendation;

// ═══ PRINT COMPARISON ════════════════════════════════════════════════════
// Build a print-optimized HTML version of the current Compare tab and open
// it in a new window via the shared printReport() helper. Landscape by
// default so the side-by-side table fits even with 4+ vendors.
//
// Output sections (each optional depending on available data):
//   1. AI recommendation: winner + confidence + key reasons
//   2. Vendor scorecards (from the AI result)
//   3. "Where They Differ" — AI side-by-side highlights
//   4. Risks to discuss + recommended next steps
//   5. Full side-by-side comparison table of every extracted field
function bidsPrintCompare(){
  if(!_bidsCompareCategoryId){ toast('Pick a category first'); return; }
  var cat = bidsCategoryById(_bidsCompareCategoryId);
  if(!cat){ toast('Category not found'); return; }
  var docs = bidsDocsInCategory(_bidsCompareCategoryId).filter(function(d){
    return d.extraction_status === 'done' && d.extracted_data;
  });
  if(docs.length === 0){ toast('No extracted documents to print.'); return; }

  // Dedupe to one doc per vendor (match the AI backend's DISTINCT ON behavior
  // so the printed table agrees with the AI scorecards if present).
  var seenVendor = {};
  var uniqDocs = [];
  docs.forEach(function(d){
    if(seenVendor[d.vendor_id]) return;
    seenVendor[d.vendor_id] = true;
    uniqDocs.push(d);
  });

  var ai = _bidsAIRecommendations[_bidsCompareCategoryId];
  var rec = ai && ai.comparison && ai.comparison.recommendation;
  var scorecards = ai && ai.comparison && ai.comparison.scorecards;
  var highlights = ai && ai.comparison && ai.comparison.side_by_side_highlights;
  var risks = ai && ai.comparison && ai.comparison.risks_to_discuss;
  var nextSteps = ai && ai.comparison && ai.comparison.recommended_next_steps;

  // Page-level CSS: force landscape, scale font for readability, preserve
  // background colors (for winner highlighting), allow tables to span pages.
  var pageStyle = '<style>'
    + '@page { size: letter landscape; margin: 0.4in; }'
    + '@media print { body { padding: 8px !important; } .print-break { page-break-before: always; } }'
    + '*{print-color-adjust:exact;-webkit-print-color-adjust:exact}'
    + '.pcmp-section{margin:14px 0 8px}'
    + '.pcmp-section h2{font-size:1rem;color:#1a3a6b;border-bottom:2px solid #1a3a6b;padding-bottom:4px;margin:0 0 8px}'
    + '.pcmp-box{background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;margin-bottom:10px}'
    + '.pcmp-winner{background:#ecfdf5;border-color:#10b981}'
    + '.pcmp-conf{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700;text-transform:uppercase;margin-left:8px}'
    + '.pcmp-conf-high{background:#d1fae5;color:#065f46}'
    + '.pcmp-conf-medium{background:#fef3c7;color:#92400e}'
    + '.pcmp-conf-low{background:#fee2e2;color:#991b1b}'
    + '.pcmp-reasons{margin:6px 0 0;padding-left:20px;line-height:1.5}'
    + '.pcmp-reasons li{font-size:.82rem;margin-bottom:2px}'
    + '.pcmp-score{background:#1a3a6b;color:#fff;padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700;display:inline-block}'
    + '.pcmp-score-high{background:#065f46}'
    + '.pcmp-score-mid{background:#1e40af}'
    + '.pcmp-score-low{background:#92400e}'
    + '.pcmp-table{width:100%;border-collapse:collapse;font-size:.78rem;margin:6px 0}'
    + '.pcmp-table th{background:#1a3a6b;color:#fff;padding:6px 8px;text-align:left;font-weight:600;vertical-align:top}'
    + '.pcmp-table td{padding:5px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;color:#0f172a}'
    + '.pcmp-table tr:nth-child(even) td{background:#fafbfc}'
    + '.pcmp-label{background:#f1f5f9;color:#334155;font-weight:600;width:180px}'
    + '.pcmp-note{font-size:.74rem;color:#64748b;font-style:italic;margin-top:4px}'
    + '.pcmp-chip{display:inline-block;background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:8px;font-size:.66rem;font-weight:600;margin-left:4px}'
    + '.pcmp-pros{color:#065f46}'
    + '.pcmp-cons{color:#991b1b}'
    + '.pcmp-risks{background:#fef2f2;border-color:#fecaca}'
    + '.pcmp-steps{background:#eff6ff;border-color:#bfdbfe}'
    + '.pcmp-list{margin:0;padding-left:18px;line-height:1.5}'
    + '.pcmp-list li{font-size:.78rem;margin-bottom:3px}'
    + '</style>';

  var content = pageStyle;

  // ── 1. AI Recommendation
  if(rec){
    var confClass = rec.confidence === 'high' ? 'pcmp-conf-high'
                  : rec.confidence === 'medium' ? 'pcmp-conf-medium'
                  : 'pcmp-conf-low';
    content += '<div class="pcmp-section"><h2>🤖 AI Recommendation</h2>'
      + '<div class="pcmp-box pcmp-winner">'
      + '<div style="font-weight:700;font-size:1.05rem">🏆 ' + bidsEsc(rec.winner_vendor_name || 'Winner')
      + (rec.confidence ? '<span class="pcmp-conf '+confClass+'">' + bidsEsc(rec.confidence) + ' confidence</span>' : '')
      + '</div>';
    if(rec.headline){
      content += '<div style="margin-top:6px;font-size:.86rem;color:#0f172a"><strong>Why:</strong> ' + bidsEsc(rec.headline) + '</div>';
    }
    if(Array.isArray(rec.key_reasons) && rec.key_reasons.length){
      content += '<ol class="pcmp-reasons">';
      rec.key_reasons.forEach(function(r){ content += '<li>' + bidsEsc(String(r)) + '</li>'; });
      content += '</ol>';
    }
    content += '</div></div>';
  }

  // ── 2. Vendor Scorecards (AI)
  if(Array.isArray(scorecards) && scorecards.length){
    content += '<div class="pcmp-section"><h2>Vendor Scorecards</h2><table class="pcmp-table">'
      + '<thead><tr><th style="width:22%">Vendor</th><th style="width:8%">Score</th><th style="width:30%">Summary</th><th style="width:20%">Pros</th><th style="width:20%">Cons</th></tr></thead><tbody>';
    scorecards.forEach(function(sc){
      var isWinner = rec && sc.vendor_id === rec.winner_vendor_id;
      var score = Math.max(0, Math.min(10, Number(sc.score) || 0));
      var scoreClass = score >= 8 ? 'pcmp-score-high'
                     : score >= 6 ? 'pcmp-score-mid'
                     : 'pcmp-score-low';
      content += '<tr>'
        + '<td style="font-weight:600">' + bidsEsc(sc.vendor_name || '') + (isWinner ? ' <span class="pcmp-chip">🏆 WINNER</span>' : '') + '</td>'
        + '<td><span class="pcmp-score ' + scoreClass + '">' + score + '/10</span></td>'
        + '<td>' + bidsEsc(sc.one_line_summary || '') + '</td>'
        + '<td class="pcmp-pros">' + (Array.isArray(sc.pros) ? sc.pros.map(bidsEsc).join(' · ') : '') + '</td>'
        + '<td class="pcmp-cons">' + (Array.isArray(sc.cons) ? sc.cons.map(bidsEsc).join(' · ') : '') + '</td>'
        + '</tr>';
    });
    content += '</tbody></table></div>';
  }

  // ── 3. Where They Differ
  if(Array.isArray(highlights) && highlights.length){
    content += '<div class="pcmp-section"><h2>Where They Differ</h2>';
    highlights.forEach(function(h){
      content += '<div class="pcmp-box">'
        + '<div style="font-weight:700;color:#1a3a6b;font-size:.86rem;margin-bottom:4px">' + bidsEsc(h.dimension || '') + '</div>';
      if(Array.isArray(h.values) && h.values.length){
        content += '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:.8rem">';
        h.values.forEach(function(v){
          content += '<div><strong>' + bidsEsc(v.vendor_name || '') + ':</strong> ' + bidsEsc(String(v.value || '—')) + '</div>';
        });
        content += '</div>';
      }
      if(h.note){ content += '<div class="pcmp-note">' + bidsEsc(h.note) + '</div>'; }
      content += '</div>';
    });
    content += '</div>';
  }

  // ── 4. Risks + Next Steps
  if((Array.isArray(risks) && risks.length) || (Array.isArray(nextSteps) && nextSteps.length)){
    content += '<div class="pcmp-section"><h2>Action Items</h2>';
    if(Array.isArray(risks) && risks.length){
      content += '<div class="pcmp-box pcmp-risks">'
        + '<div style="font-weight:700;color:#991b1b;margin-bottom:4px">⚠ Risks to Discuss</div>'
        + '<ul class="pcmp-list">';
      risks.forEach(function(r){ content += '<li>' + bidsEsc(String(r)) + '</li>'; });
      content += '</ul></div>';
    }
    if(Array.isArray(nextSteps) && nextSteps.length){
      content += '<div class="pcmp-box pcmp-steps">'
        + '<div style="font-weight:700;color:#1e40af;margin-bottom:4px">→ Recommended Next Steps</div>'
        + '<ul class="pcmp-list">';
      nextSteps.forEach(function(s){ content += '<li>' + bidsEsc(String(s)) + '</li>'; });
      content += '</ul></div>';
    }
    content += '</div>';
  }

  // ── 5. Full Side-by-side Comparison Table
  // Force page break before this section if AI content exists — keeps the
  // wide table on its own page for legibility.
  content += '<div class="pcmp-section' + (ai ? ' print-break' : '') + '"><h2>Side-by-side Comparison — ' + bidsEsc(cat.name) + '</h2>';

  // Build the same field/list structure as bidsRenderCompare so the printed
  // table mirrors what's on screen.
  var rowLabels = [
    { key:'vendor_name', label:'Vendor' },
    { key:'price_summary', label:'Pricing' },
    { key:'contract_term', label:'Term' },
    { key:'effective_date', label:'Effective' },
    { key:'expiration_date', label:'Expiration' },
    { key:'auto_renewal', label:'Auto-renewal' },
    { key:'notice_required', label:'Notice Req.' },
    { key:'payment_terms', label:'Payment' },
    { key:'price_escalation', label:'Price Escalator' },
    { key:'deductibles', label:'Deductibles' },
    { key:'liability_limits', label:'Liability Limits' },
    { key:'delivery_lead_time', label:'Lead Time' },
    { key:'minimum_order', label:'MOQ' },
    { key:'freight_terms', label:'Freight' },
    { key:'warranty', label:'Warranty' }
  ];
  var listRowLabels = [
    { key:'strengths', label:'✅ Strengths' },
    { key:'key_benefits', label:'💡 Benefits' },
    { key:'key_concerns', label:'⚠ Concerns' },
    { key:'red_flags', label:'🚩 Red Flags' },
    { key:'key_exclusions', label:'🚫 Exclusions' }
  ];

  content += '<table class="pcmp-table">'
    + '<thead><tr><th class="pcmp-label">Field</th>';
  uniqDocs.forEach(function(d){
    var ven = bidsVendorById(d.vendor_id);
    content += '<th>' + bidsEsc(ven ? ven.name : 'Unknown')
      + (d.is_current_agreement ? ' <span class="pcmp-chip">CURRENT</span>' : '')
      + '<div style="font-size:.72rem;opacity:.85;font-weight:400;margin-top:2px">' + bidsEsc(d.title || '') + '</div>'
      + '</th>';
  });
  content += '</tr></thead><tbody>';

  rowLabels.forEach(function(rl){
    content += '<tr><td class="pcmp-label">' + bidsEsc(rl.label) + '</td>';
    uniqDocs.forEach(function(d){
      var v = (d.extracted_data || {})[rl.key];
      var display = (v === null || v === undefined || v === '') ? '—' : bidsEsc(String(v));
      content += '<td>' + display + '</td>';
    });
    content += '</tr>';
  });
  listRowLabels.forEach(function(rl){
    content += '<tr><td class="pcmp-label">' + bidsEsc(rl.label) + '</td>';
    uniqDocs.forEach(function(d){
      var list = (d.extracted_data || {})[rl.key];
      if(!Array.isArray(list) || list.length === 0){
        content += '<td>—</td>';
      } else {
        content += '<td><ul style="margin:0;padding-left:16px;line-height:1.4">'
          + list.slice(0, 8).map(function(i){ return '<li>' + bidsEsc(String(i)) + '</li>'; }).join('')
          + (list.length > 8 ? '<li style="color:#94a3b8">+' + (list.length - 8) + ' more</li>' : '')
          + '</ul></td>';
      }
    });
    content += '</tr>';
  });

  content += '</tbody></table></div>';

  // Hand off to the shared print helper. Title becomes the window title and
  // shows in the print header bar.
  var title = 'Contract Bids — ' + cat.name + ' Comparison';
  if(typeof printReport === 'function'){
    printReport(title, content);
  } else {
    // Fallback if print.js didn't load for some reason.
    var w = window.open('', '_blank', 'width=1100,height=800');
    w.document.write('<!DOCTYPE html><html><head><title>' + title + '</title></head><body>' + content + '</body></html>');
    w.document.close();
  }
}

window.bidsPrintCompare = bidsPrintCompare;

// Negotiation email drafting
function bidsDraftNegotiationEmail(vendorId, categoryId, targetDocId){
  var overlay = document.createElement('div');
  overlay.id = 'bne-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:720px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">'
    + '<div id="bne-body"><div style="text-align:center;padding:30px"><div class="spinner-wrap" style="display:inline-block"><div class="spinner"></div></div><div style="margin-top:8px;color:#64748b;font-size:.86rem">Claude is drafting your negotiation email…</div></div></div></div>';
  overlay.onclick = function(e){ if(e.target===overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  apiCall('POST','/api/bids?action=generate_negotiation_email', {
    vendor_id: vendorId, category_id: categoryId, target_doc_id: targetDocId
  }).then(function(r){
    var email = r.email || {};
    var v = r.vendor || {};
    var body = document.getElementById('bne-body');
    var mailto = 'mailto:' + (v.contact_email || '')
      + '?subject=' + encodeURIComponent(email.subject || '')
      + '&body=' + encodeURIComponent(email.body || '');
    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">'
      + '<div><div style="font-weight:700;font-size:1rem">Negotiation Email — '+bidsEsc(v.name || '')+'</div>'
      + '<div style="font-size:.76rem;color:#64748b;margin-top:2px">'+bidsEsc(r.category || '')+' · '+ (r.has_current_agreement ? 'using your current agreement as a baseline' : 'no current agreement on file') +' · ' + (r.competing_count||0) + ' competing proposal' + ((r.competing_count||0)===1?'':'s') + ' referenced</div></div>'
      + '<button style="'+BB_SUB+'" onclick="document.getElementById(\'bne-overlay\').remove()">Close</button></div>';
    if(Array.isArray(email.negotiation_points) && email.negotiation_points.length > 0){
      h += '<div style="background:#f0f7ff;border-left:3px solid #3b82f6;border-radius:6px;padding:10px 12px;margin-bottom:12px">'
        + '<div style="font-weight:700;font-size:.78rem;color:#1e40af;margin-bottom:6px">Why Claude raised these points:</div>'
        + '<ul style="margin:0;padding-left:22px;font-size:.78rem;color:#1e40af;line-height:1.5">';
      email.negotiation_points.forEach(function(p){
        h += '<li style="margin-bottom:3px"><strong>'+bidsEsc(p.point||'')+'</strong>'+(p.justification ? ' — '+bidsEsc(p.justification) : '')+'</li>';
      });
      h += '</ul></div>';
    }
    h += '<label style="font-size:.76rem;color:#64748b">Subject</label>'
      + '<input id="bne-subject" type="text" value="'+bidsEsc(email.subject||'')+'" style="'+BINP+'">'
      + '<label style="font-size:.76rem;color:#64748b">Body <span style="color:#94a3b8">(edit freely before sending)</span></label>'
      + '<textarea id="bne-body-text" style="'+BINP+';resize:vertical;min-height:280px;font-family:inherit">'+bidsEsc(email.body||'')+'</textarea>';
    if(v.contact_email){
      h += '<div style="font-size:.78rem;color:#64748b;margin:4px 0">Recipient: <strong>'+bidsEsc(v.contact_email)+'</strong></div>';
    } else {
      h += '<div style="font-size:.78rem;color:#dc2626;margin:4px 0">⚠ No contact email on file for this vendor. Add one under Setup → Vendors to pre-fill the "to" address.</div>';
    }
    h += '<div style="display:flex;gap:8px;margin-top:10px">'
      + '<button style="'+BB_P+';flex:1" onclick="bidsSendNegotiationMailto(\''+bidsEsc(v.contact_email||'')+'\')">Open in Email Client</button>'
      + '<button style="'+BB_SUB+'" onclick="bidsCopyNegotiationBody()">Copy Body</button>'
      + '</div>';
    body.innerHTML = h;
  }).catch(function(e){
    document.getElementById('bne-body').innerHTML = '<div style="padding:20px;color:#dc2626">Error drafting email: '+bidsEsc((e&&e.message)||'unknown')+'</div>';
  });
}
window.bidsDraftNegotiationEmail = bidsDraftNegotiationEmail;

function bidsSendNegotiationMailto(toEmail){
  var s = document.getElementById('bne-subject').value;
  var b = document.getElementById('bne-body-text').value;
  var url = 'mailto:' + (toEmail || '') + '?subject=' + encodeURIComponent(s) + '&body=' + encodeURIComponent(b);
  window.location.href = url;
}
window.bidsSendNegotiationMailto = bidsSendNegotiationMailto;
function bidsCopyNegotiationBody(){
  var s = document.getElementById('bne-subject').value;
  var b = document.getElementById('bne-body-text').value;
  var combined = 'Subject: ' + s + '\n\n' + b;
  if(navigator.clipboard){
    navigator.clipboard.writeText(combined).then(function(){ alert('Copied email subject + body to clipboard.'); });
  } else {
    alert('Clipboard API not available. Select the text manually and copy.');
  }
}
window.bidsCopyNegotiationBody = bidsCopyNegotiationBody;

// ═══ Tab: Setup (categories + vendors CRUD) ════════════════════════════════
function bidsRenderSetup(){
  var panel = document.getElementById('bids-panel');
  if(!panel) return;

  var html = '<div style="padding:14px;max-width:820px;margin:0 auto">';
  // Categories
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
    + '<div style="font-weight:700;font-size:.95rem">Categories</div>'
    + '<button style="'+BB_P+'" onclick="bidsAddCategory()">+ Add Category</button></div>';
  if(_bidsState.categories.length === 0){
    html += '<div style="'+CARD2+';color:#94a3b8;text-align:center;padding:14px">No categories yet. Click <strong>+ Add Category</strong> (try Insurance, Packaging, Uniforms, Supplies, Waste).</div>';
  } else {
    html += '<div style="'+CARD2+';padding:0;overflow:hidden">';
    _bidsState.categories.forEach(function(c){
      html += '<div style="padding:10px 14px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        + '<div style="flex:1;min-width:200px"><div style="font-weight:600;font-size:.88rem;color:#1a3a6b">'+bidsEsc(c.name)+'</div>'
        + (c.description ? '<div style="color:#64748b;font-size:.76rem;margin-top:2px">'+bidsEsc(c.description)+'</div>' : '')
        + '</div><div>'
        + '<button style="'+BB_SUB+';padding:3px 9px;font-size:.72rem" onclick="bidsEditCategory(\''+c.id+'\')">Edit</button> '
        + '<button style="'+BB_D+'" onclick="bidsDeleteCategory(\''+c.id+'\')">Del</button>'
        + '</div></div>';
    });
    html += '</div>';
  }

  // Vendors
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin:20px 0 10px">'
    + '<div style="font-weight:700;font-size:.95rem">Vendors</div>'
    + '<button style="'+BB_P+'" onclick="bidsAddVendor()">+ Add Vendor</button></div>';
  if(_bidsState.vendors.length === 0){
    html += '<div style="'+CARD2+';color:#94a3b8;text-align:center;padding:14px">No vendors yet. Vendors can also be added on the fly during upload.</div>';
  } else {
    html += '<div style="'+CARD2+';padding:0;overflow:hidden">';
    _bidsState.vendors.forEach(function(v){
      html += '<div style="padding:10px 14px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'
        + '<div style="flex:1;min-width:200px"><div style="font-weight:600;font-size:.88rem;color:#1a3a6b">'+bidsEsc(v.name)+'</div>'
        + '<div style="color:#64748b;font-size:.76rem;margin-top:2px">'
          + (v.contact_name ? bidsEsc(v.contact_name) + ' · ' : '')
          + (v.contact_email ? '<a href="mailto:'+bidsEsc(v.contact_email)+'" style="color:#2563eb">'+bidsEsc(v.contact_email)+'</a>' : '(no email on file)')
          + (v.phone ? ' · '+bidsEsc(v.phone) : '')
        + '</div></div><div>'
        + '<button style="'+BB_SUB+';padding:3px 9px;font-size:.72rem" onclick="bidsEditVendor(\''+v.id+'\')">Edit</button> '
        + '<button style="'+BB_D+'" onclick="bidsDeleteVendor(\''+v.id+'\')">Del</button>'
        + '</div></div>';
    });
    html += '</div>';
  }
  html += '</div>';
  panel.innerHTML = html;
}
function bidsAddCategory(){
  var name = prompt('Category name (e.g., Insurance, Packaging, Uniforms, Supplies):');
  if(!name) return;
  var desc = prompt('Description (optional):', '') || '';
  apiCall('POST','/api/bids?action=save_category', { name:name.trim(), description:desc })
    .then(function(){ bidsRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function bidsEditCategory(id){
  var c = bidsCategoryById(id);
  if(!c) return;
  var name = prompt('Category name:', c.name);
  if(!name) return;
  var desc = prompt('Description:', c.description || '');
  apiCall('POST','/api/bids?action=save_category', { id:id, name:name.trim(), description:desc||'' })
    .then(function(){ bidsRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function bidsDeleteCategory(id){
  var c = bidsCategoryById(id);
  if(!c) return;
  var n = bidsDocsInCategory(id).length;
  if(!confirm('Archive category "'+c.name+'"?\n\n'+n+' document'+(n===1?'':'s')+' in this category will stay in the DB but be hidden from lists until unarchived.')) return;
  apiCall('POST','/api/bids?action=delete_category', { id:id })
    .then(function(){ bidsRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function bidsAddVendor(){
  var name = prompt('Vendor name:');
  if(!name) return;
  var contact_name = prompt('Contact name (optional):', '') || '';
  var contact_email = prompt('Contact email (optional):', '') || '';
  var phone = prompt('Phone (optional):', '') || '';
  var website = prompt('Website (optional):', '') || '';
  apiCall('POST','/api/bids?action=save_vendor', { name:name.trim(), contact_name:contact_name, contact_email:contact_email, phone:phone, website:website })
    .then(function(){ bidsRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function bidsEditVendor(id){
  var v = bidsVendorById(id);
  if(!v) return;
  var name = prompt('Vendor name:', v.name);
  if(!name) return;
  var contact_name = prompt('Contact name:', v.contact_name || '');
  var contact_email = prompt('Contact email:', v.contact_email || '');
  var phone = prompt('Phone:', v.phone || '');
  var website = prompt('Website:', v.website || '');
  apiCall('POST','/api/bids?action=save_vendor', {
    id:id, name:name.trim(),
    contact_name:contact_name||'', contact_email:contact_email||'',
    phone:phone||'', website:website||''
  }).then(function(){ bidsRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
function bidsDeleteVendor(id){
  var v = bidsVendorById(id);
  if(!v) return;
  if(!confirm('Archive vendor "'+v.name+'"?\n\nTheir documents will stay but hidden from active lists.')) return;
  apiCall('POST','/api/bids?action=delete_vendor', { id:id })
    .then(function(){ bidsRefresh(); })
    .catch(function(e){ alert('Error: '+(e&&e.message?e.message:'unknown')); });
}
window.bidsAddCategory = bidsAddCategory;
window.bidsEditCategory = bidsEditCategory;
window.bidsDeleteCategory = bidsDeleteCategory;
window.bidsAddVendor = bidsAddVendor;
window.bidsEditVendor = bidsEditVendor;
window.bidsDeleteVendor = bidsDeleteVendor;

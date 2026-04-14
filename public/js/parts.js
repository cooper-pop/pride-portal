// parts.js - Parts Inventory Widget
// Tabs: Inventory | Invoices | Manuals | Cross-Ref | Orders

var _partsTab = 'inventory';
var _partsData = { inventory:[], invoices:[], manuals:[], crossref:[], orders:[] };
var _editingPart = null;
var _editingInvoice = null;
var _editingRef = null;

function buildPartsWidget() {
  var wt = document.getElementById('widget-tabs');
  var wc = document.getElementById('widget-content');
  wt.innerHTML = ['inventory','invoices','manuals','crossref','orders'].map(function(t){
    var labels = {inventory:'📦 Inventory',invoices:'🧾 Invoices',manuals:'📖 Manuals',crossref:'🔄 Cross-Ref',orders:'🚚 Orders'};
    return '<button class="wtab" onclick="partsShowTab(\'' + t + '\')" id="ptab-' + t + '" style="padding:6px 14px;border:none;background:transparent;cursor:pointer;font-size:.8rem;border-bottom:2px solid transparent;color:#94a3b8">' + labels[t] + '</button>';
  }).join('');
  wc.innerHTML = '<div id="parts-panel" style="padding:0"></div>';
  partsInit();
}

function partsInit() {
  var token = (function(){ try { return JSON.parse(localStorage.getItem('potp_v2_session')).token; } catch(e){ return ''; } })();
  // Init DB then load
  apiCall('GET','/api/parts?action=init_parts_db').then(function(){
    partsShowTab('inventory');
  }).catch(function(){ partsShowTab('inventory'); });
}

function partsShowTab(tab) {
  _partsTab = tab;
  ['inventory','invoices','manuals','crossref','orders'].forEach(function(t){
    var btn = document.getElementById('ptab-' + t);
    if (btn) {
      btn.style.borderBottomColor = t===tab ? '#1a3a6b' : 'transparent';
      btn.style.color = t===tab ? '#1a3a6b' : '#94a3b8';
      btn.style.fontWeight = t===tab ? '600' : '400';
    }
  });
  var panel = document.getElementById('parts-panel');
  if (!panel) return;
  panel.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:.8rem">Loading...</div>';
  var actions = {inventory:'get_parts',invoices:'get_invoices',manuals:'get_manuals',crossref:'get_cross_ref',orders:'get_parts_orders'};
  apiCall('GET','/api/parts?action=' + actions[tab]).then(function(data){
    _partsData[tab] = Array.isArray(data) ? data : [];
    var renders = {inventory:partsRenderInventory,invoices:partsRenderInvoices,manuals:partsRenderManuals,crossref:partsRenderCrossRef,orders:partsRenderOrders};
    if (renders[tab]) renders[tab]();
  }).catch(function(e){
    panel.innerHTML = '<div style="padding:20px;color:#ef4444">Error loading data</div>';
  });
}
window.partsShowTab = partsShowTab;

// ===== STYLES =====
var CARD = 'background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)';
var BTN_PRIMARY = 'background:#1a3a6b;color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600';
var BTN_SECONDARY = 'background:#f1f5f9;color:#1e293b;border:1px solid #e2e8f0;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:.8rem';
var BTN_DANGER = 'background:#fee2e2;color:#ef4444;border:none;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:.75rem';
var BTN_SUCCESS = 'background:#d1fae5;color:#065f46;border:none;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:.75rem';
var BTN_INFO = 'background:#dbeafe;color:#1d4ed8;border:none;padding:5px 10px;border-radius:5px;cursor:pointer;font-size:.75rem';
var INPUT = 'width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:.82rem;box-sizing:border-box;outline:none';
var LABEL = 'display:block;font-size:.75rem;font-weight:600;color:#64748b;margin-bottom:3px;text-transform:uppercase;letter-spacing:.03em';

// ===== INVENTORY =====
function partsRenderInventory() {
  var panel = document.getElementById('parts-panel');
  var inv = _partsData.inventory;
  var lowStock = inv.filter(function(p){ return parseFloat(p.qty_on_hand) <= parseFloat(p.qty_minimum||0); });

  var html = '<div style="padding:16px">';
  // Header
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  html += '<div><div style="font-weight:700;font-size:.95rem;color:#1e293b">Parts Inventory</div>';
  if (lowStock.length) html += '<div style="font-size:.72rem;color:#ef4444;margin-top:2px">â ï¸ ' + lowStock.length + ' part(s) below minimum stock</div>';
  html += '</div>';
  html += '<button onclick="partsSmartSearch(\'\',\'\')" style="padding:7px 14px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.8rem;font-weight:600;margin-right:6px">🔍 Find Parts</button><button onclick="partsEditPart(null)" style="' + BTN_PRIMARY + '">+ Add Part</button></div>';

  // Search
  html += '<input id="parts-search" placeholder="🔍 Search part number, description..." style="' + INPUT + ';margin-bottom:12px" oninput="partsFilterInventory()" />';

  // Table
  if (!inv.length) {
    html += '<div style="text-align:center;padding:40px;color:#94a3b8">No parts yet. Add your first part!</div>';
  } else {
    html += '<div id="parts-inv-table">';
    html += partsInventoryTable(inv);
    html += '</div>';
  }
  html += '</div>';
  panel.innerHTML = html;
}

function partsInventoryTable(parts) {
  var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.8rem">';
  html += '<thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">';
  ['Part #','Description','Mfr','Qty','Min','Cost','Supplier','Location','Actions'].forEach(function(h){
    html += '<th style="padding:8px 10px;text-align:left;font-weight:600;color:#64748b;white-space:nowrap">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  parts.forEach(function(p){
    var low = parseFloat(p.qty_on_hand) <= parseFloat(p.qty_minimum||0);
    var rowBg = low ? '#fff5f5' : '#fff';
    html += '<tr style="border-bottom:1px solid #f1f5f9;background:' + rowBg + '">';
    html += '<td style="padding:8px 10px;font-weight:600;color:#1a3a6b">' + (p.part_number||'') + '</td>';
    html += '<td style="padding:8px 10px">' + (p.description||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b">' + (p.manufacturer||'') + '</td>';
    html += '<td style="padding:8px 10px;font-weight:600;color:' + (low?'#ef4444':'#16a34a') + '">' + (p.qty_on_hand||0) + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b">' + (p.qty_minimum||0) + '</td>';
    html += '<td style="padding:8px 10px">$' + parseFloat(p.unit_cost||0).toFixed(2) + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b">' + (p.supplier||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b">' + (p.location||'') + '</td>';
    html += '<td style="padding:8px 10px;white-space:nowrap">';
    html += '<button style="' + BTN_INFO + ';margin-right:4px" onclick="partsSmartSearch(' + JSON.stringify(p.part_number) + ',' + JSON.stringify(p.description) + ')">🔍 Buy</button>';
    html += '<button style="' + BTN_SECONDARY + ';margin-right:4px;padding:5px 8px;font-size:.75rem" onclick="partsEditPart(' + JSON.stringify(p.id) + ')">✏️</button>';
    html += '<button style="' + BTN_DANGER + '" onclick="partsDeletePart(' + JSON.stringify(p.id) + ')">🗑</button>';
    html += '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function partsFilterInventory() {
  var q = (document.getElementById('parts-search').value||'').toLowerCase();
  var filtered = _partsData.inventory.filter(function(p){
    return (p.part_number||'').toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q) || (p.manufacturer||'').toLowerCase().includes(q);
  });
  var tbl = document.getElementById('parts-inv-table');
  if (tbl) tbl.innerHTML = partsInventoryTable(filtered);
}
window.partsFilterInventory = partsFilterInventory;

function partsEditPart(id) {
  var p = id ? (_partsData.inventory.find(function(x){ return x.id===id; })||{}) : {};
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">';
  html += '<div style="background:#fff;border-radius:12px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto">';
  html += '<h3 style="margin:0 0 16px;font-size:1rem;color:#1e293b">' + (id ? 'Edit Part' : 'Add New Part') + '</h3>';
  var fields = [
    {key:'part_number',label:'Part Number *',placeholder:'e.g. AB-1234'},
    {key:'description',label:'Description',placeholder:'Part description'},
    {key:'manufacturer',label:'Manufacturer',placeholder:'e.g. Caterpillar'},
    {key:'supplier',label:'Supplier',placeholder:'e.g. NAPA, Grainger'},
    {key:'location',label:'Storage Location',placeholder:'e.g. Shelf A3, Bin 7'},
  ];
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
  fields.forEach(function(f){
    html += '<div style="grid-column:' + (f.key==='description'?'1/-1':'auto') + '">';
    html += '<label style="' + LABEL + '">' + f.label + '</label>';
    html += '<input id="pe-' + f.key + '" value="' + (p[f.key]||'') + '" placeholder="' + f.placeholder + '" style="' + INPUT + '" />';
    html += '</div>';
  });
  ['qty_on_hand','qty_minimum','unit_cost'].forEach(function(k){
    var labels = {qty_on_hand:'Qty On Hand',qty_minimum:'Min Stock',unit_cost:'Unit Cost ($)'};
    html += '<div><label style="' + LABEL + '">' + labels[k] + '</label>';
    html += '<input id="pe-' + k + '" type="number" step="0.01" value="' + (p[k]||0) + '" style="' + INPUT + '" /></div>';
  });
  html += '<div style="grid-column:1/-1"><label style="' + LABEL + '">Notes</label>';
  html += '<textarea id="pe-notes" rows="2" style="' + INPUT + ';resize:vertical">' + (p.notes||'') + '</textarea></div>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">';
  html += '<button style="' + BTN_SECONDARY + '" onclick="document.getElementById(\'parts-modal\').remove()">Cancel</button>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsSavePart(' + JSON.stringify(id||'') + ')">Save Part</button>';
  html += '</div></div></div>';
  var modal = document.createElement('div');
  modal.id = 'parts-modal';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}
window.partsEditPart = partsEditPart;

function partsSavePart(id) {
  var vals = ['part_number','description','manufacturer','supplier','location','notes'].reduce(function(acc,k){
    acc[k] = (document.getElementById('pe-' + k)||{}).value || '';
    return acc;
  }, {});
  ['qty_on_hand','qty_minimum','unit_cost'].forEach(function(k){
    vals[k] = parseFloat((document.getElementById('pe-' + k)||{}).value||0);
  });
  if (!vals.part_number) { alert('Part number is required'); return; }
  if (id) vals.id = id;
  apiCall('POST','/api/parts?action=save_part',vals).then(function(){
    var m = document.getElementById('parts-modal');
    if (m) m.remove();
    partsShowTab('inventory');
  });
}
window.partsSavePart = partsSavePart;

function partsDeletePart(id) {
  if (!confirm('Delete this part?')) return;
  apiCall('POST','/api/parts?action=delete_part',{id:id}).then(function(){ partsShowTab('inventory'); });
}
window.partsDeletePart = partsDeletePart;

// ===== WEB SEARCH FOR PRICING =====
function partsSmartSearch(partNumber, description) {
  _partsSmartSearchFull(partNumber || '', description || '');
}

function partsSendQuoteRequest(partNum, desc) {
  var emailsRaw = (document.getElementById('quote-suppliers')||{}).value || '';
  var emails = emailsRaw.split(',').map(function(e){ return e.trim(); }).filter(Boolean);
  if (!emails.length) { alert('Enter at least one supplier email'); return; }
  var subject = encodeURIComponent('Price Quote Request - Part #' + partNum);
  var body = encodeURIComponent('Hello,\n\nWe are requesting a price quote for the following part:\n\nPart Number: ' + partNum + '\nDescription: ' + desc + '\nQuantity Needed: (please specify)\n\nPlease provide your best pricing, lead time, and availability.\n\nThank you,\nPride of the Pond - Maintenance Department');
  // Open mailto for each (open first, note others)
  emails.forEach(function(email, i){
    setTimeout(function(){
      window.open('mailto:' + email + '?subject=' + subject + '&body=' + body, '_blank');
    }, i * 500);
  });
}
window.partsSendQuoteRequest = partsSendQuoteRequest;

// ===== INVOICES =====
function partsRenderInvoices() {
  var panel = document.getElementById('parts-panel');
  var invs = _partsData.invoices;
  var html = '<div style="padding:16px">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  html += '<div style="font-weight:700;font-size:.95rem;color:#1e293b">Parts Invoices</div>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsEditInvoice(null)">+ Add Invoice</button></div>';
  if (!invs.length) {
    html += '<div style="text-align:center;padding:40px;color:#94a3b8">No invoices yet.</div>';
  } else {
    invs.forEach(function(inv){
      var items = Array.isArray(inv.line_items) ? inv.line_items : (typeof inv.line_items === 'string' ? JSON.parse(inv.line_items||'[]') : []);
      html += '<div style="' + CARD + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
      html += '<div><div style="font-weight:700;color:#1a3a6b">Invoice #' + (inv.invoice_number||'N/A') + '</div>';
      html += '<div style="font-size:.75rem;color:#64748b;margin-top:2px">' + (inv.supplier||'') + ' &bull; ' + (inv.invoice_date||'') + '</div></div>';
      html += '<div style="text-align:right"><div style="font-weight:700;font-size:1rem;color:#1e293b">$' + parseFloat(inv.total_amount||0).toFixed(2) + '</div>';
      html += '<button style="' + BTN_INFO + ';margin-top:4px" onclick="partsEditInvoice(' + JSON.stringify(inv.id) + ')">✏️ Edit</button></div></div>';
      if (items.length) {
        html += '<div style="margin-top:10px;border-top:1px solid #f1f5f9;padding-top:10px">';
        html += '<div style="font-size:.72rem;font-weight:600;color:#64748b;margin-bottom:6px">LINE ITEMS</div>';
        items.forEach(function(item){
          html += '<div style="display:flex;justify-content:space-between;font-size:.78rem;padding:3px 0;border-bottom:1px solid #f8fafc">';
          html += '<span style="color:#1e293b"><strong>' + (item.part_number||'') + '</strong> â ' + (item.description||'') + '</span>';
          html += '<span style="color:#64748b">x' + (item.qty||1) + ' @ $' + parseFloat(item.unit_cost||0).toFixed(2) + '</span></div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
  }
  html += '</div>';
  panel.innerHTML = html;
}

function partsEditInvoice(id) {
  var inv = id ? (_partsData.invoices.find(function(x){ return x.id===id; })||{}) : {};
  var items = Array.isArray(inv.line_items) ? inv.line_items : (typeof inv.line_items === 'string' ? JSON.parse(inv.line_items||'[]') : []);
  if (!items.length) items = [{part_number:'',description:'',qty:1,unit_cost:0}];
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">';
  html += '<div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto">';
  html += '<h3 style="margin:0 0 16px;font-size:1rem;color:#1e293b">' + (id?'Edit':'Add') + ' Invoice</h3>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
  html += '<div><label style="' + LABEL + '">Invoice #</label><input id="inv-number" value="' + (inv.invoice_number||'') + '" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Supplier</label><input id="inv-supplier" value="' + (inv.supplier||'') + '" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Date</label><input id="inv-date" type="date" value="' + (inv.invoice_date||new Date().toISOString().slice(0,10)) + '" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Total ($)</label><input id="inv-total" type="number" step="0.01" value="' + (inv.total_amount||0) + '" style="' + INPUT + '" /></div>';
  html += '</div>';
  html += '<div style="font-weight:600;font-size:.8rem;color:#1e293b;margin-bottom:8px">Line Items</div>';
  html += '<div id="inv-items">';
  items.forEach(function(item, i){
    html += partsInvItemRow(item, i);
  });
  html += '</div>';
  html += '<button style="' + BTN_SECONDARY + ';margin-top:8px;width:100%" onclick="partsAddInvItem()">+ Add Line Item</button>';
  html += '<div><label style="' + LABEL + ';margin-top:10px">Notes</label><textarea id="inv-notes" rows="2" style="' + INPUT + ';resize:vertical">' + (inv.notes||'') + '</textarea></div>';
  html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">';
  html += '<button style="' + BTN_SECONDARY + '" onclick="document.getElementById(\'parts-modal\').remove()">Cancel</button>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsSaveInvoice(' + JSON.stringify(id||'') + ')">Save Invoice</button>';
  html += '</div></div></div>';
  var modal = document.createElement('div');
  modal.id = 'parts-modal';
  modal.innerHTML = html;
  document.body.appendChild(modal);
  window._invItemCount = items.length;
}
window.partsEditInvoice = partsEditInvoice;

function partsInvItemRow(item, i) {
  return '<div id="inv-item-' + i + '" style="display:grid;grid-template-columns:1.2fr 2fr .7fr .8fr .5fr;gap:6px;margin-bottom:6px;align-items:center">'
    + '<input placeholder="Part #" value="' + (item.part_number||'') + '" class="inv-item-pn" style="' + INPUT + '" />'
    + '<input placeholder="Description" value="' + (item.description||'') + '" class="inv-item-desc" style="' + INPUT + '" />'
    + '<input placeholder="Qty" type="number" value="' + (item.qty||1) + '" class="inv-item-qty" style="' + INPUT + '" />'
    + '<input placeholder="Cost" type="number" step="0.01" value="' + (item.unit_cost||0) + '" class="inv-item-cost" style="' + INPUT + '" />'
    + '<button style="' + BTN_DANGER + '" onclick="this.closest(\'[id^=inv-item]\').remove()">â</button></div>';
}

function partsAddInvItem() {
  var container = document.getElementById('inv-items');
  if (!container) return;
  var i = (window._invItemCount || 0) + 1;
  window._invItemCount = i;
  var div = document.createElement('div');
  div.innerHTML = partsInvItemRow({}, i);
  container.appendChild(div.firstChild);
}
window.partsAddInvItem = partsAddInvItem;

function partsSaveInvoice(id) {
  var items = [];
  document.querySelectorAll('#inv-items > div').forEach(function(row){
    var pn = (row.querySelector('.inv-item-pn')||{}).value || '';
    if (!pn) return;
    items.push({
      part_number: pn,
      description: (row.querySelector('.inv-item-desc')||{}).value || '',
      qty: parseFloat((row.querySelector('.inv-item-qty')||{}).value||1),
      unit_cost: parseFloat((row.querySelector('.inv-item-cost')||{}).value||0)
    });
  });
  var data = {
    invoice_number: (document.getElementById('inv-number')||{}).value || '',
    supplier: (document.getElementById('inv-supplier')||{}).value || '',
    invoice_date: (document.getElementById('inv-date')||{}).value || '',
    total_amount: parseFloat((document.getElementById('inv-total')||{}).value||0),
    line_items: items,
    notes: (document.getElementById('inv-notes')||{}).value || ''
  };
  if (id) data.id = id;
  apiCall('POST','/api/parts?action=save_invoice',data).then(function(){
    var m = document.getElementById('parts-modal');
    if (m) m.remove();
    partsShowTab('invoices');
  });
}
window.partsSaveInvoice = partsSaveInvoice;

// ===== CROSS-REFERENCE =====
function partsRenderCrossRef() {
  var panel = document.getElementById('parts-panel');
  var refs = _partsData.crossref;
  var html = '<div style="padding:16px">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  html += '<div><div style="font-weight:700;font-size:.95rem;color:#1e293b">Parts Cross-Reference</div>';
  html += '<div style="font-size:.72rem;color:#64748b;margin-top:2px">Map equivalent parts across manufacturers</div></div>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsEditRef(null)">+ Add Cross-Ref</button></div>';
  html += '<input id="crossref-search" placeholder="🔍 Search part number or manufacturer..." style="' + INPUT + ';margin-bottom:12px" oninput="partsCrossRefFilter()" />';
  if (!refs.length) {
    html += '<div style="text-align:center;padding:40px;color:#94a3b8">No cross-references yet.</div>';
  } else {
    html += '<div id="crossref-table">' + partsCrossRefTable(refs) + '</div>';
  }
  html += '</div>';
  panel.innerHTML = html;
}

function partsCrossRefTable(refs) {
  var html = '<table style="width:100%;border-collapse:collapse;font-size:.8rem">';
  html += '<thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">';
  ['Part A','Mfr A','â','Part B','Mfr B','Notes','Actions'].forEach(function(h){
    html += '<th style="padding:8px 10px;text-align:left;font-weight:600;color:#64748b">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  refs.forEach(function(ref){
    html += '<tr style="border-bottom:1px solid #f1f5f9">';
    html += '<td style="padding:8px 10px;font-weight:600;color:#1a3a6b">' + (ref.part_number_a||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b">' + (ref.manufacturer_a||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#94a3b8;text-align:center">â</td>';
    html += '<td style="padding:8px 10px;font-weight:600;color:#065f46">' + (ref.part_number_b||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b">' + (ref.manufacturer_b||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b;font-size:.75rem">' + (ref.notes||'') + '</td>';
    html += '<td style="padding:8px 10px;white-space:nowrap">';
    html += '<button style="' + BTN_INFO + ';margin-right:4px" onclick="partsCrossRefSearch(' + JSON.stringify(ref) + ')">Compare Prices</button>';
    html += '<button style="' + BTN_DANGER + '" onclick="partsDeleteRef(' + JSON.stringify(ref.id) + ')">🗑</button>';
    html += '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

function partsCrossRefFilter() {
  var q = (document.getElementById('crossref-search').value||'').toLowerCase();
  var filtered = _partsData.crossref.filter(function(r){
    return (r.part_number_a||'').toLowerCase().includes(q) || (r.part_number_b||'').toLowerCase().includes(q) ||
           (r.manufacturer_a||'').toLowerCase().includes(q) || (r.manufacturer_b||'').toLowerCase().includes(q);
  });
  var tbl = document.getElementById('crossref-table');
  if (tbl) tbl.innerHTML = partsCrossRefTable(filtered);
}
window.partsCrossRefFilter = partsCrossRefFilter;

function partsCrossRefSearch(ref) {
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">';
  html += '<div style="background:#fff;border-radius:12px;padding:24px;max-width:520px;width:100%">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
  html += '<h3 style="margin:0;font-size:1rem">Compare Equivalent Parts</h3>';
  html += '<button style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:#64748b" onclick="document.getElementById(\'crossref-modal\').remove()">Ã</button></div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
  [
    {num:ref.part_number_a, mfr:ref.manufacturer_a, label:'Option A'},
    {num:ref.part_number_b, mfr:ref.manufacturer_b, label:'Option B'}
  ].forEach(function(opt, i){
    var color = i===0 ? '#1a3a6b' : '#065f46';
    html += '<div style="border:2px solid ' + color + '20;border-radius:8px;padding:12px">';
    html += '<div style="font-size:.7rem;font-weight:700;color:' + color + ';margin-bottom:6px">' + opt.label + '</div>';
    html += '<div style="font-weight:700;color:#1e293b">' + (opt.num||'') + '</div>';
    html += '<div style="font-size:.75rem;color:#64748b;margin-bottom:10px">' + (opt.mfr||'') + '</div>';
    var q = encodeURIComponent((opt.num||'') + ' ' + (opt.mfr||'') + ' price');
    html += '<a href="https://www.google.com/search?tbm=shop&q=' + q + '" target="_blank" style="display:block;text-align:center;padding:6px;background:' + color + ';color:#fff;border-radius:5px;text-decoration:none;font-size:.75rem;font-weight:600">Search Prices â</a>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div style="background:#f8fafc;border-radius:8px;padding:12px;font-size:.78rem;color:#64748b">';
  html += 'ð¡ <strong>Tip:</strong> Compare the search results from both options to determine the most cost-effective choice. Note lead times and shipping costs.';
  html += '</div></div></div>';
  var modal = document.createElement('div');
  modal.id = 'crossref-modal';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}
window.partsCrossRefSearch = partsCrossRefSearch;

function partsEditRef(id) {
  var ref = id ? (_partsData.crossref.find(function(x){ return x.id===id; })||{}) : {};
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">';
  html += '<div style="background:#fff;border-radius:12px;padding:24px;max-width:440px;width:100%">';
  html += '<h3 style="margin:0 0 16px;font-size:1rem;color:#1e293b">Cross-Reference Parts</h3>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  html += '<div style="grid-column:1/-1;text-align:center;font-weight:600;color:#64748b;font-size:.8rem;padding:4px;background:#f8fafc;border-radius:6px">Part A â Part B (equivalent parts)</div>';
  [['a','Part A'],['b','Part B']].forEach(function(side){
    var s = side[0], label = side[1];
    html += '<div><label style="' + LABEL + '">' + label + ' Part #</label><input id="ref-pn-' + s + '" value="' + (ref['part_number_'+s]||'') + '" style="' + INPUT + '" /></div>';
    html += '<div><label style="' + LABEL + '">' + label + ' Manufacturer</label><input id="ref-mfr-' + s + '" value="' + (ref['manufacturer_'+s]||'') + '" style="' + INPUT + '" /></div>';
  });
  html += '<div style="grid-column:1/-1"><label style="' + LABEL + '">Notes (cost comparison, availability, etc.)</label>';
  html += '<textarea id="ref-notes" rows="2" style="' + INPUT + ';resize:vertical">' + (ref.notes||'') + '</textarea></div>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">';
  html += '<button style="' + BTN_SECONDARY + '" onclick="document.getElementById(\'parts-modal\').remove()">Cancel</button>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsSaveRef(' + JSON.stringify(id||'') + ')">Save</button></div></div></div>';
  var modal = document.createElement('div');
  modal.id = 'parts-modal';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}
window.partsEditRef = partsEditRef;

function partsSaveRef(id) {
  var data = {
    part_number_a: (document.getElementById('ref-pn-a')||{}).value||'',
    manufacturer_a: (document.getElementById('ref-mfr-a')||{}).value||'',
    part_number_b: (document.getElementById('ref-pn-b')||{}).value||'',
    manufacturer_b: (document.getElementById('ref-mfr-b')||{}).value||'',
    notes: (document.getElementById('ref-notes')||{}).value||''
  };
  if (!data.part_number_a || !data.part_number_b) { alert('Both part numbers required'); return; }
  if (id) data.id = id;
  apiCall('POST','/api/parts?action=save_cross_ref',data).then(function(){
    var m = document.getElementById('parts-modal');
    if (m) m.remove();
    partsShowTab('crossref');
  });
}
window.partsSaveRef = partsSaveRef;

function partsDeleteRef(id) {
  if (!confirm('Delete this cross-reference?')) return;
  apiCall('POST','/api/parts?action=delete_cross_ref',{id:id}).then(function(){ partsShowTab('crossref'); });
}
window.partsDeleteRef = partsDeleteRef;

// ===== ORDERS =====
function partsRenderOrders() {
  var panel = document.getElementById('parts-panel');
  var orders = _partsData.orders;
  var statusColor = {pending:'#f59e0b',ordered:'#3b82f6',shipped:'#8b5cf6',received:'#16a34a',cancelled:'#ef4444'};
  var html = '<div style="padding:16px">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">';
  html += '<div style="font-weight:700;font-size:.95rem;color:#1e293b">Parts Orders</div>';
  html += '<button onclick="partsGmailScanTracking()" style="padding:7px 14px;background:#1a56db;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.8rem;font-weight:600;margin-right:6px">📧 Scan Emails</button><button onclick="partsAutoTrackingImport()" style="padding:7px 14px;background:#15803d;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.8rem;font-weight:600;margin-right:6px">📦 Import Tracking</button><button onclick="partsSmartSearch()" style="padding:7px 14px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.8rem;font-weight:600;margin-right:6px">🔎 Find Parts</button><button style="' + BTN_PRIMARY + '" onclick="partsNewOrder()">+ New Order</button></div>';
  if (!orders.length) {
    html += '<div style="text-align:center;padding:40px;color:#94a3b8">No orders yet.</div>';
  } else {
    orders.forEach(function(ord){
      var sc = statusColor[ord.status] || '#64748b';
      html += '<div style="' + CARD + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
      html += '<div>';
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<span style="font-weight:700;color:#1a3a6b">' + (ord.part_number||'N/A') + '</span>';
      html += '<span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:' + sc + '20;color:' + sc + ';font-weight:700">' + (ord.status||'pending').toUpperCase() + '</span>';
      html += '</div>';
      html += '<div style="font-size:.78rem;color:#64748b;margin-top:2px">' + (ord.description||'') + '</div>';
      html += '<div style="font-size:.72rem;color:#94a3b8;margin-top:2px">' + (ord.supplier||'') + ' &bull; Qty: ' + (ord.qty_ordered||1) + ' &bull; $' + parseFloat(ord.unit_cost||0).toFixed(2) + '/ea &bull; Total: $' + parseFloat(ord.total_cost||0).toFixed(2) + '</div>';
      if (ord.tracking_number) html += '<div style="font-size:.72rem;color:#3b82f6;margin-top:2px">📦 Tracking: ' + ord.tracking_number + '</div>';
      html += '</div>';
      html += '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">';
      if (ord.status !== 'received') {
        html += '<button style="' + BTN_INFO + '" onclick="partsAddTracking(' + JSON.stringify(ord.id) + ')">Add Tracking</button>';
        html += '<button style="' + BTN_SUCCESS + '" onclick="partsReceiveOrder(' + JSON.stringify(ord.id) + ',' + JSON.stringify(ord.qty_ordered) + ')">â Receive</button>';
      }
      html += '</div></div></div>';
    });
  }
  html += '</div>';
  panel.innerHTML = html;
}

function partsNewOrder(partNum, desc) {
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">';
  html += '<div style="background:#fff;border-radius:12px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto">';
  html += '<h3 style="margin:0 0 16px;font-size:1rem;color:#1e293b">Create Parts Order</h3>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  html += '<div><label style="' + LABEL + '">Part Number *</label><input id="ord-pn" value="' + (partNum||'') + '" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Supplier</label><input id="ord-supplier" style="' + INPUT + '" /></div>';
  html += '<div style="grid-column:1/-1"><label style="' + LABEL + '">Description</label><input id="ord-desc" value="' + (desc||'') + '" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Qty</label><input id="ord-qty" type="number" value="1" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Unit Cost ($)</label><input id="ord-cost" type="number" step="0.01" value="0" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Order Date</label><input id="ord-date" type="date" value="' + new Date().toISOString().slice(0,10) + '" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Linked To-Do ID (optional)</label><input id="ord-todo" placeholder="To-Do item ID" style="' + INPUT + '" /></div>';
  html += '<div style="grid-column:1/-1"><label style="' + LABEL + '">Notes</label><textarea id="ord-notes" rows="2" style="' + INPUT + ';resize:vertical"></textarea></div>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">';
  html += '<button style="' + BTN_SECONDARY + '" onclick="document.getElementById(\'parts-modal\').remove()">Cancel</button>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsSaveOrder()">Place Order</button></div></div></div>';
  var modal = document.createElement('div');
  modal.id = 'parts-modal';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}
window.partsNewOrder = partsNewOrder;

function partsSaveOrder() {
  var qty = parseFloat((document.getElementById('ord-qty')||{}).value||1);
  var cost = parseFloat((document.getElementById('ord-cost')||{}).value||0);
  var data = {
    part_number: (document.getElementById('ord-pn')||{}).value||'',
    description: (document.getElementById('ord-desc')||{}).value||'',
    supplier: (document.getElementById('ord-supplier')||{}).value||'',
    qty_ordered: qty, unit_cost: cost, total_cost: qty*cost,
    order_date: (document.getElementById('ord-date')||{}).value||'',
    todo_item_id: (document.getElementById('ord-todo')||{}).value||'',
    notes: (document.getElementById('ord-notes')||{}).value||'',
    status: 'ordered'
  };
  if (!data.part_number) { alert('Part number required'); return; }
  apiCall('POST','/api/parts?action=save_parts_order',data).then(function(){
    var m = document.getElementById('parts-modal');
    if (m) m.remove();
    partsShowTab('orders');
  });
}
window.partsSaveOrder = partsSaveOrder;

function partsAddTracking(id) {
  var num = prompt('Enter tracking number:');
  if (!num) return;
  apiCall('POST','/api/parts?action=update_tracking',{id:id,tracking_number:num,status:'shipped'}).then(function(){
    partsShowTab('orders');
  });
}
window.partsAddTracking = partsAddTracking;

function partsReceiveOrder(id, qty) {
  var q = parseFloat(prompt('Qty received:', qty)||qty);
  if (!q) return;
  apiCall('POST','/api/parts?action=receive_part',{id:id,qty_received:q}).then(function(){
    partsShowTab('orders');
    // Refresh inventory too
    apiCall('GET','/api/parts?action=get_parts').then(function(data){
      _partsData.inventory = Array.isArray(data) ? data : [];
    });
  });
}
window.partsReceiveOrder = partsReceiveOrder;

// ===== MANUALS =====
function partsRenderManuals() {
  var panel = document.getElementById('parts-panel');
  var manuals = _partsData.manuals;
  var html = '<div style="padding:16px">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  html += '<div><div style="font-weight:700;font-size:.95rem;color:#1e293b">Parts Manuals</div>';
  html += '<div style="font-size:.72rem;color:#64748b;margin-top:2px">Upload manuals for part number lookup</div></div>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsAddManual()">+ Upload Manual</button></div>';
  // Search in manuals
  html += '<div style="display:flex;gap:8px;margin-bottom:12px">';
  html += '<input id="manual-search" placeholder="🔍 Search part numbers in manuals..." style="' + INPUT + ';flex:1" />';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsSearchManuals()">Search</button></div>';
  html += '<div id="manual-results"></div>';
  if (!manuals.length) {
    html += '<div style="text-align:center;padding:40px;color:#94a3b8">No manuals uploaded yet.</div>';
  } else {
    manuals.forEach(function(m){
      html += '<div style="' + CARD + ';display:flex;justify-content:space-between;align-items:center">';
      html += '<div>';
      html += '<div style="font-weight:600;color:#1e293b">📖 ' + (m.title||'Untitled') + '</div>';
  html += '<div style="font-size:.78rem;color:#64748b;margin-top:2px">' + [m.manufacturer, m.model ? 'Model: '+m.model : ''].filter(Boolean).join(' · ') + '</div>';
  if (m.file_url) {
    var isData = m.file_url.startsWith('data:');
    var isPdf  = (m.file_name||m.file_url).toLowerCase().includes('.pdf') || m.file_url.startsWith('data:application/pdf');
    if (isData) {
      html += '<div style="margin-top:6px;display:flex;gap:6px">';
      html += '<button onclick="partsViewManual(\''+m.id+'\')" style="padding:4px 10px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer">👁 View</button>';
      html += '<button onclick="partsDownloadManual(\''+m.id+'\')" style="padding:4px 10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:6px;font-size:.75rem;font-weight:600;cursor:pointer">⬇ Download</button>';
      html += '</div>';
    } else {
      html += '<div style="margin-top:6px"><a href="'+m.file_url+'" target="_blank" style="padding:4px 10px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;font-size:.75rem;font-weight:600;text-decoration:none;display:inline-block">👁 Open PDF</a></div>';
    }
  }
      html += '<div style="font-size:.73rem;color:#64748b;margin-top:2px">' + (m.manufacturer||'') + (m.model?' â Model: '+m.model:'') + '</div>';
      html += '</div>';
      if (m.file_url) {
        html += '<a href="' + m.file_url + '" target="_blank" style="' + BTN_INFO + ';text-decoration:none;font-size:.75rem">View PDF</a>';
      }
      html += '</div>';
    });
  }
  html += '</div>';
  panel.innerHTML = html;
}

function partsSearchManuals() {
  var q = (document.getElementById('manual-search')||{}).value || '';
  if (!q) return;
  var results = document.getElementById('manual-results');
  if (results) results.innerHTML = '<div style="color:#94a3b8;font-size:.8rem;padding:8px">Searching...</div>';
  apiCall('POST','/api/parts?action=search_manual',{query:q}).then(function(data){
    var hits = Array.isArray(data) ? data : [];
    if (!results) return;
    if (!hits.length) {
      results.innerHTML = '<div style="color:#64748b;font-size:.8rem;padding:8px">No results found for "' + q + '"</div>';
      return;
    }
    results.innerHTML = '<div style="font-weight:600;font-size:.8rem;color:#1e293b;margin-bottom:8px">' + hits.length + ' result(s) found:</div>' +
      hits.map(function(h){
        return '<div style="' + CARD + ';font-size:.8rem">'
          + '<div style="font-weight:600;color:#1a3a6b">📖 ' + (h.title||'') + '</div>'
          + (h.excerpt ? '<div style="color:#64748b;margin-top:4px;font-family:monospace;font-size:.75rem;background:#f8fafc;padding:6px;border-radius:4px">' + h.excerpt + '</div>' : '')
          + '</div>';
      }).join('');
  });
}
window.partsSearchManuals = partsSearchManuals;

function partsAddManual() {
  var existing = document.getElementById('parts-modal');
  if (existing) existing.remove();
  window._manFileData = null;

  var overlay = document.createElement('div');
  overlay.id = 'parts-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';

  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;padding:24px;max-width:480px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.22);max-height:90vh;overflow-y:auto;box-sizing:border-box';

  // Header
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:18px';
  hdr.innerHTML = '<h3 style="margin:0;font-size:1rem;font-weight:700;color:#1e293b">📖 Upload Parts Manual</h3>';
  var xBtn = document.createElement('button');
  xBtn.textContent = '✕'; xBtn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;line-height:1';
  xBtn.onclick = function(){overlay.remove();};
  hdr.appendChild(xBtn);
  box.appendChild(hdr);

  var lbl = function(text){ var l=document.createElement('label'); l.textContent=text; l.style.cssText='font-size:.78rem;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px'; return l; };
  var inp = function(id,ph){ var i=document.createElement('input'); i.id=id; i.placeholder=ph||''; i.style.cssText='width:100%;padding:9px 12px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:.9rem;box-sizing:border-box;outline:none'; return i; };
  var row = function(){ var d=document.createElement('div'); d.style.marginBottom='12px'; return d; };

  // Title
  var rTitle=row(); rTitle.appendChild(lbl('Manual Title *')); rTitle.appendChild(inp('man-title','e.g. Baldor Motor VM3546 Manual')); box.appendChild(rTitle);

  // Mfr + Model
  var rMM=row(); rMM.style.display='grid'; rMM.style.gridTemplateColumns='1fr 1fr'; rMM.style.gap='10px';
  var dMfr=document.createElement('div'); dMfr.appendChild(lbl('Manufacturer')); dMfr.appendChild(inp('man-mfr','e.g. Baldor')); rMM.appendChild(dMfr);
  var dMod=document.createElement('div'); dMod.appendChild(lbl('Model / Equipment')); dMod.appendChild(inp('man-model','e.g. VM3546')); rMM.appendChild(dMod);
  box.appendChild(rMM);

  // File upload — built with createElement so FileReader works
  var rFile=row(); rFile.appendChild(lbl('File Upload (PDF, JPG, PNG)'));
  var zone=document.createElement('div'); zone.id='man-drop-zone';
  zone.style.cssText='border:2px dashed #cbd5e1;border-radius:10px;padding:22px 16px;text-align:center;cursor:pointer;background:#f8fafc;transition:all .2s;margin-bottom:6px';
  var zLabel=document.createElement('div'); zLabel.id='man-drop-label';
  zLabel.innerHTML='<div style="font-size:32px;margin-bottom:6px">📁</div><div style="font-size:.88rem;font-weight:600;color:#475569">Click to browse or drag & drop</div><div style="font-size:.76rem;color:#94a3b8;margin-top:4px">PDF · JPG · PNG — up to 10 MB</div>';
  zone.appendChild(zLabel);
  // Real file input created via createElement — critical for FileReader access
  var fi=document.createElement('input'); fi.type='file'; fi.id='man-file-input'; fi.accept='.pdf,.jpg,.jpeg,.png,.gif,.webp'; fi.style.display='none';
  fi.addEventListener('change',function(){if(this.files&&this.files[0])partsHandleManualFile(this.files[0]);});
  zone.appendChild(fi);
  zone.addEventListener('click',function(e){if(e.target!==fi)fi.click();});
  zone.addEventListener('dragover',function(e){e.preventDefault();zone.style.borderColor='#3b82f6';zone.style.background='#eff6ff';});
  zone.addEventListener('dragleave',function(){zone.style.borderColor='#cbd5e1';zone.style.background='#f8fafc';});
  zone.addEventListener('drop',function(e){e.preventDefault();zone.style.borderColor='#cbd5e1';zone.style.background='#f8fafc';var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)partsHandleManualFile(f);});
  rFile.appendChild(zone);
  var prog=document.createElement('div'); prog.id='man-progress'; prog.style.cssText='display:none;padding:10px 14px;border-radius:8px;font-size:.85rem;text-align:center;margin-top:4px';
  rFile.appendChild(prog);
  box.appendChild(rFile);

  // URL
  var rUrl=row(); rUrl.appendChild(lbl('Or paste a URL (optional)')); rUrl.appendChild(inp('man-url','https://... link to an already-hosted PDF')); box.appendChild(rUrl);

  // Notes
  var rNotes=row(); rNotes.appendChild(lbl('Searchable notes (part numbers, keywords)'));
  var ta=document.createElement('textarea'); ta.id='man-text'; ta.rows=3; ta.placeholder='Optional — paste part numbers or notes for search...';
  ta.style.cssText='width:100%;padding:9px 12px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:.9rem;box-sizing:border-box;outline:none;resize:vertical';
  rNotes.appendChild(ta); box.appendChild(rNotes);

  // Buttons
  var rBtns=document.createElement('div'); rBtns.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:4px';
  var cancelBtn=document.createElement('button'); cancelBtn.textContent='Cancel'; cancelBtn.style.cssText='padding:9px 18px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer'; cancelBtn.onclick=function(){overlay.remove();};
  var saveBtn=document.createElement('button'); saveBtn.textContent='💾 Save Manual'; saveBtn.style.cssText='padding:9px 18px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer'; saveBtn.onclick=function(){partsSaveManual();};
  rBtns.appendChild(cancelBtn); rBtns.appendChild(saveBtn);
  box.appendChild(rBtns);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
window.partsAddManual = partsAddManual;

function partsHandleManualFile(file) {
  if (!file) { return; }
  if (file.size === 0) { alert('That file appears to be empty. Please select a valid PDF or image file.'); return; }
  if (file.size > 10 * 1024 * 1024) { alert('File is larger than 10 MB. Please use a smaller file or paste a URL instead.'); return; }
  var prog = document.getElementById('man-progress');
  if (prog) { prog.style.display='block'; prog.style.background='#eff6ff'; prog.style.color='#1d4ed8'; prog.textContent='⏳ Reading file…'; }
  var reader = new FileReader();
  reader.onload = function(e) {
    window._manFileData = { name: file.name, type: file.type, size: file.size, dataUrl: e.target.result };
    var sizeMB = (file.size/1024/1024).toFixed(2);
    var zl = document.getElementById('man-drop-label');
    if (zl) zl.innerHTML = '<div style="font-size:28px;margin-bottom:4px">✅</div><div style="font-weight:600;color:#166534;font-size:.88rem">'+file.name+'</div><div style="font-size:.76rem;color:#059669;margin-top:2px">'+sizeMB+' MB — click to change file</div>';
    if (prog) prog.style.display='none';
    var t = document.getElementById('man-title');
    if (t && !t.value) t.value = file.name.replace(/.[^.]+$/,'').replace(/[-_]/g,' ');
  };
  reader.onerror = function() {
    if (prog) { prog.style.display='block'; prog.style.background='#fef2f2'; prog.style.color='#dc2626'; prog.textContent='❌ Could not read file. Try a different file or paste a URL instead.'; }
  };
  reader.readAsDataURL(file);
}
window.partsHandleManualFile = partsHandleManualFile;

function partsHandleManualDrop(event) {
  event.preventDefault();
  var zone = document.getElementById('man-drop-zone');
  if (zone) { zone.style.borderColor = '#cbd5e1'; zone.style.background = '#f8fafc'; }
  var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) partsHandleManualFile(file);
}
window.partsHandleManualDrop = partsHandleManualDrop;

function partsSaveManual() {
  var fileUrl = (window._manFileData && window._manFileData.dataUrl) || (document.getElementById('man-url') && document.getElementById('man-url').value) || '';
  var fileName = window._manFileData ? window._manFileData.name : '';
  var data = {
    title:          (document.getElementById('man-title') || {}).value || '',
    manufacturer:   (document.getElementById('man-mfr')   || {}).value || '',
    model:          (document.getElementById('man-model')  || {}).value || '',
    file_url:       fileUrl,
    file_name:      fileName,
    extracted_text: (document.getElementById('man-text')   || {}).value || ''
  };
  if (!data.title) { alert('Please enter a title for the manual.'); return; }
  if (!data.file_url) { alert('Please upload a file or paste a URL.'); return; }
  var btn = event && event.target;
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  apiCall('POST', '/api/parts?action=save_manual', data).then(function() {
    window._manFileData = null;
    var m = document.getElementById('parts-modal');
    if (m) m.remove();
    partsShowTab('manuals');
  }).catch(function(e) {
    alert('Save failed: ' + e.message);
    if (btn) { btn.textContent = '💾 Save Manual'; btn.disabled = false; }
  });
}
window.partsSaveManual = partsSaveManual;

// ===== LOW STOCK NOTIFICATIONS =====
function partsCheckLowStock(callback) {
  apiCall('GET','/api/parts?action=get_low_stock').then(function(data){
    if (callback) callback(Array.isArray(data) ? data : []);
  }).catch(function(){ if (callback) callback([]); });
}
window.partsCheckLowStock = partsCheckLowStock;

window.buildPartsWidget = buildPartsWidget;


// Patch partsRenderInvoices to inject Scan Invoice button
var _origPartsRenderInvoices = partsRenderInvoices;
partsRenderInvoices = function() {
  _origPartsRenderInvoices.apply(this, arguments);
  setTimeout(function() {
    var addBtn = document.querySelector('#widget-content button[onclick*="partsEditInvoice"]');
    if (addBtn && !document.querySelector('#parts-scan-btn')) {
      var scanBtn = document.createElement('button');
      scanBtn.id = 'parts-scan-btn';
      scanBtn.innerHTML = '&#128247; Scan Invoice';
      scanBtn.onclick = partsScanInvoice;
      scanBtn.style.cssText = 'background:#0f7d3e;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:.85rem;cursor:pointer;font-weight:600;margin-left:8px';
      addBtn.parentNode.insertBefore(scanBtn, addBtn.nextSibling);
    }
  }, 50);
};


// ═══════════════════════════════════════════════════════
// SMART PARTS SEARCH + GMAIL AUTO-TRACKING
// ═══════════════════════════════════════════════════════

async function _partsSmartSearchFull(partNumber, description) {
  const existing = document.getElementById('parts-search-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'parts-search-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
  modal.innerHTML = `
    <div style="background:var(--color-background-primary,#fff);border-radius:16px;width:100%;max-width:740px;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.22)">
      <div style="padding:18px 24px 0;display:flex;align-items:flex-start;justify-content:space-between">
        <div>
          <div style="font-size:17px;font-weight:700;color:var(--color-text-primary)">🔍 Smart Parts Search</div>
          <div style="font-size:13px;color:var(--color-text-secondary);margin-top:2px">AI-powered pricing across OEM · Industrial · Budget tiers</div>
        </div>
        <button onclick="document.getElementById('parts-search-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--color-text-secondary);padding:0 4px;line-height:1;margin-top:-2px">✕</button>
      </div>
      <div style="padding:14px 24px 0;display:flex;gap:8px">
        <input id="pss-part" placeholder="Part number (e.g. SKF-6205-2Z)" value="${partNumber||''}" style="flex:1.2;padding:9px 12px;border:1.5px solid var(--color-border-primary);border-radius:8px;font-size:14px;background:var(--color-background-secondary);color:var(--color-text-primary);outline:none" onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor=''">
        <input id="pss-desc" placeholder="Description (optional)" value="${description||''}" style="flex:2;padding:9px 12px;border:1.5px solid var(--color-border-primary);border-radius:8px;font-size:14px;background:var(--color-background-secondary);color:var(--color-text-primary);outline:none" onfocus="this.style.borderColor='#7c3aed'" onblur="this.style.borderColor=''">
        <button onclick="_partsRunSmartSearch()" id="pss-btn" style="padding:9px 20px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background 0.2s" onmouseover="this.style.background='#6d28d9'" onmouseout="this.style.background='#7c3aed'">Search</button>
      </div>
      <div id="pss-results" style="flex:1;overflow-y:auto;padding:16px 24px 24px;min-height:180px">
        <div style="text-align:center;padding:40px 20px;color:var(--color-text-secondary);font-size:14px">
          Enter a part number and click <strong>Search</strong> to compare prices across suppliers
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (partNumber) setTimeout(_partsRunSmartSearch, 80);
}

async function _partsRunSmartSearch() {
  const partNumber = (document.getElementById('pss-part')?.value || '').trim();
  const description = (document.getElementById('pss-desc')?.value || '').trim();
  if (!partNumber && !description) { alert('Enter a part number or description to search'); return; }

  const btn = document.getElementById('pss-btn');
  if (btn) { btn.textContent = 'Searching…'; btn.disabled = true; }

  const resultsDiv = document.getElementById('pss-results');
  resultsDiv.innerHTML = '<div style="text-align:center;padding:50px 20px"><div style="font-size:32px;margin-bottom:10px;animation:spin 1s linear infinite;display:inline-block">🔍</div><div style="color:var(--color-text-secondary);font-size:14px;margin-top:8px">Asking Claude to find pricing and alternatives…</div></div>';

  const token = (JSON.parse(localStorage.getItem('potp_v2_session')||'{}').token) || '';
  let results = null;

  try {
    const prompt = `You are an industrial parts sourcing expert for a catfish processing plant. Find pricing and suppliers for:
Part Number: ${partNumber || 'unknown'}
Description: ${description || 'not specified'}

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "part_name": "full name",
  "manufacturer": "OEM brand",
  "category": "bearings|motors|belts|pumps|electrical|mechanical|conveyor|other",
  "specs": "key specs - dimensions, ratings, rpm, etc.",
  "notes": "compatibility or install notes if any",
  "suppliers": [
    {
      "tier": "OEM",
      "part_number": "${partNumber || 'original part #'}",
      "manufacturer": "original brand",
      "description": "exact OEM description",
      "est_price": 45.00,
      "quality": 5,
      "quality_note": "Original manufacturer, full warranty",
      "availability": "In stock",
      "lead_time": "1-2 days",
      "where_to_buy": [
        {"name": "Grainger", "url": "https://www.grainger.com/search?searchQuery=${encodeURIComponent(partNumber||description)}"},
        {"name": "McMaster-Carr", "url": "https://www.mcmaster.com/#${encodeURIComponent(partNumber||description)}"},
        {"name": "Motion Industries", "url": "https://www.motionindustries.com/search?term=${encodeURIComponent(partNumber||description)}"}
      ]
    },
    {
      "tier": "Industrial",
      "part_number": "equivalent part #",
      "manufacturer": "industrial equivalent brand",
      "description": "industrial grade equivalent description",
      "est_price": 28.00,
      "quality": 4,
      "quality_note": "Meets OEM spec, industrial grade",
      "availability": "In stock",
      "lead_time": "1-3 days",
      "where_to_buy": [
        {"name": "Amazon", "url": "https://www.amazon.com/s?k=${encodeURIComponent(partNumber+' '+description)}"},
        {"name": "Zoro", "url": "https://www.zoro.com/search?q=${encodeURIComponent(partNumber||description)}"},
        {"name": "Applied Industrial", "url": "https://www.applied.com/search/${encodeURIComponent(partNumber||description)}"}
      ]
    },
    {
      "tier": "Budget",
      "part_number": "budget equivalent",
      "manufacturer": "budget brand",
      "description": "budget alternative - verify specs before ordering",
      "est_price": 14.00,
      "quality": 3,
      "quality_note": "Budget grade, shorter service life expected",
      "availability": "Ships 3-5 days",
      "lead_time": "3-7 days",
      "where_to_buy": [
        {"name": "eBay", "url": "https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(partNumber+' equivalent')}"},
        {"name": "Amazon", "url": "https://www.amazon.com/s?k=${encodeURIComponent(partNumber+' equivalent replacement')}"}
      ]
    }
  ]
}`;

    const _aiTok = (JSON.parse(localStorage.getItem('potp_v2_session')||'{}').token)||'';
    const resp = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+_aiTok },
      body: JSON.stringify({ query: prompt })
    });
    const data = await resp.json();
    const text = data.response || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) results = JSON.parse(match[0]);
  } catch(e) { console.error('Smart search error:', e); }

  if (btn) { btn.textContent = 'Search'; btn.disabled = false; }

  if (results && results.suppliers) {
    _partsDisplayResults(results, partNumber, description);
  } else {
    // Fallback supplier links
    const q = encodeURIComponent((partNumber + ' ' + description).trim());
    const suppliers = [
      ['Grainger','https://www.grainger.com/search?searchQuery='+q,'Industrial specialist'],
      ['McMaster-Carr','https://www.mcmaster.com/#'+encodeURIComponent(partNumber||description),'Same-day shipping'],
      ['Motion Industries','https://www.motionindustries.com/search?term='+q,'Industrial focus'],
      ['Amazon','https://www.amazon.com/s?k='+q,'Fast delivery'],
      ['Zoro','https://www.zoro.com/search?q='+q,'Good pricing'],
      ['eBay','https://www.ebay.com/sch/i.html?_nkw='+q,'OEM surplus']
    ];
    resultsDiv.innerHTML = '<div style="padding:10px 14px;background:#fef9c3;border-radius:8px;margin-bottom:14px;font-size:13px;color:#854d0e">⚠️ AI lookup unavailable — showing supplier links</div>' +
      suppliers.map(([n,u,note]) => `<a href="${u}" target="_blank" style="display:flex;align-items:center;gap:10px;padding:11px 14px;border:1px solid var(--color-border-primary);border-radius:8px;margin-bottom:8px;text-decoration:none;color:var(--color-text-primary);font-size:14px;background:var(--color-background-secondary)"><span style="font-weight:600">${n}</span><span style="color:var(--color-text-secondary);font-size:12px">${note}</span><span style="margin-left:auto;color:#7c3aed;font-size:13px">→</span></a>`).join('');
  }
}

function _partsDisplayResults(data, origPN, origDesc) {
  const div = document.getElementById('pss-results');
  const tierColor = { OEM:'#1a56db', Industrial:'#059669', Budget:'#d97706' };
  const tierBg = { OEM:'#eff6ff', Industrial:'#f0fdf4', Budget:'#fffbeb' };
  const tierBorder = { OEM:'#bfdbfe', Industrial:'#bbf7d0', Budget:'#fde68a' };

  div.innerHTML = `
    <div style="padding:12px 16px;background:var(--color-background-secondary);border-radius:10px;margin-bottom:16px;border-left:3px solid #7c3aed">
      <div style="font-weight:700;font-size:15px;color:var(--color-text-primary)">${data.part_name || origPN}</div>
      ${data.specs ? `<div style="font-size:12px;color:var(--color-text-secondary);margin-top:3px">📐 ${data.specs}</div>` : ''}
      ${data.notes ? `<div style="font-size:12px;color:#d97706;margin-top:4px">⚠️ ${data.notes}</div>` : ''}
    </div>
    ${(data.suppliers||[]).map(s => _partsResultCard(s, tierColor, tierBg, tierBorder)).join('')}
  `;
}

function _partsResultCard(s, tierColor, tierBg, tierBorder) {
  const color = tierColor[s.tier] || '#6b7280';
  const bg = tierBg[s.tier] || '#f9fafb';
  const border = tierBorder[s.tier] || '#e5e7eb';
  const stars = '★'.repeat(s.quality||3) + '☆'.repeat(5-(s.quality||3));
  return `<div style="border:1.5px solid ${border};border-radius:12px;margin-bottom:14px;overflow:hidden">
    <div style="padding:11px 16px;background:${bg};display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px">${s.tier}</span>
      <span style="font-weight:700;font-size:14px;color:var(--color-text-primary)">${s.part_number}</span>
      <span style="font-size:13px;color:var(--color-text-secondary)">${s.manufacturer}</span>
      <span style="margin-left:auto;font-size:20px;font-weight:800;color:${color}">$${(+s.est_price||0).toFixed(2)}</span>
    </div>
    <div style="padding:12px 16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
        <span style="color:#f59e0b;font-size:15px;letter-spacing:1px">${stars}</span>
        <span style="font-size:12px;color:var(--color-text-secondary)">${s.quality_note||''}</span>
        <span style="margin-left:auto;font-size:12px;font-weight:500;color:${(s.availability||'').includes('stock')?'#059669':'#d97706'}">${s.availability||'Check availability'}</span>
      </div>
      <div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:11px">${s.description||''}</div>
      <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:10px">⏱ Lead time: ${s.lead_time||'varies'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px">
        ${(s.where_to_buy||[]).map(sup => `<a href="${sup.url}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border:1px solid var(--color-border-primary);border-radius:20px;text-decoration:none;font-size:12px;font-weight:500;color:${color};background:var(--color-background-primary)">${sup.name} ↗</a>`).join('')}
      </div>
      <button data-supplier-json="${encodeURIComponent(JSON.stringify(s))}" onclick="_partsOrderFromSearch(decodeURIComponent(this.dataset.supplierJson))" style="width:100%;padding:10px;background:${color};color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity 0.15s" onmouseover="this.style.opacity='0.88'" onmouseout="this.style.opacity='1'">
        📋 Create Order — ${(+s.est_price||0).toFixed(2)} from ${s.manufacturer}
      </button>
    </div>
  </div>`;
}

async function _partsOrderFromSearch(supplierJson) {
  let s;
  try { s = JSON.parse(supplierJson); } catch(e) { alert('Error parsing supplier data'); return; }
  const token = (JSON.parse(localStorage.getItem('potp_v2_session')||'{}').token) || '';
  const h = { 'Authorization':'Bearer '+token, 'Content-Type':'application/json' };
  const vendor = (s.where_to_buy||[])[0]?.name || s.manufacturer || '';
  const vendorUrl = (s.where_to_buy||[])[0]?.url || '';
  const resp = await fetch('/api/parts?action=save_parts_order',{
    method:'POST', headers:h,
    body: JSON.stringify({ vendor, part_number:s.part_number, description:s.description, quantity:1, unit_cost:+(s.est_price||0), status:'pending', notes:(s.tier+' · '+s.quality_note).slice(0,200) })
  }).then(r=>r.json());
  if (resp.ok) {
    document.getElementById('parts-search-modal')?.remove();
    _partsToast('✅ Order created! Opening '+vendor+'…', '#059669');
    if (vendorUrl) window.open(vendorUrl,'_blank');
    partsShowTab('orders');
    setTimeout(async () => {
      const orders = await fetch('/api/parts?action=get_parts_orders',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json()).catch(()=>[]);
      partsRenderOrders(orders);
    }, 600);
  } else { alert('Failed to create order'); }
}

function _partsToast(msg, bg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:28px;right:28px;background:'+(bg||'#1a56db')+';color:#fff;padding:13px 20px;border-radius:12px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.25);transition:opacity 0.4s';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.remove(),400); }, 3200);
}

// ── PHASE 3: GMAIL AUTO-TRACKING ─────────────────────────────────────────────

async function partsGmailScanTracking() {
  const existing = document.getElementById('gmail-scan-modal');
  if (existing) existing.remove();
  // Pre-fetch open orders so manual form is populated
  const _tok2 = (JSON.parse(localStorage.getItem('potp_v2_session')||'{}').token)||'';
  const _allOrds = await fetch('/api/parts?action=get_parts_orders',{headers:{'Authorization':'Bearer '+_tok2}}).then(r=>r.json()).catch(()=>[]);
  const _openOrds = _allOrds.filter(o=>o.status!=='received');
  const modal = document.createElement('div');
  modal.id = 'gmail-scan-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
  modal.innerHTML = `
    <div style="background:var(--color-background-primary,#fff);border-radius:16px;width:100%;max-width:620px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.22)">
      <div style="padding:18px 24px 14px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid var(--color-border-primary)">
        <div>
          <div style="font-size:17px;font-weight:700;color:var(--color-text-primary)">📧 Gmail Auto-Tracking Import</div>
          <div style="font-size:13px;color:var(--color-text-secondary);margin-top:2px">Scan inbox for UPS · FedEx · USPS · DHL shipping confirmations</div>
        </div>
        <button onclick="document.getElementById('gmail-scan-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--color-text-secondary);padding:0 4px;line-height:1;margin-top:-2px">✕</button>
      </div>
      <div id="gmail-scan-body" style="flex:1;overflow-y:auto;padding:20px 24px">
        <div style="text-align:center;padding:24px 20px">
          <div style="font-size:48px;margin-bottom:14px">📬</div>
          <div style="font-size:14px;color:var(--color-text-secondary);margin-bottom:20px;line-height:1.6">
            Searches your Gmail inbox for shipping confirmation emails from the last 30 days. Tracking numbers are automatically matched to your open parts orders.
          </div>
          <button onclick="_partsRunGmailScan()" style="padding:12px 32px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#1e40af'" onmouseout="this.style.background='#1a56db'">
            📧 Scan Gmail Inbox
          </button>
        </div>
        ${_partsManualEntryForm(_openOrds)}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function _partsRunGmailScan() {
  const body = document.getElementById('gmail-scan-body');
  body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--color-text-secondary);font-size:14px"><div style="font-size:32px;margin-bottom:12px">📧</div>Scanning Gmail for shipping emails…</div>';

  const token = (JSON.parse(localStorage.getItem('potp_v2_session')||'{}').token)||'';
  const orders = await fetch('/api/parts?action=get_parts_orders',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json()).catch(()=>[]);
  const open = orders.filter(o=>o.status==='pending'||o.status==='ordered'||(o.status!=='received'));

  let found = [];
  try {
    const _gmTok = (JSON.parse(localStorage.getItem('potp_v2_session')||'{}').token)||'';
    const gmailQ = 'Search my Gmail inbox for UPS FedEx USPS DHL shipping confirmation emails from the last 30 days. Extract tracking number carrier vendor ship_date items. Open orders: '+JSON.stringify(open.map(o=>({id:o.id,vendor:o.vendor,part:o.part_number})))+'. Return ONLY a JSON array: [{"tracking_number":"...","carrier":"UPS","vendor":"...","ship_date":"...","items":"...","matched_order_id":null}]. If none return [].';
    const resp = await fetch('/api/ai', {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_gmTok},body:JSON.stringify({query:gmailQ})});
    const data = await resp.json();
    const txt = data.response || '';
    const m = txt.match(/\[[\s\S]*\]/);
    if (m) found = JSON.parse(m[0]);
  } catch(e) { console.error('Gmail scan error:',e); }

  _partsShowGmailResults(found, open);
}

function _partsShowGmailResults(found, open) {
  const body = document.getElementById('gmail-scan-body');
  const carrierTrackUrl = {
    UPS: n=>`https://www.ups.com/track?tracknum=${n}`,
    FedEx: n=>`https://www.fedex.com/fedextrack/?trknbr=${n}`,
    USPS: n=>`https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
    DHL: n=>`https://www.dhl.com/en/express/tracking.html?AWB=${n}`
  };
  const carrierEmoji = {UPS:'🟤',FedEx:'🟣',USPS:'🔵',DHL:'🟡'};

  if (!found.length) {
    body.innerHTML = `<div style="text-align:center;padding:20px">
      <div style="font-size:40px;margin-bottom:12px">📭</div>
      <div style="font-size:14px;color:var(--color-text-secondary);margin-bottom:6px;font-weight:600">No shipping emails found</div>
      <div style="font-size:13px;color:var(--color-text-secondary)">No UPS/FedEx/USPS/DHL confirmation emails in the last 30 days.</div>
    </div>${_partsManualEntryForm(open)}`;
    return;
  }

  let html = `<div style="font-size:13px;font-weight:600;color:var(--color-text-secondary);margin-bottom:12px">Found ${found.length} shipping confirmation${found.length>1?'s':''}</div>`;
  found.forEach((t,i) => {
    const trackUrl = (carrierTrackUrl[t.carrier]||((n)=>'#'))(t.tracking_number);
    const em = carrierEmoji[t.carrier]||'📦';
    const matchedOrder = open.find(o=>o.id===t.matched_order_id) || 
      open.find(o=>t.vendor&&o.vendor&&o.vendor.toLowerCase().includes((t.vendor||'').toLowerCase().split(' ')[0])) ||
      open.find(o=>t.items&&o.part_number&&t.items.toLowerCase().includes(o.part_number.toLowerCase().slice(0,6)));

    html += `<div style="border:1px solid var(--color-border-primary);border-radius:12px;margin-bottom:12px;overflow:hidden">
      <div style="padding:11px 16px;background:var(--color-background-secondary);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:20px">${em}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;color:var(--color-text-primary)">${t.carrier} · <span style="font-family:monospace">${t.tracking_number}</span></div>
          <div style="font-size:12px;color:var(--color-text-secondary)">${t.vendor||''}${t.ship_date?' · '+t.ship_date:''}</div>
        </div>
        <a href="${trackUrl}" target="_blank" style="font-size:12px;color:#1a56db;text-decoration:none;padding:4px 10px;border:1px solid #1a56db;border-radius:6px;font-weight:500;white-space:nowrap">Track →</a>
      </div>
      <div style="padding:12px 16px">
        ${t.items?'<div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:10px">📦 '+t.items+'</div>':''}
        ${matchedOrder
          ? `<div style="padding:8px 12px;background:#f0fdf4;border-radius:8px;margin-bottom:10px;font-size:13px;color:#166534">✅ Matched to open order: <strong>${matchedOrder.part_number}</strong> from ${matchedOrder.vendor}</div>
             <button onclick="_partsSaveTracking('${matchedOrder.id}','${t.tracking_number}','${t.carrier||'Unknown'}')" style="width:100%;padding:10px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">💾 Save Tracking to Order</button>`
          : `<select id="order-sel-${i}" style="width:100%;padding:8px 10px;border:1px solid var(--color-border-primary);border-radius:8px;font-size:13px;margin-bottom:8px;background:var(--color-background-secondary);color:var(--color-text-primary)">
               <option value="">— Link to open order (optional) —</option>
               ${open.map(o=>`<option value="${o.id}">${o.part_number} · ${o.vendor}</option>`).join('')}
             </select>
             <button onclick="_partsSaveTracking(document.getElementById('order-sel-${i}').value,'${t.tracking_number}','${t.carrier||'Unknown'}')" style="width:100%;padding:10px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">💾 Save Tracking Number</button>`
        }
      </div>
    </div>`;
  });
  html += _partsManualEntryForm(open);
  body.innerHTML = html;
}

function _partsManualEntryForm(open) {
  return `<div style="margin-top:16px;padding:16px;border:1.5px dashed var(--color-border-primary);border-radius:10px">
    <div style="font-size:13px;font-weight:600;color:var(--color-text-secondary);margin-bottom:10px">✍️ Manual tracking entry</div>
    <input id="manual-track-num" placeholder="Paste tracking number (UPS/FedEx/USPS/DHL)" oninput="_partsDetectCarrierLive(this.value)" style="width:100%;padding:9px 12px;border:1px solid var(--color-border-primary);border-radius:8px;font-size:13px;margin-bottom:6px;box-sizing:border-box;background:var(--color-background-secondary);color:var(--color-text-primary)">
    <div id="carrier-live-detect" style="font-size:12px;min-height:16px;margin-bottom:8px;color:var(--color-text-secondary)"></div>
    ${open.length?'<select id="manual-order-sel" style="width:100%;padding:8px 10px;border:1px solid var(--color-border-primary);border-radius:8px;font-size:13px;margin-bottom:8px;background:var(--color-background-secondary);color:var(--color-text-primary)"><option value="">— Link to open order —</option>'+open.map(o=>`<option value="${o.id}">${o.part_number} · ${o.vendor}</option>`).join('')+'</select>':'<div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:8px;padding:8px;background:var(--color-background-secondary);border-radius:6px">No open orders to link to</div>'}
    <button onclick="_partsSaveManualTracking()" style="width:100%;padding:10px;background:#1a56db;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">💾 Save Tracking</button>
  </div>`;
}

function _partsDetectCarrierLive(val) {
  const el = document.getElementById('carrier-live-detect');
  if (!el) return;
  const c = _partsDetectCarrier(val);
  el.innerHTML = (c && val.length > 6) ? `<span style="color:#059669">✓ Carrier detected: ${c}</span>` : (val.length>4?'<span style="color:#d97706">⚠️ Carrier not yet detected</span>':'');
}

function _partsDetectCarrier(t) {
  t = (t||'').trim().toUpperCase();
  if (/^1Z[A-Z0-9]{16}$/.test(t)) return 'UPS';
  if (/^\d{12}$/.test(t)||/^\d{15}$/.test(t)||/^\d{20}$/.test(t)) return 'FedEx';
  if (/^(94|92|93|95)\d{20}$/.test(t)) return 'USPS';
  if (/^JD\d{18}$/.test(t)||/^\d{10}$/.test(t)) return 'DHL';
  return null;
}

async function _partsSaveTracking(orderId, trackingNum, carrier) {
  if (!orderId) { alert('Please select an order to link this tracking to'); return; }
  const token = (JSON.parse(localStorage.getItem('potp_v2_session')||'{}').token)||'';
  const h = {'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  const resp = await fetch('/api/parts?action=update_tracking',{
    method:'POST',headers:h,
    body:JSON.stringify({order_id:orderId,tracking_number:trackingNum,carrier:carrier||'Unknown'})
  }).then(r=>r.json());
  if (resp.ok) {
    document.getElementById('gmail-scan-modal')?.remove();
    _partsToast('✅ Tracking number saved!','#059669');
    partsShowTab('orders');
    const orders2 = await fetch('/api/parts?action=get_parts_orders',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json()).catch(()=>[]);
    partsRenderOrders(orders2);
  } else { alert('Failed to save tracking'); }
}

async function _partsSaveManualTracking() {
  const num = (document.getElementById('manual-track-num')?.value||'').trim();
  const orderId = document.getElementById('manual-order-sel')?.value||'';
  if (!num) { alert('Enter a tracking number'); return; }
  const carrier = _partsDetectCarrier(num) || 'Unknown';
  await _partsSaveTracking(orderId, num, carrier);
}

// ── Manual view / download helpers ──────────────────────────────────────────
function partsViewManual(id) {
  var m = (_partsData.manuals||[]).find(function(x){return x.id===id;});
  if (!m || !m.file_url) return;
  var isPdf = (m.file_name||'').toLowerCase().endsWith('.pdf') || m.file_url.startsWith('data:application/pdf');
  if (isPdf) {
    // Open PDF in new tab using blob URL
    var byteStr = atob(m.file_url.split(',')[1]);
    var ab = new ArrayBuffer(byteStr.length);
    var ia = new Uint8Array(ab);
    for (var i=0;i<byteStr.length;i++) ia[i]=byteStr.charCodeAt(i);
    var blob = new Blob([ab],{type:'application/pdf'});
    window.open(URL.createObjectURL(blob),'_blank');
  } else {
    // Show image in overlay
    var ov = document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    ov.onclick=function(){ov.remove();};
    var img=document.createElement('img');
    img.src=m.file_url; img.style.cssText='max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,.5)';
    ov.appendChild(img); document.body.appendChild(ov);
  }
}
window.partsViewManual = partsViewManual;

function partsDownloadManual(id) {
  var m = (_partsData.manuals||[]).find(function(x){return x.id===id;});
  if (!m || !m.file_url) return;
  var a = document.createElement('a');
  a.href = m.file_url;
  a.download = m.file_name || (m.title||'manual').replace(/s+/g,'-') + (m.file_url.startsWith('data:application/pdf') ? '.pdf' : '.file');
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
window.partsDownloadManual = partsDownloadManual;

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
    var labels = {inventory:'Ã°ÂÂÂ¦ Inventory',invoices:'Ã°ÂÂ§Â¾ Invoices',manuals:'Ã°ÂÂÂ Manuals',crossref:'Ã°ÂÂÂ Cross-Ref',orders:'Ã°ÂÂÂ Orders'};
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
  apiCall('GET','/api/records?action=' + actions[tab]).then(function(data){
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
  if (lowStock.length) html += '<div style="font-size:.72rem;color:#ef4444;margin-top:2px">Ã¢ÂÂ Ã¯Â¸Â ' + lowStock.length + ' part(s) below minimum stock</div>';
  html += '</div>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsEditPart(null)">+ Add Part</button></div>';

  // Search
  html += '<input id="parts-search" placeholder="Ã°ÂÂÂ Search part number, description..." style="' + INPUT + ';margin-bottom:12px" oninput="partsFilterInventory()" />';

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
    html += '<button style="' + BTN_INFO + ';margin-right:4px" onclick="partsWebSearch(' + JSON.stringify(p.part_number) + ',' + JSON.stringify(p.description) + ')">Ã°ÂÂÂ Buy</button>';
    html += '<button style="' + BTN_SECONDARY + ';margin-right:4px;padding:5px 8px;font-size:.75rem" onclick="partsEditPart(' + JSON.stringify(p.id) + ')">Ã¢ÂÂÃ¯Â¸Â</button>';
    html += '<button style="' + BTN_DANGER + '" onclick="partsDeletePart(' + JSON.stringify(p.id) + ')">Ã°ÂÂÂ</button>';
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
function partsWebSearch(partNum, desc) {
  var query = encodeURIComponent((partNum||'') + ' ' + (desc||'') + ' price buy');
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">';
  html += '<div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">';
  html += '<h3 style="margin:0;font-size:1rem;color:#1e293b">Ã°ÂÂÂ Find Part: ' + partNum + '</h3>';
  html += '<button style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#64748b" onclick="document.getElementById(\'parts-search-modal\').remove()">ÃÂ</button></div>';
  
  // Search links
  var suppliers = [
    {name:'Google Shopping',url:'https://www.google.com/search?tbm=shop&q=' + query, color:'#4285f4'},
    {name:'Amazon',url:'https://www.amazon.com/s?k=' + encodeURIComponent(partNum + ' ' + (desc||'')), color:'#ff9900'},
    {name:'Grainger',url:'https://www.grainger.com/search?searchQuery=' + encodeURIComponent(partNum), color:'#e31837'},
    {name:'McMaster-Carr',url:'https://www.mcmaster.com/#' + encodeURIComponent(partNum), color:'#003087'},
    {name:'eBay',url:'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(partNum + ' ' + (desc||'')), color:'#e53238'},
    {name:'Zoro',url:'https://www.zoro.com/search?q=' + encodeURIComponent(partNum), color:'#00a651'},
    {name:'Global Industrial',url:'https://www.globalindustrial.com/c/search?q=' + encodeURIComponent(partNum), color:'#0066cc'},
    {name:'Partstown',url:'https://www.partstown.com/search?q=' + encodeURIComponent(partNum), color:'#d4000e'},
  ];
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">';
  suppliers.forEach(function(s){
    html += '<a href="' + s.url + '" target="_blank" style="display:block;padding:10px 14px;background:' + s.color + '08;border:1.5px solid ' + s.color + '30;border-radius:8px;text-decoration:none;color:' + s.color + ';font-weight:600;font-size:.82rem;text-align:center">';
    html += s.name + '</a>';
  });
  html += '</div>';
  
  // Quote request section
  html += '<div style="border-top:1px solid #f1f5f9;padding-top:14px">';
  html += '<div style="font-weight:600;font-size:.85rem;color:#1e293b;margin-bottom:10px">Ã°ÂÂÂ§ Request Price Quotes</div>';
  html += '<div style="font-size:.78rem;color:#64748b;margin-bottom:8px">Send a quote request email to multiple suppliers for Part #' + partNum + '</div>';
  html += '<textarea id="quote-suppliers" rows="2" placeholder="Supplier emails (comma separated)" style="' + INPUT + ';margin-bottom:8px"></textarea>';
  html += '<button style="' + BTN_PRIMARY + ';width:100%" onclick="partsSendQuoteRequest(' + JSON.stringify(partNum) + ',' + JSON.stringify(desc||'') + ')">Send Quote Requests</button>';
  html += '</div>';
  
  // Order button
  html += '<div style="border-top:1px solid #f1f5f9;padding-top:14px;margin-top:14px">';
  html += '<button style="' + BTN_SUCCESS + ';width:100%;padding:10px" onclick="document.getElementById(\'parts-search-modal\').remove();partsShowTab(\'orders\');setTimeout(function(){partsNewOrder(' + JSON.stringify(partNum) + ',' + JSON.stringify(desc||'') + ')},300)">+ Create Order for this Part</button>';
  html += '</div></div></div>';
  
  var modal = document.createElement('div');
  modal.id = 'parts-search-modal';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}
window.partsWebSearch = partsWebSearch;

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
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsEditInvoice(null)">+ Add Invoice</button>
      <button onclick="partsScanInvoice()" style="background:#0f7d3e;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:.85rem;cursor:pointer;font-weight:600;margin-left:8px">ð· Scan Invoice</button></div>';
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
      html += '<button style="' + BTN_INFO + ';margin-top:4px" onclick="partsEditInvoice(' + JSON.stringify(inv.id) + ')">Ã¢ÂÂÃ¯Â¸Â Edit</button></div></div>';
      if (items.length) {
        html += '<div style="margin-top:10px;border-top:1px solid #f1f5f9;padding-top:10px">';
        html += '<div style="font-size:.72rem;font-weight:600;color:#64748b;margin-bottom:6px">LINE ITEMS</div>';
        items.forEach(function(item){
          html += '<div style="display:flex;justify-content:space-between;font-size:.78rem;padding:3px 0;border-bottom:1px solid #f8fafc">';
          html += '<span style="color:#1e293b"><strong>' + (item.part_number||'') + '</strong> Ã¢ÂÂ ' + (item.description||'') + '</span>';
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
    + '<button style="' + BTN_DANGER + '" onclick="this.closest(\'[id^=inv-item]\').remove()">Ã¢ÂÂ</button></div>';
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
  html += '<input id="crossref-search" placeholder="Ã°ÂÂÂ Search part number or manufacturer..." style="' + INPUT + ';margin-bottom:12px" oninput="partsCrossRefFilter()" />';
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
  ['Part A','Mfr A','Ã¢ÂÂ','Part B','Mfr B','Notes','Actions'].forEach(function(h){
    html += '<th style="padding:8px 10px;text-align:left;font-weight:600;color:#64748b">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  refs.forEach(function(ref){
    html += '<tr style="border-bottom:1px solid #f1f5f9">';
    html += '<td style="padding:8px 10px;font-weight:600;color:#1a3a6b">' + (ref.part_number_a||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b">' + (ref.manufacturer_a||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#94a3b8;text-align:center">Ã¢ÂÂ</td>';
    html += '<td style="padding:8px 10px;font-weight:600;color:#065f46">' + (ref.part_number_b||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b">' + (ref.manufacturer_b||'') + '</td>';
    html += '<td style="padding:8px 10px;color:#64748b;font-size:.75rem">' + (ref.notes||'') + '</td>';
    html += '<td style="padding:8px 10px;white-space:nowrap">';
    html += '<button style="' + BTN_INFO + ';margin-right:4px" onclick="partsCrossRefSearch(' + JSON.stringify(ref) + ')">Compare Prices</button>';
    html += '<button style="' + BTN_DANGER + '" onclick="partsDeleteRef(' + JSON.stringify(ref.id) + ')">Ã°ÂÂÂ</button>';
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
  html += '<button style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:#64748b" onclick="document.getElementById(\'crossref-modal\').remove()">ÃÂ</button></div>';
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
    html += '<a href="https://www.google.com/search?tbm=shop&q=' + q + '" target="_blank" style="display:block;text-align:center;padding:6px;background:' + color + ';color:#fff;border-radius:5px;text-decoration:none;font-size:.75rem;font-weight:600">Search Prices Ã¢ÂÂ</a>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div style="background:#f8fafc;border-radius:8px;padding:12px;font-size:.78rem;color:#64748b">';
  html += 'Ã°ÂÂÂ¡ <strong>Tip:</strong> Compare the search results from both options to determine the most cost-effective choice. Note lead times and shipping costs.';
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
  html += '<div style="grid-column:1/-1;text-align:center;font-weight:600;color:#64748b;font-size:.8rem;padding:4px;background:#f8fafc;border-radius:6px">Part A Ã¢ÂÂ Part B (equivalent parts)</div>';
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
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsNewOrder()">+ New Order</button></div>';
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
      if (ord.tracking_number) html += '<div style="font-size:.72rem;color:#3b82f6;margin-top:2px">Ã°ÂÂÂ¦ Tracking: ' + ord.tracking_number + '</div>';
      html += '</div>';
      html += '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">';
      if (ord.status !== 'received') {
        html += '<button style="' + BTN_INFO + '" onclick="partsAddTracking(' + JSON.stringify(ord.id) + ')">Add Tracking</button>';
        html += '<button style="' + BTN_SUCCESS + '" onclick="partsReceiveOrder(' + JSON.stringify(ord.id) + ',' + JSON.stringify(ord.qty_ordered) + ')">Ã¢ÂÂ Receive</button>';
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
  html += '<input id="manual-search" placeholder="Ã°ÂÂÂ Search part numbers in manuals..." style="' + INPUT + ';flex:1" />';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsSearchManuals()">Search</button></div>';
  html += '<div id="manual-results"></div>';
  if (!manuals.length) {
    html += '<div style="text-align:center;padding:40px;color:#94a3b8">No manuals uploaded yet.</div>';
  } else {
    manuals.forEach(function(m){
      html += '<div style="' + CARD + ';display:flex;justify-content:space-between;align-items:center">';
      html += '<div>';
      html += '<div style="font-weight:600;color:#1e293b">Ã°ÂÂÂ ' + (m.title||'Untitled') + '</div>';
      html += '<div style="font-size:.73rem;color:#64748b;margin-top:2px">' + (m.manufacturer||'') + (m.model?' Ã¢ÂÂ Model: '+m.model:'') + '</div>';
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
          + '<div style="font-weight:600;color:#1a3a6b">Ã°ÂÂÂ ' + (h.title||'') + '</div>'
          + (h.excerpt ? '<div style="color:#64748b;margin-top:4px;font-family:monospace;font-size:.75rem;background:#f8fafc;padding:6px;border-radius:4px">' + h.excerpt + '</div>' : '')
          + '</div>';
      }).join('');
  });
}
window.partsSearchManuals = partsSearchManuals;

function partsAddManual() {
  var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">';
  html += '<div style="background:#fff;border-radius:12px;padding:24px;max-width:440px;width:100%">';
  html += '<h3 style="margin:0 0 16px;font-size:1rem;color:#1e293b">Add Parts Manual</h3>';
  html += '<div style="display:grid;gap:10px">';
  html += '<div><label style="' + LABEL + '">Manual Title *</label><input id="man-title" placeholder="e.g. Caterpillar D6 Parts Manual" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Manufacturer</label><input id="man-mfr" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Model / Equipment</label><input id="man-model" style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">PDF URL (link to hosted PDF)</label><input id="man-url" placeholder="https://..." style="' + INPUT + '" /></div>';
  html += '<div><label style="' + LABEL + '">Paste part numbers / text excerpt (for search)</label>';
  html += '<textarea id="man-text" rows="5" placeholder="Paste part numbers, descriptions, or any searchable text from the manual..." style="' + INPUT + ';resize:vertical"></textarea></div>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">';
  html += '<button style="' + BTN_SECONDARY + '" onclick="document.getElementById(\'parts-modal\').remove()">Cancel</button>';
  html += '<button style="' + BTN_PRIMARY + '" onclick="partsSaveManual()">Save Manual</button></div></div></div>';
  var modal = document.createElement('div');
  modal.id = 'parts-modal';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}
window.partsAddManual = partsAddManual;

function partsSaveManual() {
  var data = {
    title: (document.getElementById('man-title')||{}).value||'',
    manufacturer: (document.getElementById('man-mfr')||{}).value||'',
    model: (document.getElementById('man-model')||{}).value||'',
    file_url: (document.getElementById('man-url')||{}).value||'',
    extracted_text: (document.getElementById('man-text')||{}).value||''
  };
  if (!data.title) { alert('Title required'); return; }
  apiCall('POST','/api/parts?action=save_manual',data).then(function(){
    var m = document.getElementById('parts-modal');
    if (m) m.remove();
    partsShowTab('manuals');
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


// ââ INVOICE SCAN FEATURE âââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function partsScanInvoice() {
  // Build the scan modal
  const overlay = document.createElement('div');
  overlay.id = 'parts-scan-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h3 style="margin:0;font-size:1.1rem;color:#1e3a5f">ð· Scan Invoice</h3>
        <button onclick="document.getElementById('parts-scan-overlay').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#64748b">â</button>
      </div>
      <p style="font-size:.85rem;color:#64748b;margin:0 0 16px">Upload a photo or scan of your invoice. Claude AI will extract all part numbers, descriptions, quantities, and pricing automatically.</p>
      
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <label style="flex:1;border:2px dashed #cbd5e1;border-radius:8px;padding:20px;text-align:center;cursor:pointer;transition:border-color .2s" 
               onmouseover="this.style.borderColor='#1e3a5f'" onmouseout="this.style.borderColor='#cbd5e1'">
          <input type="file" accept="image/*" id="parts-scan-file" style="display:none" onchange="partsScanPreview(this)">
          <div style="font-size:2rem">ð</div>
          <div style="font-size:.8rem;font-weight:600;color:#1e3a5f;margin-top:4px">Upload File</div>
          <div style="font-size:.75rem;color:#64748b">JPG, PNG, PDF photo</div>
        </label>
        <label style="flex:1;border:2px dashed #cbd5e1;border-radius:8px;padding:20px;text-align:center;cursor:pointer;transition:border-color .2s"
               onmouseover="this.style.borderColor='#1e3a5f'" onmouseout="this.style.borderColor='#cbd5e1'">
          <input type="file" accept="image/*" capture="environment" id="parts-scan-camera" style="display:none" onchange="partsScanPreview(this)">
          <div style="font-size:2rem">ð·</div>
          <div style="font-size:.8rem;font-weight:600;color:#1e3a5f;margin-top:4px">Take Photo</div>
          <div style="font-size:.75rem;color:#64748b">Use camera</div>
        </label>
      </div>
      
      <div id="parts-scan-preview" style="display:none;margin-bottom:16px;text-align:center">
        <img id="parts-scan-img" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #e2e8f0" />
        <div style="margin-top:8px">
          <button id="parts-scan-extract-btn" onclick="partsScanExtract()" style="background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:10px 24px;font-size:.9rem;cursor:pointer;font-weight:600">
            ð Extract Invoice Data
          </button>
        </div>
      </div>
      
      <div id="parts-scan-loading" style="display:none;text-align:center;padding:24px">
        <div style="font-size:2rem;animation:parts-spin 1s linear infinite;display:inline-block">âï¸</div>
        <div style="font-size:.9rem;color:#1e3a5f;font-weight:600;margin-top:8px">Claude is reading your invoice...</div>
        <div style="font-size:.8rem;color:#64748b;margin-top:4px">Extracting part numbers, quantities, and pricing</div>
      </div>
      
      <div id="parts-scan-results" style="display:none"></div>
    </div>
    <style>@keyframes parts-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(overlay);
}

function partsScanPreview(input) {
  const file = input.files[0];
  if (!file) return;
  window._partsScanFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('parts-scan-img').src = e.target.result;
    document.getElementById('parts-scan-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function partsScanExtract() {
  const file = window._partsScanFile;
  if (!file) return;
  
  document.getElementById('parts-scan-preview').style.display = 'none';
  document.getElementById('parts-scan-loading').style.display = 'block';
  document.getElementById('parts-scan-extract-btn').disabled = true;
  
  try {
    // Convert to base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    
    const mediaType = file.type || 'image/jpeg';
    const token = (function(){ try { return JSON.parse(localStorage.getItem('potp_v2_session')).token; } catch(e){ return ''; } })();
    
    const res = await apiCall('POST', '/api/parts?action=extract_invoice', {
      image_base64: base64,
      media_type: mediaType
    });
    
    document.getElementById('parts-scan-loading').style.display = 'none';
    partsScanShowResults(res);
    
  } catch(err) {
    document.getElementById('parts-scan-loading').style.display = 'none';
    document.getElementById('parts-scan-results').style.display = 'block';
    document.getElementById('parts-scan-results').innerHTML = `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;color:#dc2626">
        â Error: ${err.message || 'Failed to extract invoice data'}
      </div>
    `;
  }
}

function partsScanShowResults(data) {
  const resultsEl = document.getElementById('parts-scan-results');
  resultsEl.style.display = 'block';
  
  const items = data.line_items || [];
  
  let html = `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px">
      <div style="font-weight:700;color:#166534;font-size:.9rem;margin-bottom:6px">â Invoice Extracted Successfully</div>
      <div style="font-size:.8rem;color:#166534;display:grid;grid-template-columns:1fr 1fr;gap:4px">
        <span><strong>Vendor:</strong> ${data.vendor || 'â'}</span>
        <span><strong>Invoice #:</strong> ${data.invoice_number || 'â'}</span>
        <span><strong>Date:</strong> ${data.invoice_date || 'â'}</span>
        <span><strong>Total:</strong> ${data.total_amount ? '$'+Number(data.total_amount).toFixed(2) : 'â'}</span>
      </div>
    </div>
  `;
  
  if (items.length > 0) {
    html += `
      <div style="font-weight:600;font-size:.85rem;color:#1e3a5f;margin-bottom:8px">
        Line Items Found (${items.length}) â Select items to add to inventory:
      </div>
      <div style="overflow-x:auto;margin-bottom:12px">
        <table style="width:100%;border-collapse:collapse;font-size:.78rem">
          <thead>
            <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0">
              <th style="padding:6px 4px;text-align:left;width:28px">
                <input type="checkbox" id="scan-check-all" onchange="partsScanToggleAll(this.checked)" checked>
              </th>
              <th style="padding:6px 4px;text-align:left">Part #</th>
              <th style="padding:6px 4px;text-align:left">Description</th>
              <th style="padding:6px 4px;text-align:left">Mfr</th>
              <th style="padding:6px 4px;text-align:right">Qty</th>
              <th style="padding:6px 4px;text-align:right">Unit $</th>
            </tr>
          </thead>
          <tbody id="scan-items-body">
    `;
    
    items.forEach((item, idx) => {
      html += `
        <tr style="border-bottom:1px solid #f1f5f9" id="scan-row-${idx}">
          <td style="padding:5px 4px"><input type="checkbox" class="scan-item-check" data-idx="${idx}" checked></td>
          <td style="padding:5px 4px">
            <input type="text" value="${item.part_number||''}" data-field="part_number" data-idx="${idx}" 
                   style="width:90px;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:.78rem">
          </td>
          <td style="padding:5px 4px">
            <input type="text" value="${item.description||''}" data-field="description" data-idx="${idx}"
                   style="width:140px;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:.78rem">
          </td>
          <td style="padding:5px 4px">
            <input type="text" value="${item.manufacturer||''}" data-field="manufacturer" data-idx="${idx}"
                   style="width:70px;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:.78rem">
          </td>
          <td style="padding:5px 4px;text-align:right">
            <input type="number" value="${item.quantity||1}" data-field="quantity" data-idx="${idx}"
                   style="width:50px;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:.78rem;text-align:right">
          </td>
          <td style="padding:5px 4px;text-align:right">
            <input type="number" step="0.01" value="${item.unit_cost||0}" data-field="unit_cost" data-idx="${idx}"
                   style="width:65px;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:.78rem;text-align:right">
          </td>
        </tr>
      `;
    });
    
    html += `</tbody></table></div>`;
    
    html += `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button onclick="partsScanSaveInvoice(${JSON.stringify(data).replace(/"/g,'&quot;')})" 
                style="background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:.85rem;cursor:pointer;font-weight:600">
          ð¾ Save Invoice Record
        </button>
        <button onclick="partsScanAddToInventory()" 
                style="background:#0f7d3e;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:.85rem;cursor:pointer;font-weight:600">
          ð¦ Add Selected to Inventory
        </button>
        <button onclick="partsScanBoth(${JSON.stringify(data).replace(/"/g,'&quot;')})"
                style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:.85rem;cursor:pointer;font-weight:600">
          â Save Invoice + Add to Inventory
        </button>
      </div>
    `;
  } else {
    html += `<div style="color:#64748b;font-size:.85rem;padding:12px;text-align:center">No line items found. Try a clearer photo.</div>`;
  }
  
  window._partsScanData = { ...data, line_items: items };
  resultsEl.innerHTML = html;
}

function partsScanToggleAll(checked) {
  document.querySelectorAll('.scan-item-check').forEach(cb => cb.checked = checked);
}

function partsScanGetSelectedItems() {
  const items = window._partsScanData?.line_items || [];
  const selected = [];
  document.querySelectorAll('.scan-item-check').forEach(cb => {
    if (!cb.checked) return;
    const idx = parseInt(cb.dataset.idx);
    // Read current (possibly edited) values from inputs
    const row = document.getElementById('scan-row-' + idx);
    const inputs = row.querySelectorAll('input[data-field]');
    const item = { ...items[idx] };
    inputs.forEach(inp => {
      const field = inp.dataset.field;
      item[field] = field === 'quantity' || field === 'unit_cost' ? parseFloat(inp.value)||0 : inp.value;
    });
    selected.push(item);
  });
  return selected;
}

async function partsScanAddToInventory() {
  const selected = partsScanGetSelectedItems();
  if (selected.length === 0) { alert('No items selected'); return; }
  
  const token = (function(){ try { return JSON.parse(localStorage.getItem('potp_v2_session')).token; } catch(e){ return ''; } })();
  let added = 0, updated = 0;
  
  for (const item of selected) {
    if (!item.part_number && !item.description) continue;
    try {
      // Check if part already exists in inventory
      const existing = await apiCall('GET', '/api/parts?action=get_parts');
      const match = existing.find(p => p.part_number && item.part_number && 
        p.part_number.toLowerCase() === item.part_number.toLowerCase());
      
      if (match) {
        // Update quantity
        await apiCall('POST', '/api/parts?action=update_part', {
          id: match.id, field: 'quantity',
          value: (parseInt(match.quantity)||0) + (parseInt(item.quantity)||1)
        });
        updated++;
      } else {
        // Add new part
        await apiCall('POST', '/api/parts?action=save_part', {
          part_number: item.part_number || '',
          description: item.description || '',
          manufacturer: item.manufacturer || '',
          category: '',
          quantity: parseInt(item.quantity) || 1,
          min_quantity: 1,
          unit_cost: parseFloat(item.unit_cost) || 0,
          location: '',
          notes: 'Added from invoice scan'
        });
        added++;
      }
    } catch(e) { console.error('Error adding part:', item, e); }
  }
  
  alert(`â Done! ${added} part(s) added to inventory, ${updated} updated.`);
  document.getElementById('parts-scan-overlay')?.remove();
  partsShowTab('inventory');
}

async function partsScanSaveInvoice(data) {
  const selected = partsScanGetSelectedItems();
  try {
    await apiCall('POST', '/api/parts?action=save_invoice', {
      vendor: data.vendor || '',
      invoice_number: data.invoice_number || '',
      invoice_date: data.invoice_date || null,
      total_amount: data.total_amount || 0,
      notes: 'Scanned invoice',
      items: selected
    });
    alert('â Invoice saved!');
    partsShowTab('invoices');
  } catch(e) { alert('Error saving invoice: ' + e.message); }
}

async function partsScanBoth(data) {
  await partsScanSaveInvoice(data);
  await partsScanAddToInventory();
}

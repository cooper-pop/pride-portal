// parts.js - Parts Inventory Widget
// Tabs: Inventory | Invoices | Manuals | Cross-Ref | Orders | Machines

var _partsTab = 'inventory';
var _partsData = { inventory:[], invoices:[], manuals:[], crossref:[], orders:[] };
var _editingPart = null;
var _editingInvoice = null;
var _machinesList = [];
var _scanLineCount = 0;

function loadMachines() {
    try { _machinesList = JSON.parse(localStorage.getItem('parts_machines') || '[]'); } catch(e){ _machinesList = []; }
}
function saveMachines() {
    localStorage.setItem('parts_machines', JSON.stringify(_machinesList));
}

function buildPartsWidget() {
    var wt = document.getElementById('widget-tabs');
    var wc = document.getElementById('widget-content');
    var tabs = ['inventory','invoices','manuals','crossref','orders','machines'];
    var labels = {inventory:'📦 Inventory',invoices:'📄 Invoices',manuals:'📋 Manuals',crossref:'🔍 Cross-Ref',orders:'🛒 Orders',machines:'🔧 Machines'};
    wt.innerHTML = tabs.map(function(t){
          return '<button class="wtab" onclick="partsShowTab(\'' + t + '\')" id="ptab-' + t + '" style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;border-bottom:2px solid transparent;color:#94a3b8">' + labels[t] + '</button>';
    }).join('');
    wc.innerHTML = '<div id="parts-panel" style="padding:0"></div>';
    loadMachines();
    partsInit();
}

function partsInit() {
    apiCall('GET','/api/parts?action=init_parts_db').then(function(){
          partsShowTab('inventory');
    }).catch(function(){ partsShowTab('inventory'); });
}

function partsShowTab(tab) {
    _partsTab = tab;
    ['inventory','invoices','manuals','crossref','orders','machines'].forEach(function(t){
          var btn = document.getElementById('ptab-' + t);
          if (btn) {
                  btn.style.borderBottomColor = t===tab ? '#1a3a6b' : 'transparent';
                  btn.style.color = t===tab ? '#1a3a6b' : '#94a3b8';
                  btn.style.fontWeight = t===tab ? '600' : '400';
          }
    });
    var panel = document.getElementById('parts-panel');
    if (!panel) return;
    if (tab === 'machines') { partsRenderMachines(); return; }
    panel.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:.8rem">Loading...</div>';
    var actions = {inventory:'get_parts',invoices:'get_invoices',manuals:'get_manuals',crossref:'get_cross_ref',orders:'get_parts_orders'};
    apiCall('GET','/api/parts?action=' + actions[tab]).then(function(data){
          _partsData[tab] = Array.isArray(data) ? data : [];
          var renders = {inventory:partsRenderInventory,invoices:partsRenderInvoices,manuals:partsRenderManuals,crossref:partsRenderCrossRef,orders:partsRenderOrders};
          if (renders[tab]) renders[tab]();
    }).catch(function(){
          panel.innerHTML = '<div style="padding:20px;color:#ef4444">Error loading data</div>';
    });
}
window.partsShowTab = partsShowTab;

var CARD = 'background:#fff;border-radius:10px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)';
var BTN = 'padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
var BTN_P = BTN + ';background:#1a3a6b;color:#fff';
var BTN_S = BTN + ';background:#6366f1;color:#fff';
var BTN_E = 'padding:3px 9px;border-radius:5px;border:none;cursor:pointer;font-size:.73rem;background:#e0e7ff;color:#3730a3';
var BTN_D = 'padding:3px 9px;border-radius:5px;border:none;cursor:pointer;font-size:.73rem;background:#fee2e2;color:#b91c1c;margin-left:5px';
var INP = 'width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.83rem;margin-bottom:8px;box-sizing:border-box';

function machineTagOptions(sel) {
    var o = '<option value="shop_stock"' + (!sel||sel==='shop_stock'?' selected':'') + '>🏪 Shop Stock</option>';
    _machinesList.forEach(function(m){ o += '<option value="' + m.id + '"' + (sel===m.id?' selected':'') + '>🔧 ' + m.name + '</option>'; });
    return o;
}
function machineTagLabel(v) {
    if (!v||v==='shop_stock') return '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:10px;font-size:.72rem">🏪 Shop Stock</span>';
    var m = _machinesList.find(function(x){ return x.id===v; });
    return m ? '<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:10px;font-size:.72rem">🔧 ' + m.name + '</span>' : '<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:10px;font-size:.72rem">' + v + '</span>';
}

// ===== INVENTORY =====
function partsRenderInventory() {
    var panel = document.getElementById('parts-panel');
    var items = _partsData.inventory;
    var html = '<div style="padding:14px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
    html += '<span style="font-weight:700;font-size:.95rem">Parts Inventory</span>';
    html += '<div><button style="' + BTN_S + ';margin-right:6px" onclick="partsFindParts()">🔍 Find</button>';
    html += '<button style="' + BTN_P + '" onclick="partsAddPartForm(-1)">+ Add Part</button></div></div>';
    html += '<input type="text" placeholder="Search part number, description..." style="' + INP + '" oninput="partsSearchInv(this.value)">';
    if (!items.length) {
          html += '<div style="text-align:center;color:#94a3b8;padding:30px 0;font-size:.85rem">No parts yet. Add your first part!</div>';
    } else {
          html += '<div id="inv-list">' + items.map(function(p,i){ return partsInvCard(p,i); }).join('') + '</div>';
    }
    html += '</div>';
    panel.innerHTML = html;
}
function partsInvCard(p,i) {
    return '<div style="' + CARD + '"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.85rem">' + (p.part_number||'') + (p.part_number&&p.description?' — ':'') + (p.description||'') + '</div><div style="color:#64748b;font-size:.78rem;margin-top:3px">Qty: <b>' + (p.quantity||0) + '</b> &nbsp;Cost: <b>$' + parseFloat(p.unit_cost||0).toFixed(2) + '</b>' + (p.supplier?' &nbsp;|&nbsp;'+p.supplier:'') + '</div><div style="margin-top:5px">' + machineTagLabel(p.machine_tag) + '</div>' + (p.notes?'<div style="color:#94a3b8;font-size:.75rem;margin-top:3px">'+p.notes+'</div>':'') + '</div><div style="white-space:nowrap;margin-left:8px"><button style="' + BTN_E + '" onclick="partsAddPartForm(' + i + ')">✏️</button><button style="' + BTN_D + '" onclick="partsDelPart(' + i + ')">🗑️</button></div></div></div>';
}
function partsSearchInv(q) {
    var list = document.getElementById('inv-list');
    if (!list) return;
    var lo = q.toLowerCase();
    var f = _partsData.inventory.filter(function(p){ return (p.part_number||'').toLowerCase().includes(lo)||(p.description||'').toLowerCase().includes(lo); });
    list.innerHTML = f.length ? f.map(function(p,i){ return partsInvCard(p,i); }).join('') : '<div style="text-align:center;color:#94a3b8;padding:20px">No results</div>';
}
function partsFindParts() { var q=prompt('Search part number or keyword:'); if(q) partsSearchInv(q); }

function partsAddPartForm(editIdx) {
    loadMachines();
    var p = editIdx>=0 ? _partsData.inventory[editIdx] : {};
    var isEdit = editIdx>=0;
    document.getElementById('parts-panel').innerHTML = '<div style="padding:14px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><button style="' + BTN + ';background:#f1f5f9;color:#334155" onclick="partsShowTab(\'inventory\')">← Back</button><span style="font-weight:700;font-size:.95rem">' + (isEdit?'Edit Part':'Add New Part') + '</span></div>' +
          '<input type="text" placeholder="Part Number" id="pf-num" style="' + INP + '" value="' + (p.part_number||'') + '">' +
          '<input type="text" placeholder="Description" id="pf-desc" style="' + INP + '" value="' + (p.description||'') + '">' +
          '<input type="number" placeholder="Quantity" id="pf-qty" style="' + INP + '" value="' + (p.quantity||'') + '">' +
          '<input type="number" placeholder="Unit Cost ($)" id="pf-cost" step="0.01" style="' + INP + '" value="' + (p.unit_cost||'') + '">' +
          '<input type="text" placeholder="Supplier" id="pf-sup" style="' + INP + '" value="' + (p.supplier||'') + '">' +
          '<label style="font-size:.78rem;color:#64748b;margin-bottom:3px;display:block">Assign to Machine or Shop Stock</label>' +
          '<select id="pf-mach" style="' + INP + '">' + machineTagOptions(p.machine_tag||'') + '</select>' +
          '<textarea placeholder="Notes" id="pf-notes" style="' + INP + 'resize:vertical;height:60px">' + (p.notes||'') + '</textarea>' +
          '<button style="' + BTN_P + ';width:100%" onclick="partsSavePart(' + editIdx + ')">💾 ' + (isEdit?'Update':'Save') + ' Part</button>' +
          '</div>';
}

function partsSavePart(editIdx) {
    var data = { part_number:document.getElementById('pf-num').value, description:document.getElementById('pf-desc').value, quantity:document.getElementById('pf-qty').value, unit_cost:document.getElementById('pf-cost').value, supplier:document.getElementById('pf-sup').value, machine_tag:document.getElementById('pf-mach').value, notes:document.getElementById('pf-notes').value };
    var action = editIdx>=0 ? 'update_part' : 'add_part';
    if (editIdx>=0) data.id = _partsData.inventory[editIdx].id;
    apiCall('POST','/api/parts?action='+action, data).then(function(){ partsShowTab('inventory'); }).catch(function(){ alert('Error saving part'); });
}
function partsDelPart(i) {
    if (!confirm('Delete this part?')) return;
    apiCall('POST','/api/parts?action=delete_part',{id:_partsData.inventory[i].id}).then(function(){ partsShowTab('inventory'); }).catch(function(){ alert('Error'); });
}

// ===== INVOICES =====
function partsRenderInvoices() {
    var panel = document.getElementById('parts-panel');
    var items = _partsData.invoices;
    var html = '<div style="padding:14px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-weight:700;font-size:.95rem">Parts Invoices</span>';
    html += '<div><button style="' + BTN_S + ';margin-right:6px" onclick="partsScanInvoice()">📷 Scan Invoice</button><button style="' + BTN_P + '" onclick="partsInvoiceForm(-1)">+ Add</button></div></div>';
    if (!items.length) {
          html += '<div style="text-align:center;color:#94a3b8;padding:30px 0;font-size:.85rem">No invoices yet.</div>';
    } else {
          items.forEach(function(inv,i){
                  html += '<div style="' + CARD + '"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="flex:1"><div style="font-weight:600;font-size:.85rem">Invoice #' + (inv.invoice_number||i+1) + ' — ' + (inv.vendor||'Unknown Vendor') + '</div><div style="color:#64748b;font-size:.78rem;margin-top:2px">' + (inv.date||'') + ' | Total: <b>$' + parseFloat(inv.total||0).toFixed(2) + '</b></div>';
                  if (inv.line_items&&inv.line_items.length) {
                            html += '<div style="margin-top:8px;font-size:.78rem;background:#f8fafc;border-radius:6px;padding:6px">';
                            inv.line_items.forEach(function(li){ html += '<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #f1f5f9"><span style="flex:3">' + (li.item||'') + '</span><span style="color:#64748b">x' + (li.qty||0) + '</span><span style="color:#1a3a6b;font-weight:600">$' + parseFloat(li.cost||0).toFixed(2) + '</span></div>'; });
                            html += '</div>';
                  }
                  html += '</div><div style="white-space:nowrap;margin-left:8px"><button style="' + BTN_E + '" onclick="partsInvoiceForm(' + i + ')">✏️</button><button style="' + BTN_D + '" onclick="partsDelInvoice(' + i + ')">🗑️</button></div></div></div>';
          });
    }
    html += '</div>';
    panel.innerHTML = html;
}

function partsScanInvoice() {
    _scanLineCount = 0;
    document.getElementById('parts-panel').innerHTML = '<div style="padding:14px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><button style="' + BTN + ';background:#f1f5f9;color:#334155" onclick="partsShowTab(\'invoices\')">← Back</button><span style="font-weight:700;font-size:.95rem">📷 Scan Invoice</span></div>' +
          '<div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:10px;padding:24px;text-align:center;margin-bottom:14px">' +
          '<div style="font-size:2.2rem;margin-bottom:6px">📄</div>' +
          '<div style="font-weight:600;color:#334155;margin-bottom:4px">Upload Invoice Photo or Image</div>' +
          '<div style="color:#94a3b8;font-size:.78rem;margin-bottom:14px">AI will extract items, quantities, and costs automatically</div>' +
          '<input type="file" id="inv-img-input" accept="image/*" capture="environment" style="display:none" onchange="partsRunScan(this)">' +
          '<button style="' + BTN_P + '" onclick="document.getElementById(\'inv-img-input\').click()">📷 Choose Photo / File</button>' +
          '</div>' +
          '<div id="scan-preview" style="display:none;text-align:center;margin-bottom:10px"><img id="scan-img" style="max-width:100%;max-height:180px;border-radius:8px;object-fit:contain"><div id="scan-status" style="color:#6366f1;font-weight:600;margin-top:6px;font-size:.85rem">Scanning...</div></div>' +
          '<div id="scan-results" style="display:none">' +
          '<div style="font-weight:700;margin-bottom:8px;color:#1a3a6b;font-size:.88rem">📋 Review & Edit Scanned Data</div>' +
          '<label style="font-size:.75rem;color:#64748b">Vendor</label><input type="text" id="sc-vendor" style="' + INP + '">' +
          '<label style="font-size:.75rem;color:#64748b">Invoice #</label><input type="text" id="sc-invnum" style="' + INP + '">' +
          '<label style="font-size:.75rem;color:#64748b">Date</label><input type="date" id="sc-date" style="' + INP + '">' +
          '<div style="font-weight:600;font-size:.82rem;margin-bottom:6px;color:#334155">Line Items <button style="' + BTN + ';background:#f1f5f9;color:#334155;padding:3px 8px;font-size:.72rem" onclick="partsAddScanLine(\'\',\'\',\'\')">+ Add Row</button></div>' +
          '<div id="scan-lines"></div>' +
          '<button style="' + BTN_P + ';width:100%;margin-top:8px" onclick="partsSaveScanInvoice()">💾 Save Invoice</button>' +
          '</div></div>';
}

function partsRunScan(input) {
    if (!input.files||!input.files[0]) return;
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function(e) {
          var b64full = e.target.result;
          var b64 = b64full.split(',')[1];

        function partsRunScan(input) {
              if (!input.files||!input.files[0]) return;
              var file = input.files[0];
              var reader = new FileReader();
              reader.onload = function(e) {
                      var b64full = e.target.result;
                      var b64 = b64full.split(',')[1];
                      var mime = file.type||'image/jpeg';
                      document.getElementById('scan-preview').style.display='block';
                      document.getElementById('scan-img').src = b64full;
                      document.getElementById('scan-status').textContent = 'AI scanning invoice...';
                      fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
                                model:'claude-sonnet-4-20250514',max_tokens:1000,
                                messages:[{role:'user',content:[
                                    {type:'image',source:{type:'base64',media_type:mime,data:b64}},
                                    {type:'text',text:'This is a parts invoice. Respond ONLY with valid JSON, no markdown:\n{"vendor":"","invoice_number":"","date":"YYYY-MM-DD","line_items":[{"item":"","qty":0,"cost":0.00}]}\nExtract every line item with its description, quantity, and unit cost.'}
                                          ]}]
                      })}).then(function(r){return r.json();}).then(function(d){
                                var txt='';
                                if(d.content&&d.content[0]&&d.content[0].text) txt=d.content[0].text;
                                try {
                                            var parsed=JSON.parse(txt.replace(/```json|```/g,'').trim());
                                            document.getElementById('scan-status').textContent='Scan complete! Review below.';
                                            document.getElementById('scan-results').style.display='block';
                                            document.getElementById('sc-vendor').value=parsed.vendor||'';
                                            document.getElementById('sc-invnum').value=parsed.invoice_number||'';
                                            document.getElementById('sc-date').value=parsed.date||'';
                                            var lines=parsed.line_items||[];
                                            lines.forEach(function(li){partsAddScanLine(li.item,li.qty,li.cost);});
                                            if(!lines.length) partsAddScanLine('','','');
                                } catch(err) {
                                            document.getElementById('scan-status').textContent='Could not parse. Enter manually.';
                                            document.getElementById('scan-results').style.display='block';
                                            partsAddScanLine('','','');
                                }
                      }).catch(function(){
                                document.getElementById('scan-status').textContent='Scan error. Enter manually.';
                                document.getElementById('scan-results').style.display='block';
                                partsAddScanLine('','','');
                      });
              };
              reader.readAsDataURL(file);
        }

        function partsAddScanLine(item,qty,cost) {
              var id='sl'+(++_scanLineCount);
              var container=document.getElementById('scan-lines');
              if(!container) return;
              var div=document.createElement('div');
              div.id=id;
              div.style.cssText='display:flex;gap:5px;margin-bottom:5px;align-items:center';
              div.innerHTML='<input type="text" placeholder="Item / Part Name" style="flex:3;padding:6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.78rem" value="'+(item||'')+'"><input type="number" placeholder="Qty" style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.78rem" value="'+(qty||'')+'"><input type="number" placeholder="$/unit" step="0.01" style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.78rem" value="'+(cost||'')+'"><button onclick="this.parentElement.remove()" style="padding:4px 7px;border-radius:5px;border:none;cursor:pointer;font-size:.73rem;background:#fee2e2;color:#b91c1c">x</button>';
              container.appendChild(div);
        }

        function partsScanLinesData() {
              var lines=[];
              var rows=document.getElementById('scan-lines').children;
              for(var i=0;i<rows.length;i++){
                      var ins=rows[i].querySelectorAll('input');
                      if(ins[0]&&ins[0].value.trim()) lines.push({item:ins[0].value,qty:parseFloat(ins[1].value||0),cost:parseFloat(ins[2].value||0)});
              }
              return lines;
        }

        function partsSaveScanInvoice() {
              var lines=partsScanLinesData();
              var total=lines.reduce(function(s,l){return s+(l.qty*l.cost);},0);
              var data={vendor:document.getElementById('sc-vendor').value,invoice_number:document.getElementById('sc-invnum').value,date:document.getElementById('sc-date').value,line_items:lines,total:total};
              apiCall('POST','/api/parts?action=add_invoice',data).then(function(){partsShowTab('invoices');}).catch(function(){alert('Error saving invoice');});
        }

        function partsInvoiceForm(editIdx) {
              _scanLineCount=0;
              var inv=editIdx>=0?_partsData.invoices[editIdx]:{};
              var isEdit=editIdx>=0;
              document.getElementById('parts-panel').innerHTML='<div style="padding:14px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><button style="padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600;background:#f1f5f9;color:#334155" onclick="partsShowTab(\'invoices\')">Back</button><span style="font-weight:700;font-size:.95rem">'+(isEdit?'Edit':'Add')+' Invoice</span></div><label style="font-size:.75rem;color:#64748b">Vendor</label><input type="text" id="sc-vendor" style="'+INP+'" value="'+(inv.vendor||'')+'"><label style="font-size:.75rem;color:#64748b">Invoice #</label><input type="text" id="sc-invnum" style="'+INP+'" value="'+(inv.invoice_number||'')+'"><label style="font-size:.75rem;color:#64748b">Date</label><input type="date" id="sc-date" style="'+INP+'" value="'+(inv.date||'')+'"><div style="font-weight:600;font-size:.82rem;margin-bottom:6px;color:#334155">Line Items <button style="padding:3px 8px;border-radius:5px;border:none;cursor:pointer;font-size:.72rem;background:#f1f5f9;color:#334155;font-weight:600" onclick="partsAddScanLine(\'\',\'\',\'\')">+ Add Row</button></div><div id="scan-lines"></div><button style="padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600;background:#1a3a6b;color:#fff;width:100%;margin-top:8px" onclick="partsSaveInvoiceEdit('+editIdx+')">Save Invoice</button></div>';
              var lines=inv.line_items||[];
              lines.forEach(function(li){partsAddScanLine(li.item,li.qty,li.cost);});
              if(!lines.length) partsAddScanLine('','','');
        }

        function partsSaveInvoiceEdit(editIdx) {
              var lines=partsScanLinesData();
              var total=lines.reduce(function(s,l){return s+(l.qty*l.cost);},0);
              var data={vendor:document.getElementById('sc-vendor').value,invoice_number:document.getElementById('sc-invnum').value,date:document.getElementById('sc-date').value,line_items:lines,total:total};
              var action=editIdx>=0?'update_invoice':'add_invoice';
              if(editIdx>=0) data.id=_partsData.invoices[editIdx].id;
              apiCall('POST','/api/parts?action='+action,data).then(function(){partsShowTab('invoices');}).catch(function(){alert('Error');});
        }

        function partsDelInvoice(i) {
              if(!confirm('Delete this invoice?

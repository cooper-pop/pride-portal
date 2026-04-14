// parts-scan.js - Invoice scanning feature using Claude AI vision
// Loaded separately to avoid syntax conflicts with parts.js

function partsScanInvoice() {
  var overlay = document.createElement('div');
  overlay.id = 'parts-scan-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';

  var html = '<div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;move-point:0;box-shadow:0 20px 60px rgba(0,0,0,.4)">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">';
  html += '<h3 style="margin:0;font-size:1.1rem;color:#1e3a5f">&#128247; Scan Invoice</h3>';
  html += '<button onclick="document.getElementById(\'' + "parts-scan-overlay" + '\').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;line-height:1">&times;</button>';
  html += '</div>';
  html += '<p style="font-size:.85rem;color:#64748b;margin:0 0 16px">Upload a photo or scan of your invoice. Claude AI will extract all part numbers, descriptions, quantities, and pricing automatically.</p>';

  html += '<div style="display:flex;gap:10px;margin-bottom:16px">';
  // Upload button
  html += '<label style="flex:1;border:2px dashed #cbd5e1;border-radius:8px;padding:20px;text-align:center;cursor:pointer" onmouseover="this.style.borderColor=\'#1e3a5f\'" onmouseout="this.style.borderColor=\'#cbd5e1\'">';
  html += '<input type="file" accept="image/*,.pdf" id="parts-scan-file" style="display:none" onchange="partsScanPreview(this)">';
  html += '<div style="font-size:2rem">&#128193;</div>';
  html += '<div style="font-size:.8rem;font-weight:600;color:#1e3a5f;margin-top:4px">Upload File</div>';
  html += '<div style="font-size:.75rem;color:#64748b">JPG, PNG, or photo of invoice</div>';
  html += '</label>';
  // Camera button
  html += '<label style="flex:1;border:2px dashed #cbd5e1;border-radius:8px;padding:20px;text-align:center;cursor:pointer" onmouseover="this.style.borderColor=\'#1e3a5f\'" onmouseout="this.style.borderColor=\'#cbd5e1\'">';
  html += '<input type="file" accept="image/*" capture="environment" id="parts-scan-camera" style="display:none" onchange="partsScanPreview(this)">';
  html += '<div style="font-size:2rem">&#128247;</div>';
  html += '<div style="font-size:.8rem;font-weight:600;color:#1e3a5f;margin-top:4px">Take Photo</div>';
  html += '<div style="font-size:.75rem;color:#64748b">Use camera</div>';
  html += '</label>';
  html += '</div>';

  html += '<div id="parts-scan-preview" style="display:none;margin-bottom:16px;text-align:center">';
  html += '<img id="parts-scan-img" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #e2e8e0;margin-bottom:12px" />';
  html += '<div><button onclick="partsScanExtract()" style="background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:10px 24px;font-size:.9rem;cursor:pointer;font-weight:600">&#128269; Extract Invoice Data</button></div>';
  html += '</div>';

  html += '<div id="parts-scan-loading" style="display:none;text-align:center;padding:24px">';
  html += '<div id="parts-scan-spinner" style="font-size:2.5rem">&#9881;</div>';
  html += '<div style="font-size:.9rem;color:#1e3a5f;font-weight:600;margin-top:8px">Claude is reading your invoice...</div>';
  html += '<div style="font-size:.8rem;color:#64748b;margin-top:4px">Extracting part numbers, quantities, and pricing</div>';
  html += '</div>';

  html += '<div id="parts-scan-results"></div>';
  html += '</div>';

  // Spinner animation
  html += '<style>#parts-scan-spinner{animation:pspin 1s linear infinite}@keyframes pspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}</style>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);
}

function partsScanPreview(input) {
  var file = input.files[0];
  if (!file) return;
  window._partsScanFile = file;
  var reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('parts-scan-img').src = e.target.result;
    document.getElementById('parts-scan-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function partsScanExtract() {
  var file = window._partsScanFile;
  if (!file) return;

  document.getElementById('parts-scan-preview').style.display = 'none';
  document.getElementById('parts-scan-loading').style.display = 'block';

  try {
    // Convert file to base64
    var base64 = await new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) { resolve(e.target.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    var mediaType = file.type || 'image/jpeg';

    var result = await apiCall('POST', '/api/parts?action=extract_invoice', {
      image_base64: base64,
      media_type: mediaType
    });

    document.getElementById('parts-scan-loading').style.display = 'none';
    partsScanShowResults(result);

  } catch	err) {
    document.getElementById('parts-scan-loading').style.display = 'none';
    document.getElementById('parts-scan-results').innerHTML =
      '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;color:#dc2626">' +
      '&#10600; Error: ' + (err.message || 'Failed to extract invoice data. Please try again.') +
      '</div>';
  }
}

function partsScanShowResults(data) {
  var resultsEl = document.getElementById('parts-scan-results');
  var items = data.line_items || [];

  var html = '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px">';
  html += '<div style="font-weight:700;color:#166534;font-size:.9rem;margin-bottom:6px">&#10003; Invoice Extracted Successfully</div>';
  html += '<div style="font-size:.8rem;color:#166534;display:grid;grid-template-columns:1fr 1fr;gap:4px">';
  html += '<span><strong>Vendor:</strong> ' + (data.vendor || '&mdash;') + '</span>';
  html += '<span><strong>Invoice #:</strong> ' + (data.invoice_number || '&mdash;') + '</span>';
  html += '<span><strong>Date:</strong> ' + (data.invoice_date || '&mdash;') + '</span>';
  html += '<span><strong>Total:</strong> ' + (data.total_amount ? '$' + Number(data.total_amount).toFixed(2) : '&mdash;') + '</span>';
  html += '</div></div>';

  if (items.length > 0) {
    html += '<div style="font-weight:600;font-size:.85rem;color:#1e3a5f;margin-bottom:8px">';
    html += 'Line Items Found (' + items.length + ') &mdash; Select items to add to inventory:';
    html += '</div>';
    html += '<div style="overflow-x:auto;margin-bottom:12px">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:.78rem">';
    html += '<thead><tr style="background:#f1f5f9;border-bottom:2px solid #e2e8e0">';
    html += '<th style="padding:6px 4px;text-align:left;width:28px"><input type="checkbox" id="scan-check-all" onchange="partsScanToggleAll(this.checked)" checked></th>';
    html += '<th style="padding:6px 4px;text-align:left">Part #</th>';
    html += '<th style="padding:6px 4px;text-align:left">Description</th>';
    html += '<th style="padding:6px 4px;text-align:left">Mfr</th>';
    html += '<th style="padding:6px 4px;text-align:right">Qty</th>';
    html += '<th style="padding:6px 4px;text-align:right">Unit $</th>';
    html += '</tr></thead><tbody id="scan-items-body">';

    items.forEach(function(item, idx) {
      html += '<tr style="border-bottom:1px solid #f1f5f9" id="scan-row-' + idx + '">';
      html += '<td style="padding:5px 4px"><input type="checkbox" class="scan-item-check" data-idx="' + idx + '" checked></td>';
      html += '<td style="padding:5px 4px"><input type="text" value="' + (item.part_number||'').replace(/\"/g,'&quot;') + '" data-field="part_number" data-idx="' + idx + '" style="width:90px;border:1px solid #e2e8e0;border-radius:4px;padding:2px 4px;font-size:.78rem"></td>';
      html += '<td style="padding:5px 4px"><input type="text" value="' + (item.description||'').replace(/\"/g,'&quot;') + '" data-field="description" data-idx="' + idx + '" style="width:140px;border:1px solid #e2e8e0;border-radius:4px;padding:2px 4px;font-size:.78rem"></td>';
      html += '<td style="padding:5px 4px"><input type="text" value="' + (item.manufacturer||'').replace(/\"/g,'&quot;') + '" data-field="manufacturer" data-idx="' + idx + '" style="width:65px;border:1px solid #e2e8e0;border-radius:4px;padding:2px 4px;font-size:.78rem"></td>';
      html += '<td style="padding:5px 4px;text-align:right"><input type="number" value="' + (item.quantity||1) + '" data-field="quantity" data-idx="' + idx + '" style="width:48px;border:1px solid #e2e8e0;border-radius:4px;padding:2px 4px;font-size:.78rem;text-align:right"></td>';
      html += '<td style="padding:5px 4px;text-align:right"><input type="number" step="0.01" value="' + (item.unit_cost||0) + '" data-field="unit_cost" data-idx="' + idx + '" style="width:62px;border:1px solid #e2e8e0;border-radius:4px;padding:2px 4px;font-size:.78rem;text-align:right"></td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button onclick="partsScanSaveInvoice()" style="background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:9px 16px;font-size:.82rem;cursor:pointer;font-weight:600">&#128190; Save Invoice</button>';
    html += '<button onclick="partsScanAddToInventory()" style="background:#0f7d3e;color:#fff;border:none;border-radius:6px;padding:9px 16px;font-size:.82rem;cursor:pointer;font-weight:600">&#128230; Add to Inventory</button>';
    html += '<button onclick="partsScanBoth()" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:9px 16px;font-size:.82rem;cursor:pointer;font-weight:600">&#10003; Save + Add to Inventory</button>';
    html += '</div>';
  } else {
    html += '<div style="color:#64748b;font-size:.85rem;padding:12px;text-align:center">No line items found in this image. Try a clearer photo.</div>';
  }

  window._partsScanData = data;
  window._partsScanItems = items;
  resultsEl.innerHTML = html;
}

function partsScanToggleAll(checked) {
  document.querySelectorAll('.scan-item-check').forEach(function(cb) { cb.checked = checked; });
}

function partsScanGetSelectedItems() {
  var items = window._partsScanItems || [];
  var selected = [];
  document.querySelectorAll('.scan-item-check').forEach(function(cb) {
    if (!cb.checked) return;
    var idx = parseInt(cb.dataset.idx);
    var row = document.getElementById('scan-row-' + idx);
    var item = Object.assign({}, items[idx]);
    row.querySelectorAll('input[data-field]').forEach(function(inp) {
      var field = inp.dataset.field;
      item[field] = (field === 'quantity' || field === 'unit_cost') ? parseFloat(inp.value) || 0 : inp.value;
    });
    selected.push(item);
  });
  return selected;
}

async function partsScanAddToInventory() {
  var selected = partsScanGetSelectedItems();
  if (selected.length === 0) { alert('No items selected'); return; }

  var added = 0, updated = 0;
  try {
    var existing = await apiCall('GET', '/api/parts?action=get_parts');
    for (var i = 0; i < selected.length; i++) {
      var item = selected[i];
      if (!item.part_number && !item.description) continue;
      var match = existing.find(function(p) {
        return p.part_number && item.part_number &&
          p.part_number.toLowerCase() === item.part_number.toLowerCase();
      });
      if (match) {
        await apiCall('POST', '/api/parts?action=update_part', {
          id: match.id, field: 'quantity',
          value: (parseInt(match.quantity) || 0) + (parseInt(item.quantity) || 1)
        });
        updated++;
      } else {
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
    }
    alert('Done! ' + added + ' part(s) added to inventory' + (updated ? ', ' + updated + ' quantity updated.' : '.'));
    document.getElementById('parts-scan-overlay').remove();
    if (typeof partsShowTab === 'function') partsShowTab('inventory');
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

as function partsScanSaveInvoice() {
  var data = window._partsScanData || {};
  var items = partsScanGetSelectedItems();
  try {
    await apiCall('POST', '/api/parts?action=save_invoice', {
      vendor: data.vendor || '',
      invoice_number: data.invoice_number || '',
      invoice_date: data.invoice_date || null,
      total_amount: data.total_amount || 0,
      notes: 'Scanned invoice',
      items: items
    });
    alert('Invoice saved!');
    if (typeof partsShowTab === 'function') partsShowTab('invoices');
  } catch(e) { alert('Error saving invoice: ' + e.message); }
}

as function partsScanBoth() {
  await partsScanSaveInvoice();
  await partsScanAddToInventory();
}
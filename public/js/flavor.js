// flavor.js - Flavor Sample Tracker Widget
function buildFlavorWidget() {
  // Initialize with current month/year
  const now = new Date();
  window.flavorCurrentMonth = now.getMonth() + 1;
  window.flavorCurrentYear = now.getFullYear();
  
  const tabs = [
    { id: 'calendar', label: '📅 Sample Calendar', active: true },
    { id: 'manage', label: '🎣 Manage Ponds', active: false },
    { id: 'bulk', label: '⚡ Bulk Actions', active: false }
  ];
  
  // Only show manage tab for admin
  const filteredTabs = currentUser.role === 'admin' ? tabs : tabs.filter(t => t.id !== 'manage');
  
  const tabsHtml = filteredTabs.map(t =>
    `<button class="widget-tab${t.active ? ' active' : ''}" onclick="flavorShowTab('${t.id}')">${t.label}</button>`
  ).join('');
  
  document.getElementById('widget-tabs').innerHTML = tabsHtml;
  
  const content = `
    <div class="flavor-container">
      <!-- Calendar Tab -->
      <div id="flavor-tab-calendar" class="tab-panel active">
        <div class="flavor-controls">
          <div class="flavor-nav">
            <button onclick="flavorChangeMonth(-1)" class="nav-btn">‹</button>
            <h3 id="flavor-month-title">${getMonthName(window.flavorCurrentMonth)} ${window.flavorCurrentYear}</h3>
            <button onclick="flavorChangeMonth(1)" class="nav-btn">›</button>
          </div>
          <div class="flavor-filters">
            <select id="flavor-producer-filter" onchange="flavorLoadFarmerTracking()">
              <option value="">All Producers</option>
            </select>
            <select id="flavor-result-filter" onchange="flavorLoadFarmerTracking()">
              <option value="">All Results</option>
              <option value="good_for_resample">Good for Resample</option>
              <option value="good">Good</option>
              <option value="off_1">Off 1</option>
              <option value="off_2">Off 2</option>
              <option value="off_3">Off 3</option>
              <option value="off_4">Off 4</option>
              <option value="off_5">Off 5</option>
              <option value="truck_pass">Truck Sample Pass</option>
              <option value="truck_fail">Truck Sample Fail</option>
            </select>
            <button onclick="flavorAddSampleModal()" class="btn-primary">+ Add Sample</button>
          </div>
        </div>
        <div id="flavor-tracking" class="farmer-tracking">
          <div class="tracking-loading">Loading farmer tracking data...</div>
        </div>
        <div class="flavor-legend">
          <div class="legend-section">
            <h4>Sample Results</h4>
            <span><div class="legend-dot good-resample"></div>Good for Resample</span>
            <span><div class="legend-dot good"></div>Good</span>
            <span><div class="legend-dot off-flavor"></div>Off 1-5</span>
          </div>
          <div class="legend-section">
            <h4>Truck Samples</h4>
            <span><div class="legend-dot truck-pass"></div>Truck Pass</span>
            <span><div class="legend-dot truck-fail"></div>Truck Fail</span>
          </div>
          <div class="legend-section">
            <h4>Workflow Status</h4>
            <span><div class="legend-dot pending"></div>Pending</span>
            <span><div class="legend-dot teresa"></div>Teresa Review</span>
            <span><div class="legend-dot completed"></div>Complete</span>
          </div>
        </div>
      </div>
      
      <!-- Manage Ponds Tab (Admin Only) -->
      ${currentUser.role === 'admin' ? `
      <div id="flavor-tab-manage" class="tab-panel">
        <div class="manage-controls">
          <button onclick="flavorShowAddPond()" class="btn-primary">+ Add Producer/Pond</button>
          <button onclick="flavorSeedData()" class="btn-secondary">🌱 Initialize Data</button>
        </div>
        <div id="flavor-producers-list">
          <div class="loading">Loading producers...</div>
        </div>
      </div>
      ` : ''}
      
      <!-- Bulk Actions Tab -->
      <div id="flavor-tab-bulk" class="tab-panel">
        <div class="bulk-controls">
          <h4>Quick Actions for ${getMonthName(window.flavorCurrentMonth)} ${window.flavorCurrentYear}</h4>
          <div class="bulk-grid">
            <button onclick="flavorBulkSample()" class="bulk-btn sample">📝 Mark Pond Samples Complete</button>
            <button onclick="flavorBulkTruck()" class="bulk-btn truck">🚛 Mark Truck Samples Complete</button>
            <button onclick="flavorBulkTeresa()" class="bulk-btn teresa">👩‍🔬 Teresa Review Complete</button>
            <button onclick="flavorBulkLogged()" class="bulk-btn logged">📊 Mary Logging Complete</button>
          </div>
        </div>
        <div id="flavor-bulk-status" class="bulk-status"></div>
      </div>
    </div>
  `;
  
  document.getElementById('widget-content').innerHTML = content;
  
  // Load initial data
  flavorLoadProducers();
  flavorLoadFarmerTracking();
  if (currentUser.role === 'admin') {
    flavorLoadManageView();
  }
}

function flavorShowTab(tabId) {
  // Update tab buttons
  document.querySelectorAll('.widget-tab').forEach(tab => tab.classList.remove('active'));
  // Find and activate the clicked tab
  const activeTab = document.querySelector(`[onclick="flavorShowTab('${tabId}')"]`);
  if (activeTab) {
    activeTab.classList.add('active');
  }
  
  // Update tab panels
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  const targetPanel = document.getElementById(`flavor-tab-${tabId}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }
  
  // Load appropriate content for each tab
  if (tabId === 'calendar') {
    flavorLoadCalendar();
  } else if (tabId === 'manage' && currentUser.role === 'admin') {
    flavorLoadManageView();
  } else if (tabId === 'bulk') {
    flavorLoadBulkActions();
  }
}

function flavorChangeMonth(delta) {
  window.flavorCurrentMonth += delta;
  if (window.flavorCurrentMonth < 1) {
    window.flavorCurrentMonth = 12;
    window.flavorCurrentYear--;
  } else if (window.flavorCurrentMonth > 12) {
    window.flavorCurrentMonth = 1;
    window.flavorCurrentYear++;
  }
  
  document.getElementById('flavor-month-title').textContent = 
    `${getMonthName(window.flavorCurrentMonth)} ${window.flavorCurrentYear}`;
  flavorLoadFarmerTracking();
}

function flavorLoadProducers() {
  apiCall('GET', `/api/flavor?action=producers`).then(data => {
    const select = document.getElementById('flavor-producer-filter');
    if (select) {
      const options = data.map(p => 
        `<option value="${p.producer_name}">${p.producer_name} (${p.pond_count} ponds)</option>`
      ).join('');
      select.innerHTML = '<option value="">All Producers</option>' + options;
    }
  }).catch(err => console.error('Error loading producers:', err));
}

function flavorLoadBulkActions() {
  // Bulk actions tab doesn't need additional loading - it's static content
  console.log('Bulk actions tab loaded');
}

function flavorLoadFarmerTracking() {
  const producer = document.getElementById('flavor-producer-filter')?.value || '';
  const result = document.getElementById('flavor-result-filter')?.value || '';
  
  const params = new URLSearchParams({
    action: 'farmer_tracking',
    start_date: `${window.flavorCurrentYear}-${window.flavorCurrentMonth.toString().padStart(2, '0')}-01`,
    end_date: `${window.flavorCurrentYear}-${window.flavorCurrentMonth.toString().padStart(2, '0')}-31`
  });
  
  if (producer) params.append('producer', producer);
  
  apiCall('GET', `/api/flavor?${params}`).then(farmerData => {
    const trackingEl = document.getElementById('flavor-tracking');
    if (!trackingEl) return;
    
    let trackingHtml = '<div class="farmer-tracking-grid">';
    
    Object.keys(farmerData).forEach(farmerName => {
      const ponds = farmerData[farmerName];
      
      // Filter by result if specified
      const filteredPonds = result ? ponds.filter(pond => {
        if (result === 'truck_pass') return pond.truck_sample_result === 'pass';
        if (result === 'truck_fail') return pond.truck_sample_result === 'fail';
        return pond.pond_sample_result === result;
      }) : ponds;
      
      if (filteredPonds.length === 0 && result) return;
      
      trackingHtml += `
        <div class="farmer-card">
          <div class="farmer-header">
            <h3>${farmerName}</h3>
            <span class="pond-count">${filteredPonds.length} ponds</span>
          </div>
          <div class="pond-list">
      `;
      
      filteredPonds.forEach(pond => {
        const sampleDate = pond.sample_date ? new Date(pond.sample_date).toLocaleDateString() : 'No sample';
        const pondResult = pond.pond_sample_result || 'pending';
        const truckResult = pond.truck_sample_result || 'pending';
        
        // Determine status classes
        let pondStatusClass = 'pending';
        let truckStatusClass = 'pending';
        
        if (pond.pond_sample_result) {
          if (pond.pond_sample_result === 'good' || pond.pond_sample_result === 'good_for_resample') {
            pondStatusClass = 'good';
          } else if (pond.pond_sample_result.startsWith('off_')) {
            pondStatusClass = 'off';
          }
        }
        
        if (pond.truck_sample_result === 'pass') truckStatusClass = 'pass';
        if (pond.truck_sample_result === 'fail') truckStatusClass = 'fail';
        
        trackingHtml += `
          <div class="pond-item" onclick="flavorOpenPondDetails('${pond.pond_id}', '${pond.pond_name}', '${farmerName}')">
            <div class="pond-header">
              <span class="pond-name">${pond.pond_name}</span>
              <span class="sample-date">${sampleDate}</span>
            </div>
            <div class="pond-status">
              <div class="status-item">
                <span class="status-label">Pond:</span>
                <span class="status-badge ${pondStatusClass}">${formatResult(pondResult)}</span>
              </div>
              <div class="status-item">
                <span class="status-label">Truck:</span>
                <span class="status-badge ${truckStatusClass}">${formatResult(truckResult)}</span>
              </div>
              <div class="status-item">
                <span class="status-label">Teresa:</span>
                <span class="status-badge ${pond.teresa_status || 'pending'}">${formatStatus(pond.teresa_status)}</span>
              </div>
            </div>
            ${pond.notes ? `<div class="pond-notes">${pond.notes}</div>` : ''}
          </div>
        `;
      });
      
      trackingHtml += `
          </div>
        </div>
      `;
    });
    
    trackingHtml += '</div>';
    trackingEl.innerHTML = trackingHtml;
    
  }).catch(err => {
    console.error('Error loading farmer tracking:', err);
    document.getElementById('flavor-tracking').innerHTML = '<div class="error">Error loading farmer tracking data</div>';
  });
}

function formatResult(result) {
  if (!result || result === 'pending') return 'Pending';
  const resultMap = {
    'good_for_resample': 'Good for Resample',
    'good': 'Good',
    'off_1': 'Off 1',
    'off_2': 'Off 2', 
    'off_3': 'Off 3',
    'off_4': 'Off 4',
    'off_5': 'Off 5',
    'pass': 'Pass',
    'fail': 'Fail'
  };
  return resultMap[result] || result;
}

function formatStatus(status) {
  if (!status || status === 'pending') return 'Pending';
  if (status === 'completed') return 'Complete';
  return status;
}

function flavorOpenPondDetails(pondId, pondName, farmerName) {
  const modal = document.createElement('div');
  modal.className = 'flavor-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>🎣 ${farmerName} - ${pondName}</h3>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
      </div>
      <div class="modal-body">
        <div class="loading">Loading pond details...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Load pond sample history
  apiCall('GET', `/api/flavor?action=samples&pond_id=${pondId}`).then(samples => {
    const modalBody = modal.querySelector('.modal-body');
    let detailsHtml = `
      <div class="pond-details">
        <h4>Sample History</h4>
        <button onclick="flavorAddSampleForPond('${pondId}', '${pondName}', '${farmerName}')" class="btn-primary">+ Add Sample</button>
        <div class="sample-list">
    `;
    
    if (samples.length === 0) {
      detailsHtml += '<p>No samples recorded for this pond.</p>';
    } else {
      samples.forEach(sample => {
        const sampleDate = new Date(sample.sample_date).toLocaleDateString();
        detailsHtml += `
          <div class="sample-item">
            <div class="sample-date">${sampleDate}</div>
            <div class="sample-results">
              <span class="result-label">Pond Result:</span>
              <select onchange="flavorUpdateSampleResult('${sample.sample_id}', 'pond_sample_result', this.value)">
                <option value="">Select...</option>
                <option value="good_for_resample" ${sample.pond_sample_result === 'good_for_resample' ? 'selected' : ''}>Good for Resample</option>
                <option value="good" ${sample.pond_sample_result === 'good' ? 'selected' : ''}>Good</option>
                <option value="off_1" ${sample.pond_sample_result === 'off_1' ? 'selected' : ''}>Off 1</option>
                <option value="off_2" ${sample.pond_sample_result === 'off_2' ? 'selected' : ''}>Off 2</option>
                <option value="off_3" ${sample.pond_sample_result === 'off_3' ? 'selected' : ''}>Off 3</option>
                <option value="off_4" ${sample.pond_sample_result === 'off_4' ? 'selected' : ''}>Off 4</option>
                <option value="off_5" ${sample.pond_sample_result === 'off_5' ? 'selected' : ''}>Off 5</option>
              </select>
            </div>
            <div class="sample-results">
              <span class="result-label">Truck Result:</span>
              <select onchange="flavorUpdateSampleResult('${sample.sample_id}', 'truck_sample_result', this.value)">
                <option value="">Select...</option>
                <option value="pass" ${sample.truck_sample_result === 'pass' ? 'selected' : ''}>Pass</option>
                <option value="fail" ${sample.truck_sample_result === 'fail' ? 'selected' : ''}>Fail</option>
              </select>
            </div>
          </div>
        `;
      });
    }
    
    detailsHtml += '</div></div>';
    modalBody.innerHTML = detailsHtml;
  }).catch(err => {
    modal.querySelector('.modal-body').innerHTML = '<div class="error">Error loading pond details</div>';
  });
}

function flavorAddSampleModal() {
  const modal = document.createElement('div');
  modal.className = 'flavor-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>📝 Add New Sample</h3>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
      </div>
      <div class="modal-body">
        <div class="loading">Loading ponds...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Load available ponds
  apiCall('GET', `/api/flavor?action=ponds`).then(ponds => {
    const modalBody = modal.querySelector('.modal-body');
    let formHtml = `
      <form onsubmit="flavorSubmitSample(event)">
        <div class="form-group">
          <label>Select Pond:</label>
          <select name="pond_id" required>
            <option value="">Choose pond...</option>
    `;
    
    ponds.forEach(pond => {
      formHtml += `<option value="${pond.pond_id}">${pond.producer_name} - ${pond.pond_name}</option>`;
    });
    
    formHtml += `
          </select>
        </div>
        <div class="form-group">
          <label>Sample Date:</label>
          <input type="date" name="sample_date" value="${new Date().toISOString().split('T')[0]}" required>
        </div>
        <div class="form-group">
          <label>Sampled By:</label>
          <input type="text" name="sampled_by" value="${currentUser.name}" required>
        </div>
        <div class="form-group">
          <label>Notes:</label>
          <textarea name="notes" rows="3"></textarea>
        </div>
        <button type="submit" class="btn-primary">Add Sample</button>
      </form>
    `;
    
    modalBody.innerHTML = formHtml;
  }).catch(err => {
    modal.querySelector('.modal-body').innerHTML = '<div class="error">Error loading ponds</div>';
  });
}

function flavorUpdateSampleResult(sampleId, field, value) {
  apiCall('POST', '/api/flavor', {
    action: 'update_sample_result',
    sample_id: sampleId,
    field: field,
    value: value,
    updated_by: currentUser.name
  }).then(() => {
    showToast('✅ Sample result updated', 'success');
    flavorLoadFarmerTracking(); // Refresh the view
  }).catch(err => {
    showToast('❌ Error updating sample: ' + err.message, 'error');
  });
}

// Export functions
window.flavorLoadFarmerTracking = flavorLoadFarmerTracking;
window.formatResult = formatResult;
window.formatStatus = formatStatus;
window.flavorOpenPondDetails = flavorOpenPondDetails;
window.flavorAddSampleModal = flavorAddSampleModal;
window.flavorUpdateSampleResult = flavorUpdateSampleResult;

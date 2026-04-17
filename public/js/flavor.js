// flavor.js - Flavor Sample Tracker Widget

// DEPLOYMENT FIX: Force cache refresh - Apr 17 2026
function buildFlavorWidget() {
  // Initialize with current month/year
  const now = new Date();
  window.flavorCurrentMonth = now.getMonth() + 1;
  window.flavorCurrentYear = now.getFullYear();
  
  const tabs = [
    { id: 'harvest', label: '🎣 Harvest Readiness', active: true },
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
      <!-- Calendar Tab - Now Harvest Readiness Dashboard -->
      <div id="flavor-tab-calendar" class="tab-panel active">
        <div class="harvest-dashboard">
          <div class="dashboard-header">
            <h3>🎣 Harvest Readiness Dashboard</h3>
            <div class="dashboard-controls">
              <button onclick="flavorLoadHarvestReadiness()" class="btn-refresh">↻ Refresh</button>
              <button onclick="flavorAddSampleModal()" class="btn-primary">+ Add Sample</button>
            </div>
          </div>
          
          <div class="readiness-summary">
            <div class="summary-card good-to-go">
              <h4>🟢 Good to Go</h4>
              <span id="summary-good-count">-</span>
              <p>Ready for Harvest</p>
            </div>
            <div class="summary-card approaching">
              <h4>🟡 Approaching Flavor</h4>
              <span id="summary-approaching-count">-</span>
              <p>Off 1-3 (Getting Close)</p>
            </div>
            <div class="summary-card needs-attention">
              <h4>🔴 Needs Attention</h4>
              <span id="summary-alerts-count">-</span>
              <p>Expiring Soon</p>
            </div>
          </div>
          
          <div id="harvest-alerts" class="alerts-section" style="display: none;">
            <h4>⚠️ Urgent Alerts</h4>
            <div id="alerts-list"></div>
          </div>
          
          <div class="pond-sections">
            <div class="pond-section">
              <h4>🟢 Good to Go Ponds</h4>
              <div id="good-to-go-ponds" class="pond-grid">
                <div class="loading">Loading...</div>
              </div>
            </div>
            
            <div class="pond-section">
              <h4>🟡 Approaching Flavor (Off 1-3)</h4>
              <div id="approaching-ponds" class="pond-grid">
                <div class="loading">Loading...</div>
              </div>
            </div>
            
            <div class="pond-section">
              <h4>🔴 Needs Attention</h4>
              <div id="attention-ponds" class="pond-grid">
                <div class="loading">Loading...</div>
              </div>
            </div>
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
  flavorLoadHarvestReadiness();
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
    flavorLoadHarvestReadiness(); // Use the new harvest readiness function
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

function flavorLoadHarvestReadiness() {
  apiCall('GET', '/api/flavor?action=harvest_readiness').then(data => {
    // Update summary cards
    document.getElementById('summary-good-count').textContent = data.summary.good_to_go;
    document.getElementById('summary-approaching-count').textContent = data.summary.approaching_flavor;
    document.getElementById('summary-alerts-count').textContent = data.summary.needs_attention;
    
    // Show alerts if any
    if (data.alerts && data.alerts.length > 0) {
      const alertsSection = document.getElementById('harvest-alerts');
      const alertsList = document.getElementById('alerts-list');
      
      let alertsHtml = '';
      data.alerts.forEach(pond => {
        const daysLeft = 30 - pond.days_since_sample;
        alertsHtml += `
          <div class="alert-item urgent">
            <div class="alert-content">
              <strong>${pond.producer_name} - ${pond.pond_name}</strong>
              <p>⏰ ${daysLeft} days left in harvest window! Last sampled ${pond.days_since_sample} days ago.</p>
            </div>
            <button onclick="flavorScheduleHarvest('${pond.pond_id}')" class="btn-urgent">Schedule Harvest</button>
          </div>
        `;
      });
      
      alertsList.innerHTML = alertsHtml;
      alertsSection.style.display = 'block';
    } else {
      document.getElementById('harvest-alerts').style.display = 'none';
    }
    
    // Populate Good to Go ponds
    const goodToGoEl = document.getElementById('good-to-go-ponds');
    if (data.ponds.good_to_go.length === 0) {
      goodToGoEl.innerHTML = '<div class="empty-state">No ponds ready for harvest</div>';
    } else {
      let goodHtml = '';
      data.ponds.good_to_go.forEach(pond => {
        const daysLeft = 30 - pond.days_since_sample;
        const urgency = daysLeft <= 5 ? 'urgent' : daysLeft <= 10 ? 'warning' : '';
        
        goodHtml += `
          <div class="pond-card good-to-go ${urgency}" onclick="flavorOpenPondDetails('${pond.pond_id}', '${pond.pond_name}', '${pond.producer_name}')">
            <div class="pond-header">
              <h5>${pond.producer_name}</h5>
              <span class="pond-name">${pond.pond_name}</span>
            </div>
            <div class="pond-status">
              <span class="result-badge good">${formatResult(pond.pond_sample_result)}</span>
              <span class="days-indicator">${pond.days_since_sample}d ago</span>
            </div>
            <div class="pond-actions">
              <span class="harvest-window">${daysLeft} days left</span>
              <button onclick="event.stopPropagation(); flavorScheduleHarvest('${pond.pond_id}')" class="btn-harvest">Schedule Harvest</button>
            </div>
          </div>
        `;
      });
      goodToGoEl.innerHTML = goodHtml;
    }
    
    // Populate Approaching Flavor ponds
    const approachingEl = document.getElementById('approaching-ponds');
    if (data.ponds.approaching_flavor.length === 0) {
      approachingEl.innerHTML = '<div class="empty-state">No ponds approaching flavor readiness</div>';
    } else {
      let approachingHtml = '';
      data.ponds.approaching_flavor.forEach(pond => {
        const resultClass = pond.pond_sample_result.replace('_', '-');
        const closeness = {
          'off_1': 'Very Close',
          'off_2': 'Close', 
          'off_3': 'Moderate'
        };
        
        approachingHtml += `
          <div class="pond-card approaching ${resultClass}" onclick="flavorOpenPondDetails('${pond.pond_id}', '${pond.pond_name}', '${pond.producer_name}')">
            <div class="pond-header">
              <h5>${pond.producer_name}</h5>
              <span class="pond-name">${pond.pond_name}</span>
            </div>
            <div class="pond-status">
              <span class="result-badge ${resultClass}">${formatResult(pond.pond_sample_result)}</span>
              <span class="closeness-indicator">${closeness[pond.pond_sample_result]}</span>
            </div>
            <div class="pond-actions">
              <span class="days-indicator">${pond.days_since_sample}d ago</span>
              <button onclick="event.stopPropagation(); flavorAddSampleForPond('${pond.pond_id}', '${pond.pond_name}', '${pond.producer_name}')" class="btn-resample">Resample</button>
            </div>
          </div>
        `;
      });
      approachingEl.innerHTML = approachingHtml;
    }
    
    // Populate Needs Attention ponds
    const attentionEl = document.getElementById('attention-ponds');
    if (data.ponds.needs_attention.length === 0) {
      attentionEl.innerHTML = '<div class="empty-state">No ponds need immediate attention</div>';
    } else {
      let attentionHtml = '';
      data.ponds.needs_attention.forEach(pond => {
        const isExpired = pond.days_since_sample > 30;
        
        attentionHtml += `
          <div class="pond-card attention ${isExpired ? 'expired' : 'warning'}" onclick="flavorOpenPondDetails('${pond.pond_id}', '${pond.pond_name}', '${pond.producer_name}')">
            <div class="pond-header">
              <h5>${pond.producer_name}</h5>
              <span class="pond-name">${pond.pond_name}</span>
            </div>
            <div class="pond-status">
              <span class="result-badge ${pond.pond_sample_result.replace('_', '-')}">${formatResult(pond.pond_sample_result)}</span>
              <span class="status-indicator ${isExpired ? 'expired' : 'expiring'}">${isExpired ? 'Expired' : 'Expiring Soon'}</span>
            </div>
            <div class="pond-actions">
              <span class="days-indicator">${pond.days_since_sample}d ago</span>
              <button onclick="event.stopPropagation(); flavorAddSampleForPond('${pond.pond_id}', '${pond.pond_name}', '${pond.producer_name}')" class="btn-urgent">Resample Now</button>
            </div>
          </div>
        `;
      });
      attentionEl.innerHTML = attentionHtml;
    }
    
  }).catch(err => {
    console.error('Error loading harvest readiness:', err);
    document.getElementById('good-to-go-ponds').innerHTML = '<div class="error">Error loading harvest data</div>';
    document.getElementById('approaching-ponds').innerHTML = '<div class="error">Error loading harvest data</div>';
    document.getElementById('attention-ponds').innerHTML = '<div class="error">Error loading harvest data</div>';
  });
}

function flavorScheduleHarvest(pondId) {
  // This would integrate with the Fish Schedule widget
  showToast('🚛 Harvest scheduling integration coming soon', 'info');
  // TODO: Open Fish Schedule widget with pre-filled pond information
}

function flavorAddSampleForPond(pondId, pondName, producerName) {
  const modal = document.createElement('div');
  modal.className = 'flavor-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>📝 Add Sample - ${producerName}: ${pondName}</h3>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
      </div>
      <div class="modal-body">
        <form onsubmit="flavorSubmitSampleForPond(event, '${pondId}')">
          <div class="form-group">
            <label>Sample Date:</label>
            <input type="date" name="sample_date" value="${new Date().toISOString().split('T')[0]}" required>
          </div>
          <div class="form-group">
            <label>Pond Sample Result:</label>
            <select name="pond_sample_result" required>
              <option value="">Select result...</option>
              <option value="good">Good</option>
              <option value="good_for_resample">Good for Resample</option>
              <option value="off_1">Off 1 (Very Close)</option>
              <option value="off_2">Off 2 (Close)</option>
              <option value="off_3">Off 3 (Moderate)</option>
              <option value="off_4">Off 4 (Distant)</option>
              <option value="off_5">Off 5 (Very Distant)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Truck Sample Result:</label>
            <select name="truck_sample_result">
              <option value="">Not tested</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
          </div>
          <div class="form-group">
            <label>Sampled By:</label>
            <input type="text" name="sampled_by" value="${currentUser.name}" required>
          </div>
          <div class="form-group">
            <label>Notes:</label>
            <textarea name="notes" rows="3" placeholder="Sample observations..."></textarea>
          </div>
          <button type="submit" class="btn-primary">Add Sample</button>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function flavorSubmitSampleForPond(event, pondId) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  
  const sampleData = {
    action: 'create_sample',
    pond_id: pondId,
    sample_date: formData.get('sample_date'),
    pond_sample_result: formData.get('pond_sample_result'),
    truck_sample_result: formData.get('truck_sample_result') || null,
    sampled_by: formData.get('sampled_by'),
    notes: formData.get('notes')
  };
  
  apiCall('POST', '/api/flavor', sampleData).then(response => {
    showToast('✅ Sample added successfully', 'success');
    form.closest('.flavor-modal').remove();
    flavorLoadHarvestReadiness(); // Refresh the dashboard
  }).catch(err => {
    showToast('❌ Error adding sample: ' + err.message, 'error');
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

function flavorLoadManageView() {
  apiCall('GET', '/api/flavor?action=producers').then(producers => {
    const listEl = document.getElementById('flavor-producers-list');
    if (!listEl) return;
    
    let producersHtml = '<div class="producers-grid">';
    
    producers.forEach(producer => {
      producersHtml += `
        <div class="producer-card" data-producer="${producer.producer_name}">
          <div class="producer-header">
            <input type="text" value="${producer.producer_name}" onchange="flavorUpdateProducerName(this, '${producer.producer_name}')" class="producer-name-input">
            <div class="producer-actions">
              <span class="pond-count">${producer.pond_count} ponds</span>
              <button onclick="flavorAddPondToProducer('${producer.producer_name}')" class="btn-small">+ Pond</button>
              <button onclick="flavorDeleteProducer('${producer.producer_name}')" class="btn-danger-small">🗑️</button>
            </div>
          </div>
          <div class="ponds-list" id="ponds-${producer.producer_name.replace(/\s+/g, '-')}">
            <div class="loading-small">Loading ponds...</div>
          </div>
        </div>
      `;
    });
    
    producersHtml += '</div>';
    listEl.innerHTML = producersHtml;
    
    // Load ponds for each producer
    producers.forEach(producer => {
      flavorLoadProducerPonds(producer.producer_name);
    });
    
  }).catch(err => {
    console.error('Error loading producers:', err);
    document.getElementById('flavor-producers-list').innerHTML = '<div class="error">Error loading producers</div>';
  });
}

function flavorLoadProducerPonds(producerName) {
  apiCall('GET', `/api/flavor?action=ponds&producer=${encodeURIComponent(producerName)}`).then(ponds => {
    const pondsEl = document.getElementById(`ponds-${producerName.replace(/\s+/g, '-')}`);
    if (!pondsEl) return;
    
    if (ponds.length === 0) {
      pondsEl.innerHTML = '<div class="empty-ponds">No ponds yet</div>';
      return;
    }
    
    let pondsHtml = '';
    ponds.forEach(pond => {
      pondsHtml += `
        <div class="pond-item editable" data-pond-id="${pond.pond_id}">
          <input type="text" value="${pond.pond_name}" onchange="flavorUpdatePondName(this, '${pond.pond_id}')" class="pond-name-input">
          <div class="pond-actions">
            <button onclick="flavorViewPondHistory('${pond.pond_id}', '${pond.pond_name}', '${producerName}')" class="btn-small">📊 History</button>
            <button onclick="flavorDeletePond('${pond.pond_id}', '${pond.pond_name}')" class="btn-danger-small">🗑️</button>
          </div>
        </div>
      `;
    });
    
    pondsEl.innerHTML = pondsHtml;
  }).catch(err => {
    console.error('Error loading ponds for', producerName, err);
  });
}

function flavorShowAddPond() {
  const modal = document.createElement('div');
  modal.className = 'flavor-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>➕ Add Producer/Pond</h3>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
      </div>
      <div class="modal-body">
        <form onsubmit="flavorSubmitNewPond(event)">
          <div class="form-group">
            <label>Producer Name:</label>
            <input type="text" name="producer_name" placeholder="Enter producer name..." required>
            <small>Enter existing producer name to add pond, or new name to create producer</small>
          </div>
          <div class="form-group">
            <label>Pond Name:</label>
            <input type="text" name="pond_name" placeholder="Enter pond name..." required>
          </div>
          <div class="form-group">
            <label>Notes (Optional):</label>
            <textarea name="notes" rows="2" placeholder="Additional information..."></textarea>
          </div>
          <button type="submit" class="btn-primary">Add Pond</button>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
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
window.flavorLoadHarvestReadiness = flavorLoadHarvestReadiness;
window.flavorScheduleHarvest = flavorScheduleHarvest;
window.flavorAddSampleForPond = flavorAddSampleForPond;
window.flavorSubmitSampleForPond = flavorSubmitSampleForPond;
window.formatResult = formatResult;
window.formatStatus = formatStatus;
window.flavorOpenPondDetails = flavorOpenPondDetails;
window.flavorAddSampleModal = flavorAddSampleModal;
window.flavorUpdateSampleResult = flavorUpdateSampleResult;

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
            <select id="flavor-producer-filter" onchange="flavorLoadCalendar()">
              <option value="">All Producers</option>
            </select>
            <select id="flavor-status-filter" onchange="flavorLoadCalendar()">
              <option value="">All Status</option>
              <option value="pending">🟡 Pending</option>
              <option value="completed">🟢 Completed</option>
              <option value="partial">🟠 Partial</option>
            </select>
          </div>
        </div>
        <div id="flavor-calendar" class="flavor-calendar">
          <div class="calendar-loading">Loading calendar...</div>
        </div>
        <div class="flavor-legend">
          <span><div class="legend-dot completed"></div>Fully Complete</span>
          <span><div class="legend-dot partial"></div>Partial Complete</span>
          <span><div class="legend-dot pending"></div>Pending</span>
          <span><div class="legend-dot teresa"></div>Teresa Review</span>
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
  flavorLoadCalendar();
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
  flavorLoadCalendar();
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

function flavorLoadCalendar() {
  const producer = document.getElementById('flavor-producer-filter')?.value || '';
  const status = document.getElementById('flavor-status-filter')?.value || '';
  
  const params = new URLSearchParams({
    action: 'calendar',
    month: window.flavorCurrentMonth.toString(),
    year: window.flavorCurrentYear.toString()
  });
  
  if (producer) params.append('producer', producer);
  
  apiCall('GET', `/api/flavor?${params}`).then(samples => {
    const calendarEl = document.getElementById('flavor-calendar');
    if (!calendarEl) return;
    
    // Create calendar grid
    const daysInMonth = new Date(window.flavorCurrentYear, window.flavorCurrentMonth, 0).getDate();
    const firstDay = new Date(window.flavorCurrentYear, window.flavorCurrentMonth - 1, 1).getDay();
    
    let calendarHtml = '<div class="calendar-grid">';
    
    // Week headers
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    calendarHtml += weekDays.map(day => `<div class="calendar-header">${day}</div>`).join('');
    
    // Empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
      calendarHtml += '<div class="calendar-day empty"></div>';
    }
    
    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${window.flavorCurrentYear}-${window.flavorCurrentMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const daySamples = samples.filter(s => s.sample_date === dateStr);
      
      let statusClass = '';
      let statusIcon = '';
      if (daySamples.length > 0) {
        const allComplete = daySamples.every(s => 
          s.sample_status === 'completed' && 
          s.truck_status === 'completed' && 
          s.teresa_status === 'completed' && 
          s.logged_status === 'completed'
        );
        const someComplete = daySamples.some(s => 
          s.sample_status === 'completed' || 
          s.truck_status === 'completed' || 
          s.teresa_status === 'completed' || 
          s.logged_status === 'completed'
        );
        
        if (allComplete) {
          statusClass = 'completed';
          statusIcon = '✓';
        } else if (someComplete) {
          statusClass = 'partial';
          statusIcon = '◐';
        } else {
          statusClass = 'pending';
          statusIcon = '○';
        }
      }
      
      // Apply status filter
      let showDay = true;
      if (status) {
        if (status === 'completed' && statusClass !== 'completed') showDay = false;
        if (status === 'pending' && statusClass !== 'pending') showDay = false;
        if (status === 'partial' && statusClass !== 'partial') showDay = false;
      }
      
      calendarHtml += `
        <div class="calendar-day ${statusClass} ${!showDay ? 'filtered' : ''}" onclick="flavorOpenDay('${dateStr}')" ${daySamples.length > 0 ? 'data-has-samples="true"' : ''}>
          <div class="day-number">${day}</div>
          ${statusIcon ? `<div class="day-status">${statusIcon}</div>` : ''}
          ${daySamples.length > 0 ? `<div class="day-count">${daySamples.length}</div>` : ''}
        </div>
      `;
    }
    
    calendarHtml += '</div>';
    calendarEl.innerHTML = calendarHtml;
    
  }).catch(err => {
    console.error('Error loading calendar:', err);
    document.getElementById('flavor-calendar').innerHTML = '<div class="error">Error loading calendar data</div>';
  });
}

function flavorOpenDay(dateStr) {
  const modal = document.createElement('div');
  modal.className = 'flavor-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>🗓️ Samples for ${new Date(dateStr).toLocaleDateString()}</h3>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
      </div>
      <div class="modal-body">
        <div class="loading">Loading samples...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Load samples for this date
  apiCall('GET', `/api/flavor?action=samples&start_date=${dateStr}&end_date=${dateStr}`).then(samples => {
    const modalBody = modal.querySelector('.modal-body');
    
    if (samples.length === 0) {
      modalBody.innerHTML = `
        <div class="no-samples">
          <p>No samples recorded for this date.</p>
          <button onclick="flavorAddSample('${dateStr}')" class="btn-primary">+ Add Sample</button>
        </div>
      `;
      return;
    }
    
    const samplesHtml = samples.map(sample => {
      const getStatusIcon = (status) => {
        switch(status) {
          case 'completed': return '✅';
          case 'failed': return '❌';
          case 'n/a': return '➖';
          default: return '⏳';
        }
      };
      
      return `
        <div class="sample-card">
          <div class="sample-header">
            <strong>${sample.producer_name} - ${sample.pond_name}</strong>
            <div class="sample-actions">
              <button onclick="flavorEditSample('${sample.sample_id}')" class="btn-sm">Edit</button>
            </div>
          </div>
          <div class="sample-status-grid">
            <div class="status-item ${sample.sample_status}">
              <span>Pond Sample</span>
              <span>${getStatusIcon(sample.sample_status)}</span>
            </div>
            <div class="status-item ${sample.truck_status}">
              <span>Truck Sample</span>
              <span>${getStatusIcon(sample.truck_status)}</span>
            </div>
            <div class="status-item ${sample.teresa_status}">
              <span>Teresa Review</span>
              <span>${getStatusIcon(sample.teresa_status)}</span>
            </div>
            <div class="status-item ${sample.logged_status}">
              <span>Mary Logged</span>
              <span>${getStatusIcon(sample.logged_status)}</span>
            </div>
          </div>
          ${sample.notes ? `<div class="sample-notes">Notes: ${sample.notes}</div>` : ''}
        </div>
      `;
    }).join('');
    
    modalBody.innerHTML = `
      ${samplesHtml}
      <div class="modal-footer">
        <button onclick="flavorAddSample('${dateStr}')" class="btn-secondary">+ Add Another Sample</button>
      </div>
    `;
    
  }).catch(err => {
    modal.querySelector('.modal-body').innerHTML = '<div class="error">Error loading samples</div>';
  });
}

function flavorAddSample(dateStr) {
  // Load available ponds
  apiCall('GET', `/api/flavor?action=ponds`).then(ponds => {
    const modal = document.createElement('div');
    modal.className = 'flavor-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>➕ Add Sample for ${new Date(dateStr).toLocaleDateString()}</h3>
          <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <form onsubmit="flavorSubmitSample(event, '${dateStr}')">
            <div class="form-group">
              <label>Producer/Pond:</label>
              <select id="sample-pond-select" required>
                <option value="">Select pond...</option>
                ${ponds.map(p => `<option value="${p.pond_id}">${p.producer_name} - ${p.pond_name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Notes (optional):</label>
              <textarea id="sample-notes" rows="3" placeholder="Any additional notes..."></textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary">Add Sample</button>
              <button type="button" onclick="this.closest('.flavor-modal').remove()" class="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  });
}

function flavorSubmitSample(event, dateStr) {
  event.preventDefault();
  const pondId = document.getElementById('sample-pond-select').value;
  const notes = document.getElementById('sample-notes').value;
  
  apiCall('POST', '/api/flavor', {
    action: 'create_sample',
    pond_id: pondId,
    sample_date: dateStr,
    sampled_by: currentUser.username,
    notes: notes || null
  }).then(() => {
    document.querySelector('.flavor-modal').remove();
    flavorLoadCalendar();
    showToast('✅ Sample added successfully!');
  }).catch(err => {
    showToast('❌ Error adding sample: ' + err.message, 'error');
  });
}

// Bulk action functions
function flavorBulkSample() {
  flavorShowBulkDialog('sample', 'Pond Samples', '📝');
}

function flavorBulkTruck() {
  flavorShowBulkDialog('truck', 'Truck Samples', '🚛');
}

function flavorBulkTeresa() {
  flavorShowBulkDialog('teresa', 'Teresa Review', '👩‍🔬');
}

function flavorBulkLogged() {
  flavorShowBulkDialog('logged', 'Mary Logging', '📊');
}

function flavorShowBulkDialog(statusType, label, icon) {
  const dateStr = `${window.flavorCurrentYear}-${window.flavorCurrentMonth.toString().padStart(2, '0')}`;
  
  apiCall('GET', `/api/flavor?action=samples&start_date=${dateStr}-01&end_date=${dateStr}-31&status_type=${statusType}&status=pending`).then(samples => {
    if (samples.length === 0) {
      showToast(`No pending ${label.toLowerCase()} found for this month.`);
      return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'flavor-modal';
    modal.innerHTML = `
      <div class="modal-content bulk-modal">
        <div class="modal-header">
          <h3>${icon} Bulk Update: ${label}</h3>
          <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <p>Mark ${samples.length} pending ${label.toLowerCase()} as complete for ${getMonthName(window.flavorCurrentMonth)} ${window.flavorCurrentYear}?</p>
          <div class="bulk-preview">
            ${samples.slice(0, 5).map(s => `<div class="bulk-item">${s.producer_name} - ${s.pond_name} (${s.sample_date})</div>`).join('')}
            ${samples.length > 5 ? `<div class="bulk-more">...and ${samples.length - 5} more</div>` : ''}
          </div>
          <div class="form-actions">
            <button onclick="flavorExecuteBulk('${statusType}', ${JSON.stringify(samples.map(s => s.sample_id)).replace(/"/g, '&quot;')})" class="btn-primary">
              ✅ Mark ${samples.length} Complete
            </button>
            <button onclick="this.closest('.flavor-modal').remove()" class="btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  });
}

function flavorExecuteBulk(statusType, sampleIds) {
  apiCall('POST', '/api/flavor', {
    action: 'bulk_update',
    sample_ids: sampleIds,
    status_type: statusType,
    status: 'completed',
    updated_by: currentUser.username
  }).then(result => {
    document.querySelector('.flavor-modal').remove();
    flavorLoadCalendar();
    showToast(`✅ ${result.updated} ${statusType} samples updated!`);
  }).catch(err => {
    showToast('❌ Error updating samples: ' + err.message, 'error');
  });
}

// Admin pond management
function flavorLoadManageView() {
  const container = document.getElementById('flavor-producers-list');
  if (!container) return;
  
  apiCall('GET', '/api/flavor?action=producers').then(producers => {
    container.innerHTML = producers.map(producer => `
      <div class="producer-card">
        <div class="producer-header">
          <h4>${producer.producer_name}</h4>
          <span class="pond-count">${producer.pond_count} ponds</span>
        </div>
        <div class="producer-actions">
          <button onclick="flavorViewProducerPonds('${producer.producer_name}')" class="btn-sm">View Ponds</button>
        </div>
      </div>
    `).join('');
  });
}

function flavorSeedData() {
  if (!confirm('Initialize flavor sample data? This will set up all producer/pond combinations.')) return;
  
  apiCall('GET', '/api/flavor?action=seed_initial').then(result => {
    showToast('✅ ' + result.message);
    flavorLoadManageView();
    flavorLoadProducers();
  }).catch(err => {
    showToast('❌ Error initializing data: ' + err.message, 'error');
  });
}

// Utility functions
function getMonthName(month) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month - 1];
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 10000;
    padding: 12px 20px; border-radius: 8px; color: white;
    background: ${type === 'error' ? '#ef4444' : '#10b981'};
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transform: translateX(100%); transition: transform 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.style.transform = 'translateX(0)', 100);
  setTimeout(() => {
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Export functions to global scope
window.buildFlavorWidget = buildFlavorWidget;
window.flavorShowTab = flavorShowTab;
window.flavorChangeMonth = flavorChangeMonth;
window.flavorLoadCalendar = flavorLoadCalendar;
window.flavorOpenDay = flavorOpenDay;
window.flavorAddSample = flavorAddSample;
window.flavorSubmitSample = flavorSubmitSample;
window.flavorBulkSample = flavorBulkSample;
window.flavorBulkTruck = flavorBulkTruck;
window.flavorBulkTeresa = flavorBulkTeresa;
window.flavorBulkLogged = flavorBulkLogged;
window.flavorShowBulkDialog = flavorShowBulkDialog;
window.flavorExecuteBulk = flavorExecuteBulk;
window.flavorLoadManageView = flavorLoadManageView;
window.flavorSeedData = flavorSeedData;

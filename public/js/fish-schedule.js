// fish-schedule.js - Live Fish Scheduling Widget
function buildFishScheduleWidget() {
  // Initialize with current week
  const today = new Date();
  const monday = new Date(today.setDate(today.getDate() - today.getDay() + 1));
  window.fishCurrentWeek = monday.toISOString().split('T')[0];
  
  const tabs = [
    { id: 'weekly', label: '📅 Weekly Schedule', active: true },
    { id: 'vats', label: '🏭 Vat Status', active: false },
    { id: 'producers', label: '🚛 Producers', active: false },
    { id: 'coordination', label: '📞 Coordination Hub', active: false }
  ];
  
  const tabsHtml = tabs.map(t =>
    `<button class="widget-tab${t.active ? ' active' : ''}" onclick="fishShowTab('${t.id}')">${t.label}</button>`
  ).join('');
  
  document.getElementById('widget-tabs').innerHTML = tabsHtml;
  
  const content = `
    <div class="fish-container">
      <!-- Weekly Schedule Tab -->
      <div id="fish-tab-weekly" class="tab-panel active">
        <div class="fish-controls">
          <div class="fish-nav">
            <button onclick="fishChangeWeek(-1)" class="nav-btn">‹</button>
            <h3 id="fish-week-title">Week of ${formatWeekTitle(window.fishCurrentWeek)}</h3>
            <button onclick="fishChangeWeek(1)" class="nav-btn">›</button>
          </div>
          <div class="fish-actions">
            <button onclick="fishQuickSchedule()" class="btn-primary">⚡ Quick Schedule</button>
            <button onclick="fishAddDelivery()" class="btn-secondary">+ Add Delivery</button>
          </div>
        </div>
        <div id="fish-weekly-grid" class="fish-weekly-grid">
          <div class="loading">Loading weekly schedule...</div>
        </div>
      </div>
      
      <!-- Vat Status Tab -->
      <div id="fish-tab-vats" class="tab-panel">
        <div class="vats-controls">
          <button onclick="fishRefreshVats()" class="btn-secondary">🔄 Refresh Status</button>
          <button onclick="fishCapacityAnalysis()" class="btn-primary">📊 Capacity Analysis</button>
        </div>
        <div id="fish-vats-grid" class="vats-grid">
          <div class="loading">Loading vat status...</div>
        </div>
      </div>
      
      <!-- Producers Tab -->
      <div id="fish-tab-producers" class="tab-panel">
        <div class="producers-controls">
          <button onclick="fishAddProducer()" class="btn-primary">+ Add Producer</button>
          <button onclick="fishBulkImport()" class="btn-secondary">📥 Import Schedule</button>
        </div>
        <div id="fish-producers-list" class="producers-list">
          <div class="loading">Loading producers...</div>
        </div>
      </div>
      
      <!-- Coordination Hub Tab -->
      <div id="fish-tab-coordination" class="tab-panel">
        <div class="coordination-header">
          <h3>🏭 James Gaters - Coordination Hub</h3>
          <div class="coordination-date" id="fish-coordination-date"></div>
        </div>
        <div class="coordination-grid">
          <div class="coord-section">
            <h4>🚨 Today's Deliveries</h4>
            <div id="fish-today-deliveries">Loading...</div>
          </div>
          <div class="coord-section">
            <h4>⚠️ Issues & Alerts</h4>
            <div id="fish-alerts">Loading...</div>
          </div>
          <div class="coord-section">
            <h4>📞 Contact Log</h4>
            <div id="fish-contact-log">
              <div class="contact-entry">
                <input type="text" placeholder="Producer/Driver name..." id="contact-name">
                <input type="time" id="contact-time" value="${new Date().toTimeString().slice(0,5)}">
                <input type="text" placeholder="Notes..." id="contact-notes">
                <button onclick="fishLogContact()" class="btn-sm">Log</button>
              </div>
            </div>
          </div>
          <div class="coord-section">
            <h4>🎯 Vat Assignments</h4>
            <div id="fish-vat-assignments">Loading...</div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('widget-content').innerHTML = content;
  
  // Initialize coordination date
  document.getElementById('fish-coordination-date').textContent = 
    new Date().toLocaleDateString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});
  
  // Load initial data
  fishLoadWeeklySchedule();
}

function fishShowTab(tabId) {
  // Update tab buttons
  document.querySelectorAll('.widget-tab').forEach(tab => tab.classList.remove('active'));
  event.target.classList.add('active');
  
  // Update tab panels
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById(`fish-tab-${tabId}`).classList.add('active');
  
  // Load tab-specific data
  if (tabId === 'weekly') {
    fishLoadWeeklySchedule();
  } else if (tabId === 'vats') {
    fishLoadVatStatus();
  } else if (tabId === 'producers') {
    fishLoadProducers();
  } else if (tabId === 'coordination') {
    fishLoadCoordination();
  }
}

function fishChangeWeek(delta) {
  const currentWeek = new Date(window.fishCurrentWeek);
  currentWeek.setDate(currentWeek.getDate() + (delta * 7));
  window.fishCurrentWeek = currentWeek.toISOString().split('T')[0];
  
  document.getElementById('fish-week-title').textContent = 
    `Week of ${formatWeekTitle(window.fishCurrentWeek)}`;
  fishLoadWeeklySchedule();
}

function fishLoadWeeklySchedule() {
  const weekStart = window.fishCurrentWeek;
  
  apiCall('GET', `/api/fish-schedule?action=weekly_view&week_start=${weekStart}`).then(deliveries => {
    const gridEl = document.getElementById('fish-weekly-grid');
    if (!gridEl) return;
    
    // Create week grid structure
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weekDates = [];
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      weekDates.push(date.toISOString().split('T')[0]);
    }
    
    let gridHtml = '<div class="week-header">';
    days.forEach((day, index) => {
      const date = new Date(weekDates[index]);
      gridHtml += `
        <div class="day-header">
          <div class="day-name">${day}</div>
          <div class="day-date">${date.getMonth() + 1}/${date.getDate()}</div>
        </div>
      `;
    });
    gridHtml += '</div>';
    
    gridHtml += '<div class="week-content">';
    weekDates.forEach((dateStr, dayIndex) => {
      const dayDeliveries = deliveries.filter(d => d.delivery_date === dateStr);
      const totalLbs = dayDeliveries.reduce((sum, d) => sum + (d.estimated_lbs || 0), 0);
      
      gridHtml += `
        <div class="day-column" data-date="${dateStr}">
          <div class="day-summary">
            <span class="delivery-count">${dayDeliveries.length} deliveries</span>
            <span class="total-weight">${totalLbs.toLocaleString()} lbs</span>
          </div>
          ${dayDeliveries.map(delivery => `
            <div class="delivery-card ${delivery.delivery_status}" onclick="fishEditDelivery('${delivery.delivery_id}')">
              <div class="delivery-producer">${delivery.producer_name}</div>
              <div class="delivery-details">
                <span class="delivery-time">${delivery.scheduled_time || '—'}</span>
                <span class="delivery-weight">${(delivery.estimated_lbs || 0).toLocaleString()} lbs</span>
                <span class="delivery-vat">Vat ${delivery.vat_number || '?'}</span>
              </div>
              <div class="delivery-status-badge ${delivery.delivery_status}">${getStatusLabel(delivery.delivery_status)}</div>
            </div>
          `).join('')}
          <button class="add-delivery-btn" onclick="fishAddDelivery('${dateStr}')">+ Add</button>
        </div>
      `;
    });
    gridHtml += '</div>';
    
    gridEl.innerHTML = gridHtml;
    
  }).catch(err => {
    console.error('Error loading weekly schedule:', err);
    document.getElementById('fish-weekly-grid').innerHTML = '<div class="error">Error loading schedule</div>';
  });
}

function fishLoadVatStatus() {
  apiCall('GET', '/api/fish-schedule?action=vats').then(vats => {
    const gridEl = document.getElementById('fish-vats-grid');
    if (!gridEl) return;
    
    const vatsHtml = vats.map(vat => {
      const utilizationPercent = (vat.current_load_lbs / vat.capacity_lbs) * 100;
      const statusColor = getVatStatusColor(vat.status);
      
      return `
        <div class="vat-card ${vat.status}" onclick="fishEditVat(${vat.vat_number})">
          <div class="vat-header">
            <span class="vat-number">Vat ${vat.vat_number}</span>
            <span class="vat-status" style="color: ${statusColor}">${vat.status.toUpperCase()}</span>
          </div>
          <div class="vat-capacity">
            <div class="capacity-bar">
              <div class="capacity-fill" style="width: ${utilizationPercent}%"></div>
            </div>
            <div class="capacity-text">
              ${(vat.current_load_lbs / 1000).toFixed(1)}k / ${(vat.capacity_lbs / 1000).toFixed(0)}k lbs
            </div>
          </div>
          <div class="vat-metrics">
            ${vat.temperature ? `<span>🌡️ ${vat.temperature}°F</span>` : ''}
            ${vat.oxygen_level ? `<span>💨 ${vat.oxygen_level}%</span>` : ''}
            <span>📅 ${vat.scheduled_deliveries} scheduled</span>
          </div>
          ${vat.notes ? `<div class="vat-notes">${vat.notes}</div>` : ''}
        </div>
      `;
    }).join('');
    
    gridEl.innerHTML = vatsHtml;
  }).catch(err => {
    console.error('Error loading vats:', err);
    document.getElementById('fish-vats-grid').innerHTML = '<div class="error">Error loading vat status</div>';
  });
}

function fishLoadProducers() {
  apiCall('GET', '/api/fish-schedule?action=producers').then(producers => {
    const listEl = document.getElementById('fish-producers-list');
    if (!listEl) return;
    
    const producersHtml = producers.map(producer => `
      <div class="producer-card">
        <div class="producer-header">
          <h4>${producer.producer_name}</h4>
          <div class="producer-rating">
            ${getStarRating(producer.quality_rating || 3)}
          </div>
        </div>
        <div class="producer-details">
          <div class="producer-contact">
            <strong>Contact:</strong> ${producer.contact_person || 'TBD'}
            ${producer.phone ? `<br><strong>Phone:</strong> ${producer.phone}` : ''}
          </div>
          <div class="producer-schedule">
            <strong>Delivery Days:</strong> ${(producer.delivery_days || []).join(', ')}
          </div>
          <div class="producer-stats">
            <span><strong>Typical Load:</strong> ${(producer.typical_load_size || 0).toLocaleString()} lbs</span>
            <span><strong>Total Deliveries:</strong> ${producer.total_deliveries || 0}</span>
            ${producer.avg_delivery_size ? `<span><strong>Avg Size:</strong> ${(producer.avg_delivery_size || 0).toLocaleString()} lbs</span>` : ''}
          </div>
        </div>
        <div class="producer-actions">
          <button onclick="fishScheduleProducer('${producer.producer_id}')" class="btn-sm">📅 Schedule</button>
          <button onclick="fishEditProducer('${producer.producer_id}')" class="btn-sm">✏️ Edit</button>
        </div>
      </div>
    `).join('');
    
    listEl.innerHTML = producersHtml;
  }).catch(err => {
    console.error('Error loading producers:', err);
    document.getElementById('fish-producers-list').innerHTML = '<div class="error">Error loading producers</div>';
  });
}

function fishLoadCoordination() {
  const today = new Date().toISOString().split('T')[0];
  
  // Load today's deliveries
  apiCall('GET', `/api/fish-schedule?action=schedule&start_date=${today}&end_date=${today}`).then(deliveries => {
    const todayEl = document.getElementById('fish-today-deliveries');
    if (!todayEl) return;
    
    if (deliveries.length === 0) {
      todayEl.innerHTML = '<div class="no-deliveries">No deliveries scheduled for today</div>';
      return;
    }
    
    const deliveriesHtml = deliveries.map(delivery => `
      <div class="coord-delivery ${delivery.delivery_status}">
        <div class="coord-delivery-header">
          <span class="coord-producer">${delivery.producer_name}</span>
          <span class="coord-time">${delivery.scheduled_time || 'TBD'}</span>
          <span class="coord-status ${delivery.delivery_status}">${getStatusLabel(delivery.delivery_status)}</span>
        </div>
        <div class="coord-delivery-details">
          Vat ${delivery.vat_number || '?'} • ${(delivery.estimated_lbs || 0).toLocaleString()} lbs
          ${delivery.truck_driver ? ` • Driver: ${delivery.truck_driver}` : ''}
        </div>
        <div class="coord-actions">
          <button onclick="fishUpdateStatus('${delivery.delivery_id}', 'en_route')" class="status-btn">🚛 En Route</button>
          <button onclick="fishUpdateStatus('${delivery.delivery_id}', 'arrived')" class="status-btn">📍 Arrived</button>
          <button onclick="fishUpdateStatus('${delivery.delivery_id}', 'completed')" class="status-btn">✅ Complete</button>
        </div>
      </div>
    `).join('');
    
    todayEl.innerHTML = deliveriesHtml;
  });
  
  // Load alerts and vat assignments
  fishLoadAlerts();
  fishLoadVatAssignments();
}

// Quick scheduling functions
function fishQuickSchedule() {
  const modal = document.createElement('div');
  modal.className = 'fish-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>⚡ Quick Schedule Setup</h3>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
      </div>
      <div class="modal-body">
        <div class="quick-schedule-options">
          <button onclick="fishApplyTemplate('standard_week')" class="template-btn">
            📋 Standard Week Template
            <small>Apply usual weekly pattern</small>
          </button>
          <button onclick="fishCopyPreviousWeek()" class="template-btn">
            📅 Copy Previous Week
            <small>Duplicate last week's schedule</small>
          </button>
          <button onclick="fishBulkScheduleProducers()" class="template-btn">
            🚛 Bulk Schedule Producers
            <small>Schedule multiple producers at once</small>
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function fishAddDelivery(targetDate = null) {
  apiCall('GET', '/api/fish-schedule?action=producers').then(producers => {
    const modal = document.createElement('div');
    modal.className = 'fish-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>🚛 Schedule Delivery</h3>
          <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <form onsubmit="fishSubmitDelivery(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Producer:</label>
                <select id="delivery-producer" required>
                  <option value="">Select producer...</option>
                  ${producers.map(p => `<option value="${p.producer_id}">${p.producer_name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Date:</label>
                <input type="date" id="delivery-date" value="${targetDate || ''}" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Time:</label>
                <input type="time" id="delivery-time">
              </div>
              <div class="form-group">
                <label>Estimated Weight (lbs):</label>
                <input type="number" id="delivery-weight" step="100" min="0" placeholder="e.g., 25000">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Vat Number:</label>
                <select id="delivery-vat">
                  <option value="">Auto-assign...</option>
                  ${Array.from({length: 16}, (_, i) => `<option value="${i + 1}">Vat ${i + 1}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Driver:</label>
                <input type="text" id="delivery-driver" placeholder="Driver name...">
              </div>
            </div>
            <div class="form-group">
              <label>Coordinated by:</label>
              <input type="text" id="delivery-coordinator" value="James Gaters">
            </div>
            <div class="form-group">
              <label>Notes:</label>
              <textarea id="delivery-notes" rows="2" placeholder="Additional notes..."></textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary">Schedule Delivery</button>
              <button type="button" onclick="this.closest('.fish-modal').remove()" class="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  });
}

function fishSubmitDelivery(event) {
  event.preventDefault();
  
  const formData = {
    action: 'create_delivery',
    producer_id: document.getElementById('delivery-producer').value,
    delivery_date: document.getElementById('delivery-date').value,
    scheduled_time: document.getElementById('delivery-time').value || null,
    estimated_lbs: document.getElementById('delivery-weight').value || 0,
    vat_number: document.getElementById('delivery-vat').value || null,
    truck_driver: document.getElementById('delivery-driver').value || null,
    coordinated_by: document.getElementById('delivery-coordinator').value,
    notes: document.getElementById('delivery-notes').value || null
  };
  
  apiCall('POST', '/api/fish-schedule', formData).then(() => {
    document.querySelector('.fish-modal').remove();
    fishLoadWeeklySchedule();
    showToast('✅ Delivery scheduled successfully!');
  }).catch(err => {
    showToast('❌ Error scheduling delivery: ' + err.message, 'error');
  });
}

// Status and capacity functions
function fishUpdateStatus(deliveryId, newStatus) {
  const updateData = {
    action: 'update_delivery_status',
    delivery_id: deliveryId,
    status: newStatus
  };
  
  if (newStatus === 'arrived') {
    updateData.actual_arrival_time = new Date().toISOString();
  }
  
  apiCall('POST', '/api/fish-schedule', updateData).then(() => {
    fishLoadCoordination();
    fishLoadWeeklySchedule();
    showToast(`✅ Status updated to ${getStatusLabel(newStatus)}!`);
  }).catch(err => {
    showToast('❌ Error updating status: ' + err.message, 'error');
  });
}

function fishCapacityAnalysis() {
  const today = new Date().toISOString().split('T')[0];
  
  apiCall('GET', `/api/fish-schedule?action=capacity_analysis&target_date=${today}`).then(analysis => {
    const modal = document.createElement('div');
    modal.className = 'fish-modal';
    modal.innerHTML = `
      <div class="modal-content capacity-modal">
        <div class="modal-header">
          <h3>📊 Capacity Analysis - ${new Date().toLocaleDateString()}</h3>
          <button onclick="this.parentElement.parentElement.parentElement.remove()" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <div class="capacity-grid">
            ${analysis.map(vat => {
              const utilizationPercent = (vat.current_load_lbs / vat.capacity_lbs) * 100;
              const availablePercent = (vat.available_capacity / vat.capacity_lbs) * 100;
              
              return `
                <div class="capacity-vat ${vat.status}">
                  <div class="capacity-vat-header">
                    <span>Vat ${vat.vat_number}</span>
                    <span class="vat-status ${vat.status}">${vat.status}</span>
                  </div>
                  <div class="capacity-bars">
                    <div class="capacity-bar">
                      <div class="bar-segment current" style="width: ${utilizationPercent}%"></div>
                      <div class="bar-segment scheduled" style="width: ${(vat.scheduled_lbs / vat.capacity_lbs) * 100}%"></div>
                    </div>
                  </div>
                  <div class="capacity-details">
                    <div>Current: ${(vat.current_load_lbs / 1000).toFixed(1)}k lbs</div>
                    <div>Scheduled: ${(vat.scheduled_lbs / 1000).toFixed(1)}k lbs</div>
                    <div>Available: ${(vat.available_capacity / 1000).toFixed(1)}k lbs</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <div class="capacity-legend">
            <span><div class="legend-bar current"></div>Current Load</span>
            <span><div class="legend-bar scheduled"></div>Scheduled Today</span>
            <span><div class="legend-bar available"></div>Available Capacity</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  });
}

// Initialize data function
function fishInitializeData() {
  apiCall('GET', '/api/fish-schedule?action=seed_initial').then(result => {
    showToast('✅ ' + result.message);
    fishLoadWeeklySchedule();
    fishLoadVatStatus();
    fishLoadProducers();
  }).catch(err => {
    showToast('❌ Error initializing data: ' + err.message, 'error');
  });
}

// Utility functions
function formatWeekTitle(weekStart) {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  
  return `${start.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})} - ${end.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}`;
}

function getStatusLabel(status) {
  const labels = {
    scheduled: 'Scheduled',
    en_route: 'En Route',
    arrived: 'Arrived',
    unloading: 'Unloading',
    completed: 'Complete',
    cancelled: 'Cancelled'
  };
  return labels[status] || status;
}

function getVatStatusColor(status) {
  const colors = {
    available: '#22c55e',
    loading: '#f59e0b',
    processing: '#3b82f6',
    cleaning: '#8b5cf6',
    maintenance: '#ef4444'
  };
  return colors[status] || '#64748b';
}

function getStarRating(rating) {
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  return `<span class="star-rating">${stars}</span>`;
}

function fishLoadAlerts() {
  // Placeholder for alerts functionality
  document.getElementById('fish-alerts').innerHTML = `
    <div class="alert-item warning">
      <span class="alert-icon">⚠️</span>
      <span class="alert-text">Vat 3 needs cleaning after current batch</span>
    </div>
    <div class="alert-item info">
      <span class="alert-icon">ℹ️</span>
      <span class="alert-text">Weather delay possible for Friday deliveries</span>
    </div>
  `;
}

function fishLoadVatAssignments() {
  // Placeholder for vat assignments
  document.getElementById('fish-vat-assignments').innerHTML = `
    <div class="vat-assignment">
      <span class="vat-number">Vat 1-4:</span>
      <span class="assignment">Battle Fish North (50t)</span>
    </div>
    <div class="vat-assignment">
      <span class="vat-number">Vat 5-8:</span>
      <span class="assignment">External Producers</span>
    </div>
    <div class="vat-assignment">
      <span class="vat-number">Vat 9-12:</span>
      <span class="assignment">Available</span>
    </div>
  `;
}

function fishLogContact() {
  const name = document.getElementById('contact-name').value;
  const time = document.getElementById('contact-time').value;
  const notes = document.getElementById('contact-notes').value;
  
  if (!name || !notes) {
    showToast('Please fill in name and notes', 'error');
    return;
  }
  
  const logEntry = document.createElement('div');
  logEntry.className = 'contact-logged';
  logEntry.innerHTML = `
    <div class="contact-logged-header">
      <span class="contact-logged-name">${name}</span>
      <span class="contact-logged-time">${time}</span>
    </div>
    <div class="contact-logged-notes">${notes}</div>
  `;
  
  document.getElementById('fish-contact-log').appendChild(logEntry);
  
  // Clear form
  document.getElementById('contact-name').value = '';
  document.getElementById('contact-notes').value = '';
  document.getElementById('contact-time').value = new Date().toTimeString().slice(0,5);
  
  showToast('✅ Contact logged successfully!');
}

// Export functions to global scope
window.buildFishScheduleWidget = buildFishScheduleWidget;
window.fishShowTab = fishShowTab;
window.fishChangeWeek = fishChangeWeek;
window.fishLoadWeeklySchedule = fishLoadWeeklySchedule;
window.fishLoadVatStatus = fishLoadVatStatus;
window.fishLoadProducers = fishLoadProducers;
window.fishLoadCoordination = fishLoadCoordination;
window.fishQuickSchedule = fishQuickSchedule;
window.fishAddDelivery = fishAddDelivery;
window.fishSubmitDelivery = fishSubmitDelivery;
window.fishUpdateStatus = fishUpdateStatus;
window.fishCapacityAnalysis = fishCapacityAnalysis;
window.fishInitializeData = fishInitializeData;
window.fishLogContact = fishLogContact;

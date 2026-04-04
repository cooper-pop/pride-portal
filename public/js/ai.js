// ai.js - AI Analysis

async function buildAIWidget() {
  aiHistory = [];
  document.getElementById('widget-tabs').innerHTML = '';
  document.getElementById('ai-input-area').style.display = 'block';
  document.getElementById('widget-content').innerHTML =
    '<div class="wcard" style="margin-bottom:8px"><div style="font-size:0.85rem;font-weight:700;color:var(--purple);margin-bottom:8px">🤖 Ask anything about your data</div>' +
    '<div class="ai-quick">'+
    ['Who are the top trimmers this week?','Show weekly employee rankings','Who is underperforming and why?','Injection pickup trend last 30 days','Compare AM vs PM shift yield','Generate monthly summary'].map(function(q){
      return '<button class="ai-quick-btn" onclick="aiAsk(\''+q+'\')">'+q+'</button>';
    }).join('')+'</div></div>' +
    '<div class="ai-chat" id="ai-chat"></div>';
}

function aiAsk(q) {
  document.getElementById('ai-input').value = q;
  aiSend();
}

async function aiSend() {
  var input = document.getElementById('ai-input');
  var q = input.value.trim();
  if (!q) return;
  input.value = '';
  var btn = document.getElementById('ai-send-btn');
  btn.disabled = true; btn.textContent = '...';
  var chat = document.getElementById('ai-chat');
  if (!chat) return;
  chat.innerHTML += '<div class="ai-msg user">'+q+'</div>';
  chat.innerHTML += '<div class="ai-msg assistant" id="ai-thinking">⏳ Analyzing your data...</div>';
  chat.scrollTop = chat.scrollHeight;
  try {
    var data = await apiCall('POST','/api/ai',{ query: q });
    var thinkEl = document.getElementById('ai-thinking');
    if (thinkEl) thinkEl.textContent = data.response;
    else chat.innerHTML += '<div class="ai-msg assistant">'+data.response+'</div>';
  } catch(e) {
    var thinkEl2 = document.getElementById('ai-thinking');
    if (thinkEl2) thinkEl2.textContent = '⚠️ Error: '+e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Send';
    chat.scrollTop = chat.scrollHeight;
  }
}
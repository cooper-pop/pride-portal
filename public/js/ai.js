// ai.js - AI Analysis widget
function mdToHtml(t){
  if(!t)return '';
  // Tables: convert | col | col | rows into <table>
  var lines=t.split('\n');
  var out=[],inTable=false;
  lines.forEach(function(line){
    var stripped=line.trim();
    // Table row
    if(stripped.startsWith('|')&&stripped.endsWith('|')){
      if(/^\|[-\s|]+\|$/.test(stripped)){return;}// separator row
      if(!inTable){out.push('<table style="border-collapse:collapse;width:100%;font-size:.78rem;margin:8px 0">');inTable=true;}
      var cells=stripped.slice(1,-1).split('|');
      var isHeader=out[out.length-1].includes('<table');
      var tag=isHeader?'th':'td';
      var row='<tr>';
      cells.forEach(function(c){
        c=c.trim().replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
        row+='<'+tag+' style="border:1px solid #e2e8f0;padding:4px 7px;text-align:left">'+c+'</'+tag+'>';
      });
      row+='</tr>';
      out.push(row);
    } else {
      if(inTable){out.push('</table>');inTable=false;}
      // H1/H2/H3
      if(stripped.startsWith('### ')){
        out.push('<h4 style="margin:10px 0 4px;color:#1a3a6b;font-size:.83rem">'+stripped.slice(4)+'</h4>');
      } else if(stripped.startsWith('## ')){
        out.push('<h3 style="margin:12px 0 5px;color:#1a3a6b;font-size:.9rem">'+stripped.slice(3)+'</h3>');
      } else if(stripped.startsWith('# ')){
        out.push('<h2 style="margin:12px 0 6px;color:#1a3a6b;font-size:1rem">'+stripped.slice(2)+'</h2>');
      } else if(stripped==='---'||stripped==='***'){
        out.push('<hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0">');
      } else if(/^\d+\.\s/.test(stripped)){
        var content=stripped.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
        out.push('<div style="margin:5px 0 5px 12px;line-height:1.6">'+content+'</div>');
      } else if(/^[\-\*]\s/.test(stripped)){
        var content2=stripped.slice(2).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
        out.push('<div style="margin:4px 0 4px 16px;line-height:1.6">&bull; '+content2+'</div>');
      } else if(stripped===''){
        out.push('<div style="margin:5px 0"></div>');
      } else {
        var content3=stripped.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
        out.push('<div style="line-height:1.65;margin:2px 0">'+content3+'</div>');
      }
    }
  });
  if(inTable)out.push('</table>');
  return out.join('');
}


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
    else chat.innerHTML += '<div class="ai-msg assistant" style="line-height:1.65">'+mdToHtml(data.response)+'</div>';
  } catch(e) {
    var thinkEl2 = document.getElementById('ai-thinking');
    if (thinkEl2) thinkEl2.textContent = '⚠️ Error: '+e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Send';
    chat.scrollTop = chat.scrollHeight;
  }
}
// Expose functions globally for inline onclick handlers
window.buildAIWidget = buildAIWidget;
window.aiAsk = aiAsk;
window.aiSend = aiSend;
// Expose to global scope for inline onclick handlers
window.buildAIWidget = buildAIWidget;
window.aiAsk = aiAsk;
window.aiSend = aiSend;

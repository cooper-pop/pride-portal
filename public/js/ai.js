// ai.js - AI Analysis widget
function mdToHtml(t){
    if(!t)return '';
    var lines=t.split('\n');
    var out=[];
    var inTable=false;
    var tableRows=[];

    function flushTable(){
      if(!tableRows.length)return;
      var hdr=tableRows[0];
      var body=tableRows.slice(2);
      var html='<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:.8rem">';
      html+='<thead><tr style="background:#1a3a6b;color:#fff">';
      hdr.forEach(function(c){html+='<th style="padding:5px 8px;text-align:left;white-space:nowrap">'+c+'</th>';});
      html+='</tr></thead><tbody>';
      body.forEach(function(row,i){
        html+='<tr style="border-bottom:1px solid #e2e8f0;background:'+(i%2===0?'#fff':'#f8fafc')+'">';
        row.forEach(function(c){html+='<td style="padding:4px 8px">'+c+'</td>';});
        html+='</tr>';
      });
      html+='</tbody></table>';
      out.push(html);
      tableRows=[];
      inTable=false;
    }

    function inlineFmt(s){
      // bold **text** or __text__
      s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
      s=s.replace(/__(.+?)__/g,'<strong>$1</strong>');
      // italic *text* or _text_
      s=s.replace(/\*([^*]+)\*/g,'<em>$1</em>');
      // inline code `text`
      s=s.replace(/`([^`]+)`/g,'<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:.85em">$1</code>');
      return s;
    }

    lines.forEach(function(line){
      var stripped=line.trim();

      // Table row
      if(stripped.startsWith('|')&&stripped.endsWith('|')){
        if(!inTable)inTable=true;
        var cells=stripped.slice(1,-1).split('|').map(function(c){return inlineFmt(c.trim());});
        // Skip separator rows (---|--- etc)
        if(!cells.every(function(c){return /^[-:]+$/.test(c);})){
          tableRows.push(cells);
        } else {
          tableRows.push(null); // separator placeholder
        }
        return;
      } else if(inTable){
        flushTable();
      }

      // Heading ## or ###
      if(/^###\s/.test(stripped)){
        out.push('<div style="font-size:.9rem;font-weight:700;color:#1a3a6b;margin:10px 0 4px">'+inlineFmt(stripped.substring(4))+'</div>');
      } else if(/^##\s/.test(stripped)){
        out.push('<div style="font-size:1rem;font-weight:700;color:#1a3a6b;margin:12px 0 5px;border-bottom:2px solid #e2e8f0;padding-bottom:3px">'+inlineFmt(stripped.substring(3))+'</div>');
      } else if(/^#\s/.test(stripped)){
        out.push('<div style="font-size:1.1rem;font-weight:700;color:#1a3a6b;margin:14px 0 6px">'+inlineFmt(stripped.substring(2))+'</div>');
      // Numbered list
      } else if(/^\d+\.\s/.test(stripped)){
        out.push('<div style="margin:4px 0 4px 14px;line-height:1.55">'+inlineFmt(stripped)+'</div>');
      // Bullet list - or *
      } else if(/^[-*]\s/.test(stripped)){
        out.push('<div style="margin:3px 0 3px 14px;line-height:1.55">&bull; '+inlineFmt(stripped.substring(2))+'</div>');
      // Empty line
      } else if(stripped===''){
        out.push('<div style="margin:4px 0"></div>');
      // Regular paragraph
      } else {
        out.push('<div style="margin:2px 0;line-height:1.6">'+inlineFmt(stripped)+'</div>');
      }
    });

    if(inTable)flushTable();
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
    else chat.innerHTML += '<div class="ai-msg assistant" style="line-height:1.65">'+mdToHtml((data.response||'').replace(/\\n/g,'\n'))+'</div>';
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

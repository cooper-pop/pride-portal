// ai.js - AI Analysis (Admin only)

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

function aiSend() {
  const input = document.getElementById('ai-input');
  const msg = input ? input.value.trim() : '';
  if(!msg) return;
  input.value = '';
  const chat = document.getElementById('ai-chat');
  if(chat) {
    chat.innerHTML += '<div style="text-align:right;margin:8px 0"><span style="background:#1a3a6b;color:#fff;padding:6px 12px;border-radius:12px;display:inline-block;max-width:80%">'+msg+'<\/span><\/div>';
    chat.innerHTML += '<div id="ai-typing" style="color:#888;font-style:italic;padding:4px 0">AI is thinking...<\/div>';
    chat.scrollTop = chat.scrollHeight;
  }
  apiCall('POST','/api/ai',{message:msg,company:currentCompany})
    .then(d=>{
      const t=document.getElementById('ai-typing'); if(t)t.remove();
      if(d&&d.response&&chat){
        chat.innerHTML += '<div style="margin:8px 0;line-height:1.6">'+formatAIResponse(d.response)+'<\/div>';
        chat.scrollTop=chat.scrollHeight;
      }
    }).catch(e=>{ const t=document.getElementById('ai-typing'); if(t)t.remove(); toast('AI error: '+e.message); });
}

function formatAIResponse(text) {
  if(!text) return '';
  let html = text;
  const lines = html.split('\n');
  const out = [];
  let tableRows = [];
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(l.trim().startsWith('|')&&!l.match(/^\|[-\s|]+\|$/)) tableRows.push(l);
    else if(l.trim().match(/^\|[-\s|]+\|$/)) { /* separator - skip */ }
    else {
      if(tableRows.length>0){
        let tbl='<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:.85rem">';
        tableRows.forEach((row,ri)=>{
          const cells=row.split('|').filter(c=>c.trim()!=='');
          const tag=ri===0?'th':'td';
          const bg=ri===0?'background:#1a3a6b;color:#fff;':'background:'+(ri%2===0?'#f8f9fa':'#fff')+';;';
          tbl+='<tr>'+cells.map(c=>'<'+tag+' style="padding:6px 8px;border-bottom:1px solid #ddd;'+bg+'">'+c.trim()+'<\/'+tag+'>').join('')+'<\/tr>';
        });
        tbl+='<\/table>'; out.push(tbl); tableRows=[];
      }
      out.push(l);
    }
  }
  html=out.join('\n');
  html=html.replace(/\*\*(.+?)\*\*/g,'<strong>$1<\/strong>');
  html=html.replace(/^### (.+)$/gm,'<h4 style="color:#1a3a6b;margin:10px 0 4px">$1<\/h4>');
  html=html.replace(/^## (.+)$/gm,'<h3 style="color:#1a3a6b;margin:12px 0 6px">$1<\/h3>');
  html=html.replace(/^# (.+)$/gm,'<h2 style="color:#1a3a6b;margin:14px 0 8px">$1<\/h2>');
  html=html.replace(/^[*-] (.+)$/gm,'<li style="margin:2px 0;margin-left:16px">$1<\/li>');
  html=html.replace(/\n\n+/g,'<\/p><p style="margin:6px 0">');
  html=html.replace(/\n/g,'<br>');
  return '<p style="margin:6px 0">'+html+'<\/p>';
}
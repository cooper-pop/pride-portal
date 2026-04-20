// parts.js
var _partsTab='inventory',_partsData={inventory:[],invoices:[],manuals:[],crossref:[],orders:[]},_editingPart=null,_machinesList=[],_scanLineCount=0;
function loadMachines(){try{_machinesList=JSON.parse(localStorage.getItem('parts_machines')||'[]');}catch(e){_machinesList=[];}}
function saveMachines(){localStorage.setItem('parts_machines',JSON.stringify(_machinesList));}
function buildPartsWidget(){
      var wt=document.getElementById('widget-tabs'),wc=document.getElementById('widget-content');
      var tabs=['inventory','invoices','manuals','crossref','orders','machines'];
      var labels={inventory:'Inventory',invoices:'Invoices',manuals:'Manuals',crossref:'Cross-Ref',orders:'Orders',machines:'Machines'};
      wt.innerHTML=tabs.map(function(t){return '<button class="wtab" onclick="partsShowTab(\''+t+'\')" id="ptab-'+t+'" style="padding:6px 12px;border:none;background:transparent;cursor:pointer;font-size:.78rem;border-bottom:2px solid transparent;color:#94a3b8">'+labels[t]+'</button>';}).join('');
      wc.innerHTML='<div id="parts-panel" style="padding:0"></div>';
      loadMachines();partsInit();
}
function partsInit(){
      apiCall('GET','/api/parts?action=init_parts_db').then(function(){partsShowTab('inventory');}).catch(function(){partsShowTab('inventory');});
}
function partsShowTab(tab){
      _partsTab=tab;
      ['inventory','invoices','manuals','crossref','orders','machines'].forEach(function(t){
              var b=document.getElementById('ptab-'+t);
              if(b){b.style.borderBottomColor=t===tab?'#1a3a6b':'transparent';b.style.color=t===tab?'#1a3a6b':'#94a3b8';b.style.fontWeight=t===tab?'600':'400';}
      });
      var panel=document.getElementById('parts-panel');if(!panel)return;
      if(tab==='machines'){partsRenderMachines();return;}
      panel.innerHTML='<div style="padding:20px;text-align:center;color:#94a3b8">Loading...</div>';
      var actions={inventory:'get_parts',invoices:'get_invoices',manuals:'get_manuals',crossref:'get_cross_ref',orders:'get_parts_orders'};
      apiCall('GET','/api/parts?action='+actions[tab]).then(function(data){
              _partsData[tab]=Array.isArray(data)?data:[];
              var r={inventory:partsRenderInventory,invoices:partsRenderInvoices,manuals:partsRenderManuals,crossref:partsRenderCrossRef,orders:partsRenderOrders};
              if(r[tab])r[tab]();
      }).catch(function(){document.getElementById('parts-panel').innerHTML='<div style="padding:20px;color:#ef4444">Error loading data</div>';});
}
window.partsShowTab=partsShowTab;
var CARD='background:#fff;border-radius:10px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)';
var BTN='padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:.78rem;font-weight:600';
var BTN_P=BTN+';background:#1a3a6b;color:#fff';
var BTN_S=BTN+';background:#6366f1;color:#fff';
var BTN_E='padding:3px 9px;border-radius:5px;border:none;cursor:pointer;font-size:.73rem;background:#e0e7ff;color:#3730a3';
var BTN_D='padding:3px 9px;border-radius:5px;border:none;cursor:pointer;font-size:.73rem;background:#fee2e2;color:#b91c1c;margin-left:5px';
var INP='width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.83rem;margin-bottom:8px;box-sizing:border-box';
function machineTagOptions(sel){
      var o='<option value="shop_stock"'+(!sel||sel==='shop_stock'?' selected':'')+'>Shop Stock</option>';
      _machinesList.forEach(function(m){o+='<option value="'+m.id+'"'+(sel===m.id?' selected':'')+'>'+m.name+'</option>';});
      return o;
}
function machineTagLabel(v){
      if(!v||v==='shop_stock')return '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:10px;font-size:.72rem">Shop Stock</span>';
      var m=_machinesList.find(function(x){return x.id===v;});
      return m?'<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:10px;font-size:.72rem">'+m.name+'</span>':'<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:10px;font-size:.72rem">'+v+'</span>';
}
function partsRenderInventory(){
      var panel=document.getElementById('parts-panel'),items=_partsData.inventory;
      var html='<div style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-weight:700;font-size:.95rem">Parts Inventory</span><div><button style="'+BTN_S+';margin-right:6px" onclick="partsFindParts()">Find</button><button style="'+BTN_P+'" onclick="partsAddPartForm(-1)">+ Add Part</button></div></div>';
      html+='<input type="text" placeholder="Search part number, description..." style="'+INP+'" oninput="partsSearchInv(this.value)">';
      if(!items.length)html+='<div style="text-align:center;color:#94a3b8;padding:30px 0">No parts yet.</div>';
      else html+='<div id="inv-list">'+items.map(function(p,i){return partsInvCard(p,i);}).join('')+'</div>';
      html+='</div>';panel.innerHTML=html;
}
function partsInvCard(p,i){
      return '<div style="'+CARD+'"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="flex:1"><div style="font-weight:600;font-size:.85rem">'+(p.part_number||'')+(p.description?' - '+p.description:'')+'</div><div style="color:#64748b;font-size:.78rem;margin-top:3px">Qty: <b>'+(p.quantity||0)+'</b> Cost: <b>$'+parseFloat(p.unit_cost||0).toFixed(2)+'</b>'+(p.supplier?' | '+p.supplier:'')+'</div><div style="margin-top:5px">'+machineTagLabel(p.machine_tag)+'</div>'+(p.notes?'<div style="color:#94a3b8;font-size:.75rem;margin-top:2px">'+p.notes+'</div>':'')+'</div><div style="white-space:nowrap;margin-left:8px"><button style="'+BTN_E+'" onclick="partsAddPartForm('+i+')">Edit</button><button style="'+BTN_D+'" onclick="partsDelPart('+i+')">Del</button></div></div></div>';
}
function partsSearchInv(q){
      var list=document.getElementById('inv-list');if(!list)return;
      var f=_partsData.inventory.filter(function(p){var lo=q.toLowerCase();return(p.part_number||'').toLowerCase().includes(lo)||(p.description||'').toLowerCase().includes(lo);});
      list.innerHTML=f.length?f.map(function(p,i){return partsInvCard(p,i);}).join(''):'<div style="text-align:center;color:#94a3b8;padding:20px">No results</div>';
}
function partsFindParts(){var q=prompt('Search part number or keyword:');if(q)partsSearchInv(q);}
function partsAddPartForm(editIdx){
      loadMachines();var p=editIdx>=0?_partsData.inventory[editIdx]:{};
      document.getElementById('parts-panel').innerHTML='<div style="padding:14px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><button style="'+BTN+';background:#f1f5f9;color:#334155" onclick="partsShowTab(\'inventory\')">Back</button><span style="font-weight:700;font-size:.95rem">'+(editIdx>=0?'Edit Part':'Add Part')+'</span></div><input type="text" placeholder="Part Number" id="pf-num" style="'+INP+'" value="'+(p.part_number||'')+'"><input type="text" placeholder="Description" id="pf-desc" style="'+INP+'" value="'+(p.description||'')+'"><input type="number" placeholder="Quantity" id="pf-qty" style="'+INP+'" value="'+(p.quantity||'')+'"><input type="number" placeholder="Unit Cost" id="pf-cost" step="0.01" style="'+INP+'" value="'+(p.unit_cost||'')+'"><input type="text" placeholder="Supplier" id="pf-sup" style="'+INP+'" value="'+(p.supplier||'')+'"><label style="font-size:.78rem;color:#64748b;display:block;margin-bottom:3px">Assign to Machine or Shop Stock</label><select id="pf-mach" style="'+INP+'">'+machineTagOptions(p.machine_tag||'')+'</select><textarea placeholder="Notes" id="pf-notes" style="'+INP+'resize:vertical;height:60px">'+(p.notes||'')+'</textarea><button style="'+BTN_P+';width:100%" onclick="partsSavePart('+editIdx+')">Save Part</button></div>';
}
function partsSavePart(editIdx){
      var data={part_number:document.getElementById('pf-num').value,description:document.getElementById('pf-desc').value,quantity:document.getElementById('pf-qty').value,unit_cost:document.getElementById('pf-cost').value,supplier:document.getElementById('pf-sup').value,machine_tag:document.getElementById('pf-mach').value,notes:document.getElementById('pf-notes').value};
      var action=editIdx>=0?'update_part':'add_part';
      if(editIdx>=0)data.id=_partsData.inventory[editIdx].id;
      apiCall('POST','/api/parts?action='+action,data).then(function(){partsShowTab('inventory');}).catch(function(){alert('Error saving part');});
}
function partsDelPart(i){if(!confirm('Delete this part?'))return;apiCall('POST','/api/parts?action=delete_part',{id:_partsData.inventory[i].id}).then(function(){partsShowTab('inventory');}).catch(function(){alert('Error');});}
function partsRenderInvoices(){
      var panel=document.getElementById('parts-panel'),items=_partsData.invoices;
      var html='<div style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-weight:700;font-size:.95rem">Parts Invoices</span><div><button style="'+BTN_S+';margin-right:6px" onclick="partsScanInvoice()">Scan Invoice</button><button style="'+BTN_P+'" onclick="partsInvoiceForm(-1)">+ Add</button></div></div>';
      if(!items.length)html+='<div style="text-align:center;color:#94a3b8;padding:30px 0">No invoices yet.</div>';
      else items.forEach(function(inv,i){
              html+='<div style="'+CARD+'"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="flex:1"><div style="font-weight:600;font-size:.85rem">Invoice #'+(inv.invoice_number||i+1)+' - '+(inv.vendor||'Unknown')+'</div><div style="color:#64748b;font-size:.78rem">'+(inv.date||'')+' | Total: $'+parseFloat(inv.total||0).toFixed(2)+'</div>';
              if(inv.line_items&&inv.line_items.length){html+='<div style="margin-top:6px;font-size:.78rem;background:#f8fafc;border-radius:6px;padding:6px">';inv.line_items.forEach(function(li){html+='<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #f1f5f9"><span style="flex:3">'+(li.item||'')+'</span><span>x'+(li.qty||0)+'</span><span style="color:#1a3a6b;font-weight:600">$'+parseFloat(li.cost||0).toFixed(2)+'</span></div>';});html+='</div>';}
              html+='</div><div style="white-space:nowrap;margin-left:8px"><button style="'+BTN_E+'" onclick="partsInvoiceForm('+i+')">Edit</button><button style="'+BTN_D+'" onclick="partsDelInvoice('+i+')">Del</button></div></div></div>';
      });
      html+='</div>';panel.innerHTML=html;
}
function partsScanInvoice(){
      _scanLineCount=0;
      document.getElementById('parts-panel').innerHTML='<div style="padding:14px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><button style="'+BTN+';background:#f1f5f9;color:#334155" onclick="partsShowTab(\'invoices\')">Back</button><span style="font-weight:700;font-size:.95rem">Scan Invoice</span></div><div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:10px;padding:24px;text-align:center;margin-bottom:14px"><div style="font-weight:600;color:#334155;margin-bottom:4px">Upload Invoice Photo or Image</div><div style="color:#94a3b8;font-size:.78rem;margin-bottom:14px">AI will extract items, quantities and costs automatically</div><input type="file" id="inv-img-input" accept="image/*" capture="environment" style="display:none" onchange="partsRunScan(this)"><button style="'+BTN_P+'" onclick="document.getElementById(\'inv-img-input\').click()">Choose Photo or File</button></div><div id="scan-preview" style="display:none;text-align:center;margin-bottom:10px"><img id="scan-img" style="max-width:100%;max-height:180px;border-radius:8px;object-fit:contain"><div id="scan-status" style="color:#6366f1;font-weight:600;margin-top:6px;font-size:.85rem">Scanning...</div></div><div id="scan-results" style="display:none"><div style="font-weight:700;margin-bottom:8px;color:#1a3a6b;font-size:.88rem">Review and Edit Scanned Data</div><label style="font-size:.75rem;color:#64748b">Vendor</label><input type="text" id="sc-vendor" style="'+INP+'"><label style="font-size:.75rem;color:#64748b">Invoice Number</label><input type="text" id="sc-invnum" style="'+INP+'"><label style="font-size:.75rem;color:#64748b">Date</label><input type="date" id="sc-date" style="'+INP+'"><div style="font-weight:600;font-size:.82rem;margin-bottom:6px;color:#334155">Line Items <button style="'+BTN+';background:#f1f5f9;color:#334155;padding:3px 8px;font-size:.72rem" onclick="partsAddScanLine(\'\',\'\',\'\')">+ Add Row</button></div><div id="scan-lines"></div><button style="'+BTN_P+';width:100%;margin-top:8px" onclick="partsSaveScanInvoice()">Save Invoice</button></div></div>';
}
function partsRunScan(input){
      if(!input.files||!input.files[0])return;
      var file=input.files[0],reader=new FileReader();
      reader.onload=function(e){
              var b64full=e.target.result,b64=b64full.split(',')[1],mime=file.type||'image/jpeg';
              document.getElementById('scan-preview').style.display='block';
              document.getElementById('scan-img').src=b64full;
              document.getElementById('scan-status').textContent='AI scanning invoice...';
              fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:mime,data:b64}},{type:'text',text:'This is a parts invoice. Respond ONLY with valid JSON, no markdown:\n{"vendor":"","invoice_number":"","date":"YYYY-MM-DD","line_items":[{"item":"","qty":0,"cost":0.00}]}\nExtract every line item with its description, quantity, and unit cost.'}]}]})}).then(function(r){return r.json();}).then(function(d){
                        var txt='';if(d.content&&d.content[0]&&d.content[0].text)txt=d.content[0].text;
                        try{
                                    var parsed=JSON.parse(txt.replace(/```json|```/g,'').trim());
                                    document.getElementById('scan-status').textContent='Scan complete! Review below.';
                                    document.getElementById('scan-results').style.display='block';
                                    document.getElementById('sc-vendor').value=parsed.vendor||'';
                                    document.getElementById('sc-invnum').value=parsed.invoice_number||'';
                                    document.getElementById('sc-date').value=parsed.date||'';
                                    var lines=parsed.line_items||[];
                                    lines.forEach(function(li){partsAddScanLine(li.item,li.qty,li.cost);});
                                    if(!lines.length)partsAddScanLine('','','');
                        }catch(err){
                                    document.getElementById('scan-status').textContent='Could not parse. Enter manually.';
                                    document.getElementById('scan-results').style.display='block';
                                    partsAddScanLine('','','');
                        }
              }).catch(function(){document.getElementById('scan-status').textContent='Scan error. Enter manually.';document.getElementById('scan-results').style.display='block';partsAddScanLine('','','');});
      };
      reader.readAsDataURL(file);
}
function partsAddScanLine(item,qty,cost){
      var id='sl'+(++_scanLineCount),container=document.getElementById('scan-lines');
      if(!container)return;
      var div=document.createElement('div');div.id=id;div.style.cssText='display:flex;gap:5px;margin-bottom:5px;align-items:center';
      div.innerHTML='<input type="text" placeholder="Item or Part Name" style="flex:3;padding:6px;border:1px solid #e2e8f0;border-radius:5px;font-size:.78rem" value="'+(item||'')+'"><input type="number" placeholder="Qty" style
          =f"ufnlcetxi:o1n; ppaadrdtisnRge:n6dpexr;Mbaonrudaelrs:(1)p{x
            s ovlaird  p#aen2eel8=fd0o;cbuomrednetr.-greatdEiluesm:e5nptxB;yfIodn(t'-psairztes:-.p7a8nreelm'") ,viatleumes=="_'p+a(rqttsyD|a|t'a'.)m+a'n"u>a<lisn;p
          u t  vtayrp eh=t"mnlu=m'b<edri"v  psltaycleeh=o"lpdaedrd=i"nCgo:s1t4"p xs"t>e<pd=i"v0 .s0t1y"l es=t"ydlies=p"lfalye:xf:l1e;xp;ajdudsitnigf:y6-pcxo;nbtoerndte:rs:p1apcxe -sboeltiwde e#ne;2ael8ifg0n;-biotredmesr:-creandtieurs;:m5aprxg;ifno-nbto-tstiozme::1.07p8xr"e>m<"s pvaanl uset=y"l'e+=("cfoosntt|-|w'e'i)g+h't":>7<0b0u;tftoonnt -osniczlei:c.k9=5"rtehmi"s>.MpaanrueanltsE<l/esmpeannt>.<rbeumtotvoen( )s"t ysltey=l"e'=+"BpTaNd_dPi+n'g": 4opnxc l7ipcxk;=b"opradretrs-MraanduiaulsF:o5rpmx(;-b1o)r"d>e+r :Andodn<e/;bcuutrtsoonr>:<p/odiinvt>e'r;;
          f o nitf-(s!iiztee:m.s7.3lreenmg;tbha)chktgmrlo+u=n'd<:d#ifve es2tey2l;ec=o"ltoerx:t#-ba9l1icg1nc:"c>exn<t/ebru;tctoolno>r':;#
9 4 ac3obn8t;apiandedri.nagp:p3e0npdxC h0i"l>dN(od imva)n;u
    a}l
sf uynectt.i<o/nd ipva>r't;s
    S c aenlLsien eistDeamtsa.(f)o{r
                                   E a cvha(rf ulnicnteiso=n[(]m,,rio)w{sh=tdmolc+u=m'e<ndti.vg esttEylleem=e"n't+BCyAIRdD(+''s"c>a<nd-ilvi nsetsy'l)e.=c"hdiilsdprleany;:
                                            f l efxo;rj(uvsatri fiy=-0c;oin<treonwts:.slpeancget-hb;eit+w+e)e{nv;aarl iignns-=irtoewmss[:ic]e.nqtueerr"y>S<edlievc>t<odriAvl ls(t'yilnep=u"tf'o)n;ti-fw(eiingsh[t0:]6&0&0i;nfso[n0t]-.sviazleu:e..8t5rriemm(")>)'l+imn.etsi.tplues+h'(<{/idtievm>:<idnisv[ 0s]t.yvlael=u"ec,oqltoyr::p#a6r4s7e4F8lbo;afto(nitn-ss[i1z]e.:v.a7l8uree|m|"0>)',+c(oms.tm:apcahrisneeF|l|o'a't)(+i(nms.[u2r]l.?v'a l<uae |h|r0e)f}=)";'}+
                                                                                                                                                                                                                                                                                                                                                                                                                               m . urrelt+u'r"n  tlairngeest;=
                                       "}_
                                       bfluannckt"i osnt yplaer=t"scSoalvoerS:c#a6n3I6n6vfo1i"c>eV(i)e{w
                                       < / av>a'r: 'l'i)n+e's<=/pdairvt>s'S+c(amn.LnionteessD?a't<ad(i)v, tsottyalle==l"icnoelso.rr:e#d9u4cae3(bf8u;nfcotnito-ns(isz,el:).{7r5erteumr"n> 's++m(.ln.oqtteys*+l'.<c/odsitv)>;'}:,'0'));+
                                       ' < /adpiivC>a<ldli(v'>P<ObSuTt't,o'n/ asptiy/lpea=r"t's+?BaTcNt_iEo+n'="a dodn_cilnivcoki=c"ep'a,r{tvseMnadnoura:ldFoocrumm(e'n+ti.+g'e)t"E>lEedmietn<t/BbyuItdt(o'ns>c<-bvuetntdoonr 's)t.yvlael=u"e',+iBnTvNo_iDc+e'_"n uomnbcelri:cdko=c"upmaerntts.DgeeltMEalneumaeln(t'B+yiI+d'()'"s>cD-eiln<v/nbuumt't)o.nv>a<l/udei,vd>a<t/ed:idvo>c<u/mdeinvt>.'g;e}t)E;l
                                   e m ehnttmBly+I=d'(<'/sdci-vd>a't;ep'a)n.evla.liunen,elriHnTeM_Li=thetmmsl:;l
                                   i}n
efsu,ntcottiaoln: tpoatratls}M)a.ntuhaelnF(ofrumn(cetdiiotnI(d)x{)p{a
                                                                    r t svSahro wmT=aebd(i'tiIndvxo>i=c0e?s_'p)a;r}t)s.Dcaattac.hm(afnuunacltsi[oend(i)t{Iadlxe]r:t{(}';E
    r r odro csuamveinntg. gientvEoliecmee'n)t;B}y)I;d
    (}'
    pfaurntcst-ipoann epla'r)t.siInnnveoriHcTeMFLo=r'm<(deidvi tsItdyxl)e{=
" p a_dsdcianngL:i1n4epCxo"u>n<td=i0v; vsatry lien=v"=deidsiptlIadyx:>f=l0e?x_;paalritgsnD-aittae.misn:vcoeincteesr[;egdaipt:I8dpxx];:m{a}r;g
    i n -dbooctutmoemn:t1.4gpext"E>l<ebmuetnttoBny Isdt(y'lpea=r"t's+-BpTaNn+e'l;'b)a.cikngnreoruHnTdM:L#=f'1<fd5ifv9 ;sctoylloer=:"#p3a3d4d1i5n5g": 1o4npcxl"i>c<kd=i"vp asrttyslSeh=o"wdTiasbp(l\a'ym:afnlueaxl;sa\l'i)g"n>-Biatcekm<s/:bcuetnttoenr>;<gsappa:n8 psxt;ymlaer=g"ifno-nbto-twteoimg:h1t4:p7x0"0>;<fbounttt-osni zset:y.l9e5=r"e'm+"B>T'N++('e;dbiatcIkdgxr>o=u0n?d':E#dfi1tf'5:f'9A;dcdo'l)o+r': #M3a3n4u1a5l5<"/ sopnacnl>i<c/kd=i"vp>a<ritnspSuhto wtTyapbe(=\"'tienxvto"i cpelsa\c'e)h"o>lBdaecrk=<"/Tbiuttlteo"n >i<ds=p"amnf -stt"y lset=y"lfeo=n"t'-+wIeNiPg+h't": 7v0a0l;ufeo=n"t'-+s(imz.et:i.t9l5er|e|m'"'>)'++'("e>d<iitnIpduxt> =t0y?p'eE=d"itte xItn"v opilcaec'e:h'oAlddde rI=n"vMoaicchei'n)e+"' <i/ds=p"amnf>-<m/"d isvt>y<llea=b"e'l+ IsNtPy+l'e"= "vfaolnute-=s"i'z+e(:m..7m5arcehmi;nceo|l|o'r':)#+6'4"7>4<8ibn"p>uVte ntdyopre<=/"luarble"l >p<liancpeuhto ltdyepre==""UtReLx"t "i di=d"=m"fs-cu-"v esntdyolre"= "s't+yIlNeP=+"''"+ IvNaPl+u'e"= "v'a+l(ume.=u"r'l+|(|i'n'v).+v'e"n>d<otre|x|t'a'r)e+a' "p>l<alcaebheoll dsetry=l"eN=o"tfeosn"t -isdi=z"em:f.-7n5"r esmt;ycloel=o"r':+#I6N4P7+4'8rbe"s>iIznev:oviecret iNcuamlb;ehre<i/glhatb:e6l0>p<xi"n>p'u+t( mt.ynpoet=e"st|e|x't'") +i'd<=/"tsecx-tianrvenau>m<"b ustttyolne =s"t'y+lIeN=P"+''+"B TvNa_lPu+e'=;"w'i+d(tihn:v1.0i0n%v"o iocnec_lniucmkb=e"rp|a|r't's)S+a'v"e>M<alnaubaell( 's+teydliet=I"dfxo+n't)-"s>iSzaev:e.<7/5bruetmt;ocno>l<o/rd:i#v6>4'7;4
    8}b
"f>uDnacttei<o/nl apbaerlt>s<SianvpeuMta ntuyaple(=e"ddiattIed"x )i{d
    = " svca-rd adtaet"a =s{ttyiltel=e":'d+oIcNuPm+e'n"t .vgaeltuEel=e"m'e+n(tiBnyvI.dd(a'tmef|-|t''')).+v'a"l>u<ed,imva cshtiynlee:=d"ofcounmte-nwte.iggehttE:l6e0m0e;nftoBnytI-ds(i'zmef:-.m8'2)r.evma;lmuaer,guirnl-:bdootctuomme:n6tp.xg;ectoElloerm:e#n3t3B4y1I5d5("'>mLfi-nue' )I.tveamlsu e<,bnuottteosn: dsotcyulmee=n"t'.+gBeTtNE+l'e;mbeanctkBgyrIodu(n'dm:f#-fn1'f)5.fv9a;lcuoel}o;r
    : # 3v3a4r1 5a5c;tpiaodnd=iendgi:t3Ipdxx >8=p0x?;'fuopndta-tsei_zmea:n.u7a2lr'e:m'"a dodn_cmlaincuka=l"'p;airft(seAddidtSIcdaxn>L=i0n)ed(a\t'a\.'i,d\='_\p'a,r\t's\D'a)t"a>.+m aAnduda lRso[we<d/ibtuItdtxo]n.>i<d/;d
    i v >a<pdiiCva lild(='"PsOcSaTn'-,l'i/naepsi"/>p<a/rdtisv?>a<cbtuitotno=n' +satcytlieo=n",'d+aBtTaN)_.Pt+h'e;nw(ifdutnhc:t1i0o0n%(;)m{apragritns-Sthoopw:T8apbx("' moannculailcsk'=)";p}a)r.tcsaStacvhe(IfnuvnocitcieoEnd(i)t{(a'l+eerdti(t'IEdrxr+o'r)'")>;S}a)v;e
}I
nfvuonicctei<o/nb uptatrotns>D<e/ldMiavn>u'a;l
( i )v{airf (l!icnoensf=iirnmv(.'lDienlee_tiet?e'm)s)|r|e[t]u;rlni;naepsi.CfaolrlE(a'cPhO(SfTu'n,c't/iaopni(/lpia)r{tpsa?ratcstAidodnS=cdaenlLeitnee_(mlain.uiatle'm,,{liid.:q_tpya,rltis.Dcaotsat.)m;a}n)u;ailfs([!il]i.nieds}.)l.etnhgetnh()fpuanrcttsiAodnd(S)c{apnaLritnseS(h'o'w,T'a'b,('''m)a;n
    u}a
lfsu'n)c;t}i)o.nc aptacrht(sfSuanvcetIinovno(i)c{eaEldeirtt((e'dEirtrIodrx')){;
} ) ;v}a
rf ulnicnteiso=np apratrstSscRaennLdienreCsrDoastsaR(e)f,(t)o{t
a l =vlairn eps.reduce(function(s,l){return s+(l.qty*l.cost);},0);
                                                                var data={vendor:document.getElementById('sc-vendor').value,invoice_number:document.getElementById('sc-invnum').value,date:document.getElementById('sc-date').value,line_items:lines,total:total};
                                                                var action=editIdx>=0?'update_invoice':'add_invoice';if(editIdx>=0)data.id=_partsData.invoices[editIdx].id;
                                                                apiCall('POST','/api/parts?action='+action,data).then(function(){partsShowTab('invoices');}).catch(function(){alert('Error');});
                                                             }
function partsDelInvoice(i){if(!confirm('Delete invoice?'))return;apiCall('POST','/api/parts?action=delete_invoice',{id:_partsData.invoices[i].id}).then(function(){partsShowTab('invoices');}).catch(function(){alert('Error');});}

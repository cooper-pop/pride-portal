// print.js - Print/PDF
function printReport(title, contentHtml) {
  const w = window.open('','_blank','width=900,height=700');
  const date = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  w.document.write('<!DOCTYPE html><html><head><title>'+title+'<\/title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:20px;color:#222}.hdr{background:#1a3a6b;color:#fff;padding:16px 20px;border-radius:6px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}.hdr h1{font-size:1.2rem}.hdr span{font-size:.8rem;opacity:.8}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:.85rem}th{background:#1a3a6b;color:#fff;padding:7px 10px;text-align:left}td{padding:6px 10px;border-bottom:1px solid #eee}tr:nth-child(even) td{background:#f8f9fa}.no-print{display:flex;justify-content:flex-end;gap:10px;margin-bottom:16px}.btn{background:#1a3a6b;color:#fff;border:none;padding:8px 18px;border-radius:4px;cursor:pointer;font-size:.9rem}@media print{.no-print{display:none}}<\/style><\/head><body>');
  w.document.write('<div class="no-print"><button class="btn" onclick="window.print()">🖨️ Print / Save as PDF<\/button><button class="btn" style="background:#666" onclick="window.close()">✕ Close<\/button><\/div>');
  w.document.write('<div class="hdr"><h1>'+title+'<\/h1><span>Pride of the Pond | '+date+'<\/span><\/div>');
  w.document.write('<div>'+contentHtml+'<\/div><\/body><\/html>');
  w.document.close();
}
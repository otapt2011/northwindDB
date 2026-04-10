let SQL, db, chart;

/* Utility */
function dbExecSafe(sql){
  try { return db.exec(sql); }
  catch(e){ console.warn('SQL error', e); return null; }
}

/* Init DB */
async function initSqlJsAndDb(){
  SQL = await initSqlJs({ locateFile:f => f==='sql-wasm.wasm' ? '/assets/sql-wasm.wasm' : f });
  try {
    const resp = await fetch('/assets/northwind.db');
    const ab = await resp.arrayBuffer();
    db = new SQL.Database(new Uint8Array(ab));
    setStatus('Loaded');
    populateTableList();
    initDefaultAggregates();
  } catch(e){
    console.error(e);
    db = new SQL.Database();
    setStatus('Empty DB');
    populateTableListFallback();
    initDefaultAggregates();
  }
}

/* Populate presetQuery select */
function populateTableList(){
  const sel = document.getElementById('presetQuery');
  sel.innerHTML = '<option value="">-- Select Table / Aggregates --</option>';
  const res = dbExecSafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  if(res && res[0]){
    res[0].values.forEach(r=>{
      const opt=document.createElement('option');
      opt.value=r[0]; opt.textContent=r[0];
      sel.appendChild(opt);
    });
  }
  const ag=document.createElement('option');
  ag.value='Aggregates'; ag.textContent='Aggregates';
  sel.appendChild(ag);
}
function populateTableListFallback(){
  const sel=document.getElementById('presetQuery');
  sel.innerHTML='<option value="">-- Select Table / Aggregates --</option>';
  ['Employees','Products','Orders','Customers','Categories','Aggregates'].forEach(n=>{
    const opt=document.createElement('option'); opt.value=n; opt.textContent=n; sel.appendChild(opt);
  });
}

/* Sidebar buttons */
document.querySelectorAll('#sidebar button[data-action]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const action = btn.dataset.action;
    const normalized = action.charAt(0).toUpperCase()+action.slice(1);
    const sel=document.getElementById('presetQuery');
    const opt=Array.from(sel.options).find(o=>o.value.toLowerCase()===action.toLowerCase() || o.value.toLowerCase()===normalized.toLowerCase());
    if(opt) sel.value=opt.value;
    sel.dispatchEvent(new Event('change'));
  });
});
document.getElementById('toggleSidebar').addEventListener('click', ()=>{
  document.getElementById('sidebar').classList.toggle('expanded');
});

/* Preset Query change */
document.getElementById('presetQuery').addEventListener('change',function(){
  const table=this.value;
  const colSelect=document.getElementById('columnSelect');
  const filtersContainer=document.getElementById('filters');
  const sqlEditor=document.getElementById('sqlEditor');
  colSelect.innerHTML=''; filtersContainer.innerHTML=''; sqlEditor.value='';
  if(!table||!db) return;
  if(table!=="Aggregates"){
    const cols=db.exec(`PRAGMA table_info(${table})`)[0].values;
    cols.forEach(c=>{
      const opt=document.createElement('option');
      opt.value=c[1]; opt.textContent=c[1]; opt.selected=true;
      colSelect.appendChild(opt);
    });
    const filterCols=['Country','City','CategoryID','CustomerID','EmployeeID'];
    filterCols.forEach(f=>{
      if(cols.some(c=>c[1]===f)){
        const distinct=db.exec(`SELECT DISTINCT ${f} FROM ${table}`);
        if(distinct.length&&distinct[0].values.length){
          const div=document.createElement('div');
          div.className='filter-pill';
          div.innerHTML=`<strong>${f}:</strong>`+
            distinct[0].values.map(v=>`<label><input type="checkbox" class="filterCheckbox" data-col="${f}" value="${v[0]}" checked> ${v[0]}</label>`).join('');
          filtersContainer.appendChild(div);
        }
      }
    });
    runQuery();
  } else {
    initDefaultAggregates();
  }
});

/* Build Query */
function buildQuery(){
  const table=document.getElementById('presetQuery').value;
  if(!table||table==="Aggregates") return document.getElementById('sqlEditor').value;
  const colSelect=document.getElementById('columnSelect');
  const cols=Array.from(colSelect.selectedOptions).map(o=>o.value);
  const selectCols=cols.length?cols.join(', '):'*';
  const filters=[...document.querySelectorAll('.filterCheckbox')].filter(c=>c.checked)
    .reduce((acc,c)=>{const col=c.dataset.col;if(!acc[col]) acc[col]=[]; acc[col].push(c.value); return acc;},{});
  const where=Object.keys(filters).map(k=>`${k} IN (${filters[k].map(v=>`'${v}'`).join(',')})`).join(' AND ');
  return `SELECT ${selectCols} FROM ${table}` + (where?` WHERE ${where}`:'');
}

/* Render Results */
function renderResults(results){
  const head=document.getElementById('resultHead');
  const body=document.getElementById('resultBody');
  head.innerHTML=''; body.innerHTML='';
  if(!results||results.length===0){
    head.innerHTML='<tr><th>—</th></tr>';
    body.innerHTML='<tr><td style="color:#888">No rows</td></tr>'; return;
  }
  const r=results[0], cols=r.columns, rows=r.values;
  head.innerHTML='<tr>'+cols.map(c=>`<th>${c}</th>`).join('')+'</tr>';
  body.innerHTML=rows.map(row=>`<tr>${row.map(v=>{
    if(v instanceof Uint8Array){const base64=arrayBufferToBase64(v);return `<td><img src="data:image/bmp;base64,${base64}"/></td>`;}
    return `<td>${v??''}</td>`;}).join('')}</tr>`).join('');
  if(document.getElementById('presetQuery').value==="Aggregates") renderChart(r);
}
function arrayBufferToBase64(buffer){let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i++) binary+=String.fromCharCode(bytes[i]);return btoa(binary);}
function runQuery(){if(!db) return;const sql=document.getElementById('sqlEditor').value.trim()||buildQuery();try{const results=db.exec(sql);renderResults(results);}catch(err){document.getElementById('resultHead').innerHTML='<tr><th>Error</th></tr>';document.getElementById('resultBody').innerHTML=`<tr><td>${err.message}</td></tr>`;}}

/* Search filter */
document.getElementById('searchInput').addEventListener('input',function(){
  const filter=this.value.toLowerCase();
  document.querySelectorAll('#resultBody tr').forEach(tr=>{
    tr.style.display=tr.innerText.toLowerCase().includes(filter)?'':'none';
  });
});

/* Run & Export */
document.getElementById('runBtn').addEventListener('click',runQuery);
document.getElementById('exportCsvBtn').addEventListener('click',function(){
  const headers=Array.from(document.querySelectorAll('#resultHead th')).map(th=>`"${th.innerText}"`);
  let csv=headers.join(',')+'\n';
  document.querySelectorAll('#resultBody tr').forEach(tr=>{
    const cols=Array.from(tr.children).map(td=>`"${td.innerText}"`);
    csv+=cols.join(',')+'\n';
  });
  const blob=new Blob([csv],{type:'text/csv'}); 
  const url=URL.createObjectURL(blob); 
  const a=document.createElement('a'); 
  a.href=url;a.download='export.csv';a.click(); 
  URL.revokeObjectURL(url);
});

/* Filters trigger rerun */
document.addEventListener('change',e=>{
  if(e.target.matches('.filterCheckbox')) runQuery();
});

/* Chart */
function renderChart(result){
  const labels=result.columns.length>1?result.values.map(r=>r[0]):[];
  const data=result.columns.length>1?result.values.map(r=>r[1]):[];
  const ctx=document.getElementById('myChart').getContext('2d');
  if(chart) chart.destroy();
  chart=new Chart(ctx,{
    type:'bar',
    data:{labels,datasets:[{label:'Aggregates',data,backgroundColor:varColors(data.length)}]},
    options:{responsive:true, plugins:{legend:{labels:{color:'white'}}}, scales:{x:{ticks:{color:'white'}}, y:{ticks:{color:'white'}}}}
  });
}
function varColors(n){return Array.from({length:n},(_,i)=>`hsl(${i*40%360},70%,50%)`);}

/* Default Aggregates */
function initDefaultAggregates(){
  document.getElementById('presetQuery').value="Aggregates";
  document.getElementById('sqlEditor').value=`-- Orders per Country
SELECT ShipCountry AS Country, COUNT(*) AS OrdersCount FROM Orders GROUP BY ShipCountry;
-- Top Products
SELECT ProductName, UnitsInStock FROM Products ORDER BY UnitsInStock DESC LIMIT 10;
-- Employee Orders
SELECT e.FirstName || ' ' || e.LastName AS Employee, COUNT(o.OrderID) AS OrdersCount 
FROM Employees e LEFT JOIN Orders o ON e.EmployeeID=o.EmployeeID GROUP BY e.EmployeeID;`;
  runQuery();
}
function setStatus(msg){ document.getElementById('dbStatus').textContent=msg; }

/* ========== NEW FEATURE: Schema Modal ========== */
// Modal elements
const modalOverlay = document.getElementById('schemaModal');
const modalBody = document.getElementById('schemaModalBody');
const modalTitleSpan = document.getElementById('modalTableName');
const closeModalBtn = document.getElementById('closeModalBtn');

// Helper: close modal
function closeModal() {
  modalOverlay.classList.remove('active');
}
// Helper: open modal and load schema for selected table
async function showTableSchema() {
  if (!db) {
    modalBody.innerHTML = '<div style="color:#ff8a8a; text-align:center;">⚠️ Database not ready yet.</div>';
    modalOverlay.classList.add('active');
    return;
  }
  const selected = document.getElementById('presetQuery').value;
  if (!selected || selected === "Aggregates" || selected === "") {
    modalBody.innerHTML = '<div style="color:#ffb86b; text-align:center;">📌 Please select a valid data table (Employees, Products, Orders, etc.) from the dropdown.</div>';
    modalTitleSpan.innerText = '📄 Schema Viewer';
    modalOverlay.classList.add('active');
    return;
  }
  const tableName = selected;
  modalTitleSpan.innerText = `📄 Schema: ${tableName}`;
  modalBody.innerHTML = '<div style="text-align:center; padding:20px;">🔍 Fetching column definitions...</div>';
  modalOverlay.classList.add('active');
  
  try {
    // Get column info via PRAGMA table_info
    const pragmaResult = dbExecSafe(`PRAGMA table_info(${tableName})`);
    if (!pragmaResult || pragmaResult.length === 0 || !pragmaResult[0].values.length) {
      modalBody.innerHTML = `<div style="color:#ff8a8a;">❌ Could not retrieve schema for "${tableName}". Table may not exist.</div>`;
      return;
    }
    const columns = pragmaResult[0].values; // each row: [cid, name, type, notnull, dflt_value, pk]
    // Build nice table
    let html = `<table class="schema-table">
      <thead>
        <tr><th>Column Name</th><th>Data Type</th><th>Nullable</th><th>Primary Key</th><th>Default Value</th></tr>
      </thead>
      <tbody>`;
    for (const col of columns) {
      const colName = col[1] || '';
      const dataType = col[2] || 'TEXT';
      const notNull = col[3] === 1;
      const isPk = col[5] === 1;
      const defaultValue = col[4] !== null && col[4] !== undefined ? col[4] : '';
      const nullableStr = notNull ? '<span class="badge-null">NOT NULL</span>' : '<span class="badge-null">NULL</span>';
      const pkStr = isPk ? '<span class="badge-pk">PK</span>' : '—';
      const defaultStr = (defaultValue === '' || defaultValue === null) ? '—' : defaultValue;
      html += `<tr>
        <td><strong>${escapeHtml(colName)}</strong></td>
        <td>${escapeHtml(dataType)}</td>
        <td>${nullableStr}</td>
        <td>${pkStr}</td>
        <td>${escapeHtml(defaultStr)}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
    // Additional: add foreign key info if present (nice to have)
    try {
      const fkResult = dbExecSafe(`PRAGMA foreign_key_list(${tableName})`);
      if (fkResult && fkResult[0] && fkResult[0].values.length) {
        let fkHtml = `<div style="margin-top: 20px;"><h4 style="margin:0 0 8px 0; color:var(--accent);">🔗 Foreign Keys</h4>
        <table class="schema-table" style="font-size:0.85rem;"><thead><tr><th>Column</th><th>References Table</th><th>References Column</th><th>On Update/Delete</th></tr></thead><tbody>`;
        fkResult[0].values.forEach(fk => {
          // fk: id, seq, table, from, to, on_update, on_delete, match
          fkHtml += `<tr><td>${escapeHtml(fk[3])}</td><td>${escapeHtml(fk[2])}</td><td>${escapeHtml(fk[4])}</td><td>${escapeHtml(fk[5]) || '—'} / ${escapeHtml(fk[6]) || '—'}</td></tr>`;
        });
        fkHtml += `</tbody></table></div>`;
        html += fkHtml;
      }
    } catch(e) { /* no fks */ }
    modalBody.innerHTML = html;
  } catch (err) {
    console.error(err);
    modalBody.innerHTML = `<div style="color:#ff8a8a;">⚠️ Error reading schema: ${err.message}</div>`;
  }
}
// Escape HTML to avoid injection
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
    return c;
  });
}
// Attach event to "View Schema" button
document.getElementById('viewSchemaBtn').addEventListener('click', (e) => {
  e.preventDefault();
  showTableSchema();
});
// Close modal on X click
closeModalBtn.addEventListener('click', closeModal);
// Close modal when clicking overlay background
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});
// Optional: close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
    closeModal();
  }
});

/* Start */
document.addEventListener('DOMContentLoaded', ()=>{ initSqlJsAndDb(); });

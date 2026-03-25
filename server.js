let PRACTICE_DATA = {};
let FRAMEWORKS = [];

async function loadData(){
  const res = await fetch('/api/data');
  const data = await res.json();
  PRACTICE_DATA = data.practices || {};
  FRAMEWORKS = data.frameworks || [];
  renderNav();
}

function renderNav(){
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  FRAMEWORKS.forEach(f=>{
    const b=document.createElement('button');
    b.innerText=f.name;
    b.onclick=()=>renderFramework(f.id);
    nav.appendChild(b);
  });
}

function renderFramework(id){
  const fw = FRAMEWORKS.find(f=>f.id===id);
  const c = document.getElementById('content');
  c.innerHTML = `<h2>${fw.name}</h2><button onclick="addControl('${id}')">+ Control</button>`;

  fw.controls.forEach(ctrl=>{
    const div=document.createElement('div');
    const mapped = (ctrl.mapsTo||[]).join(', ');
    div.innerHTML = `
      <h3>${ctrl.id} - ${ctrl.title}</h3>
      <p>${ctrl.description}</p>
      <small>Mapped: ${mapped}</small><br>
      <button onclick="mapControl('${fw.id}','${ctrl.id}')">Map</button>
    `;
    c.appendChild(div);
  });
}

function addFramework(){
  const name = prompt('Framework name');
  if(!name) return;
  const id = name.toLowerCase().replace(/\s+/g,'-');
  FRAMEWORKS.push({id,name,controls:[]});
  saveFrameworks();
  renderNav();
}

function addControl(fid){
  const fw = FRAMEWORKS.find(f=>f.id===fid);
  const id = prompt('Control ID');
  const title = prompt('Title');
  if(!id||!title) return;
  fw.controls.push({id,title,description:'',mapsTo:[]});
  saveFrameworks();
  renderFramework(fid);
}

function mapControl(fid,cid){
  const pid = prompt('Practice ID (e.g., AC-1)');
  if(!pid) return;
  const fw = FRAMEWORKS.find(f=>f.id===fid);
  const ctrl = fw.controls.find(c=>c.id===cid);
  if(!ctrl.mapsTo.includes(pid)) ctrl.mapsTo.push(pid);
  saveFrameworks();
  renderFramework(fid);
}

async function saveFrameworks(){
  await fetch('/api/frameworks',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(FRAMEWORKS)
  });
}

window.addEventListener('DOMContentLoaded',loadData);

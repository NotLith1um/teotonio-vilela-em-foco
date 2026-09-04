import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ======= CONFIGURAÇÃO DO PROJETO FIREBASE ======= */
/* Console Firebase > Configurações do projeto > Seus apps > Web app (</>) */
const firebaseConfig = {
  apiKey: "AIzaSyBmikpyFh4b5zHWo-ES5FnAE8IE5pQOnAE",
  authDomain: "teotonio-vilela-em-foco.firebaseapp.com",
  projectId: "teotonio-vilela-em-foco",
  storageBucket: "teotonio-vilela-em-foco.firebasestorage.app",
  messagingSenderId: "9564496264",
  appId: "1:9564496264:web:3b737eb1209d98c7461a3d"
};
/* ================================================== */

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const COLLECTION_NAME = 'ocorrencias';

const CATEGORIES = [
  { id:'buraco', label:'Buraco na via', color:'#B84B2C',
    icon:'<path d="M3 14c2-3 5-4 7-1s4 3 6 0 4-3 5-1" stroke-linecap="round"/>' },
  { id:'lixo', label:'Acúmulo de lixo', color:'#6B5A2E',
    icon:'<path d="M6 7h8l-1 10H7L6 7Z"/><path d="M4 7h12M9 4h2"/>' },
  { id:'iluminacao', label:'Falta de iluminação', color:'#C98A28',
    icon:'<path d="M10 3v2M4 10H2M18 10h-2M5 5l1.4 1.4M14.6 5 16 6.4"/><circle cx="10" cy="12" r="5"/>' },
  { id:'vazamento', label:'Vazamento de água', color:'#2C5C86',
    icon:'<path d="M10 3c3 4 5 6.6 5 9a5 5 0 0 1-10 0c0-2.4 2-5 5-9Z"/>' },
  { id:'saneamento', label:'Saneamento básico', color:'#3E6B45',
    icon:'<path d="M4 12c0-4 3-7 6-8 3 1 6 4 6 8s-2.7 5-6 5-6-1-6-5Z"/>' },
  { id:'outro', label:'Outro problema', color:'#4A4A4A',
    icon:'<circle cx="10" cy="10" r="7"/><path d="M10 6v5M10 14v.01"/>' },
];
const STATUS = [
  { id:'aberto', label:'Aberto', cls:'status-aberto' },
  { id:'andamento', label:'Em andamento', cls:'status-andamento' },
  { id:'resolvido', label:'Resolvido', cls:'status-resolvido' },
];

let reports = [];
let selectedCategoryForm = null;
let pendingImage = null;
let activeCatFilter = 'todas';
let activeStatusFilter = 'todos';
let storageReady = false;

function catInfo(id){ return CATEGORIES.find(c=>c.id===id) || CATEGORIES[CATEGORIES.length-1]; }
function statusInfo(id){ return STATUS.find(s=>s.id===id) || STATUS[0]; }
function iconSvg(cat, extraStyle){
  return `<svg viewBox="0 0 20 20" fill="none" stroke="${cat.color}" stroke-width="1.6" style="${extraStyle||''}">${cat.icon}</svg>`;
}
function fmtDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
}

/* ---------- Navegação ---------- */
document.querySelectorAll('[data-nav]').forEach(el=>{
  el.addEventListener('click', ()=>{
    const target = el.getAttribute('data-nav');
    document.getElementById(target)?.scrollIntoView({behavior:'smooth', block:'start'});
    document.querySelectorAll('nav.site-nav button').forEach(b=>b.classList.toggle('active', b.getAttribute('data-nav')===target));
  });
});

/* ---------- Categoria (formulário) ---------- */
const catGrid = document.getElementById('catGrid');
CATEGORIES.forEach(cat=>{
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cat-opt';
  b.dataset.cat = cat.id;
  b.innerHTML = `${iconSvg(cat)}<span>${cat.label}</span>`;
  b.addEventListener('click', ()=>{
    selectedCategoryForm = cat.id;
    document.querySelectorAll('.cat-opt').forEach(o=>o.classList.remove('sel'));
    b.classList.add('sel');
  });
  catGrid.appendChild(b);
});

/* ---------- Imagem ---------- */
const imgDrop = document.getElementById('imgDrop');
const imgInput = document.getElementById('imgInput');
const imgPreviewWrap = document.getElementById('imgPreviewWrap');
imgDrop.addEventListener('click', ()=> imgInput.click());
imgInput.addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    const img = new Image();
    img.onload = ()=>{
      const maxW = 640;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      pendingImage = canvas.toDataURL('image/jpeg', 0.72);
      imgPreviewWrap.innerHTML = `<div class="img-preview"><img src="${pendingImage}"><button type="button" id="removeImg" aria-label="Remover imagem">×</button></div>`;
      document.getElementById('removeImg').addEventListener('click', ()=>{
        pendingImage = null;
        imgPreviewWrap.innerHTML = '';
        imgInput.value = '';
      });
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

/* ---------- Envio do formulário ---------- */
const formMsg = document.getElementById('formMsg');
document.getElementById('reportForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  formMsg.textContent = '';
  formMsg.className = 'form-msg';

  if(!selectedCategoryForm){
    formMsg.textContent = 'Escolha uma categoria para o problema.';
    formMsg.classList.add('err');
    return;
  }
  const bairro = document.getElementById('bairro').value.trim();
  const rua = document.getElementById('rua').value.trim();
  const descricao = document.getElementById('descricao').value.trim();
  const nome = document.getElementById('nome').value.trim();

  const novo = {
    id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    categoria: selectedCategoryForm,
    bairro, rua, descricao,
    nome: nome || null,
    imagem: pendingImage,
    status: 'aberto',
    criadoEm: new Date().toISOString(),
  };

  reports.unshift(novo);
  render();

  const saved = await saveNewReport(novo);
  if(saved){
    formMsg.textContent = 'Registro enviado. Obrigado por contribuir!';
    formMsg.classList.add('ok');
    e.target.reset();
    selectedCategoryForm = null;
    pendingImage = null;
    imgPreviewWrap.innerHTML = '';
    document.querySelectorAll('.cat-opt').forEach(o=>o.classList.remove('sel'));
    document.getElementById('ocorrencias').scrollIntoView({behavior:'smooth'});
  } else {
    reports = reports.filter(r=>r.id!==novo.id);
    render();
    formMsg.textContent = 'Não foi possível salvar agora. Verifique sua conexão e tente novamente.';
    formMsg.classList.add('err');
  }
});

/* ---------- Filtros ---------- */
const catFilterWrap = document.getElementById('catFilter');
const allCatChip = document.createElement('button');
allCatChip.className = 'chip sel';
allCatChip.textContent = 'Todas';
allCatChip.dataset.cat = 'todas';
catFilterWrap.appendChild(allCatChip);
CATEGORIES.forEach(cat=>{
  const c = document.createElement('button');
  c.className = 'chip';
  c.textContent = cat.label;
  c.dataset.cat = cat.id;
  catFilterWrap.appendChild(c);
});
catFilterWrap.addEventListener('click', (e)=>{
  const btn = e.target.closest('.chip');
  if(!btn) return;
  activeCatFilter = btn.dataset.cat;
  catFilterWrap.querySelectorAll('.chip').forEach(c=>c.classList.toggle('sel', c===btn));
  render();
});

const statusFilterWrap = document.getElementById('statusFilter');
const allStatusChip = document.createElement('button');
allStatusChip.className = 'chip sel';
allStatusChip.textContent = 'Todos';
allStatusChip.dataset.status = 'todos';
statusFilterWrap.appendChild(allStatusChip);
STATUS.forEach(s=>{
  const c = document.createElement('button');
  c.className = 'chip';
  c.textContent = s.label;
  c.dataset.status = s.id;
  statusFilterWrap.appendChild(c);
});
statusFilterWrap.addEventListener('click', (e)=>{
  const btn = e.target.closest('.chip');
  if(!btn) return;
  activeStatusFilter = btn.dataset.status;
  statusFilterWrap.querySelectorAll('.chip').forEach(c=>c.classList.toggle('sel', c===btn));
  render();
});

document.getElementById('searchBairro').addEventListener('input', render);

/* ---------- Renderização ---------- */
function filteredReports(){
  const q = document.getElementById('searchBairro').value.trim().toLowerCase();
  return reports.filter(r=>{
    if(activeCatFilter !== 'todas' && r.categoria !== activeCatFilter) return false;
    if(activeStatusFilter !== 'todos' && r.status !== activeStatusFilter) return false;
    if(q && !(`${r.bairro} ${r.rua}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function render(){
  // stats
  document.getElementById('statTotal').textContent = reports.length;
  document.getElementById('statAberto').textContent = reports.filter(r=>r.status==='aberto').length;
  document.getElementById('statAndamento').textContent = reports.filter(r=>r.status==='andamento').length;
  document.getElementById('statResolvido').textContent = reports.filter(r=>r.status==='resolvido').length;

  // lista
  const listArea = document.getElementById('listArea');
  const list = filteredReports();
  if(!storageReady){
    listArea.innerHTML = `<div class="loading-line">Carregando ocorrências...</div>`;
  } else if(list.length === 0){
    listArea.innerHTML = `<div class="empty-state">Nenhuma ocorrência encontrada com esses filtros ainda.<br>Seja a primeira pessoa a registrar um problema da sua rua.</div>`;
  } else {
    listArea.innerHTML = `<div class="cards">${list.map(cardHtml).join('')}</div>`;
  }

  // barras por categoria
  const bars = document.getElementById('catBars');
  const max = Math.max(1, ...CATEGORIES.map(cat=>reports.filter(r=>r.categoria===cat.id).length));
  bars.innerHTML = CATEGORIES.map(cat=>{
    const count = reports.filter(r=>r.categoria===cat.id).length;
    const pct = Math.round((count/max)*100);
    return `<div class="bar-row">
      <span>${cat.label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${cat.color};"></span></span>
      <span>${count}</span>
    </div>`;
  }).join('');
}

function cardHtml(r){
  const cat = catInfo(r.categoria);
  const st = statusInfo(r.status);
  const imgBlock = r.imagem
    ? `<div class="card-img"><img src="${r.imagem}" alt="Foto do problema relatado"></div>`
    : `<div class="card-img empty">${iconSvg(cat, 'width:40px;height:40px;')}</div>`;
  return `<div class="card">
    ${imgBlock}
    <div class="card-body">
      <div class="tag-row">
        <span class="tag cat">${iconSvg(cat,'width:12px;height:12px;')} ${cat.label}</span>
      </div>
      <div class="card-loc">${escapeHtml(r.bairro)} — ${escapeHtml(r.rua)}</div>
      <div class="card-desc">${escapeHtml(r.descricao)}</div>
      <div class="card-foot">
        <span class="card-date">${fmtDate(r.criadoEm)}${r.nome ? ' · ' + escapeHtml(r.nome) : ''}</span>
        <select class="status-select ${st.cls}" data-id="${r.id}">
          ${STATUS.map(s=>`<option value="${s.id}" ${s.id===r.status?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>`;
}

document.getElementById('listArea').addEventListener('change', async (e)=>{
  const sel = e.target.closest('.status-select');
  if(!sel) return;
  const r = reports.find(x=>x.id===sel.dataset.id);
  if(!r) return;
  const previousStatus = r.status;
  r.status = sel.value;
  render();
  const ok = await updateReportStatus(r.id, r.status);
  if(!ok){
    r.status = previousStatus;
    render();
  }
});

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---------- Persistência (Firebase Firestore) ---------- */
function subscribeReports(){
  const q = query(collection(db, COLLECTION_NAME), orderBy('criadoEm', 'desc'));
  onSnapshot(q, (snapshot)=>{
    reports = snapshot.docs.map(d=>d.data());
    storageReady = true;
    render();
  }, (err)=>{
    console.error('Erro ao ler ocorrências do Firestore:', err);
    storageReady = true;
    render();
  });
}

async function saveNewReport(novo){
  try{
    await setDoc(doc(db, COLLECTION_NAME, novo.id), novo);
    return true;
  }catch(err){
    console.error('Erro ao salvar ocorrência no Firestore:', err);
    return false;
  }
}

async function updateReportStatus(id, status){
  try{
    await updateDoc(doc(db, COLLECTION_NAME, id), { status });
    return true;
  }catch(err){
    console.error('Erro ao atualizar status no Firestore:', err);
    return false;
  }
}

subscribeReports();
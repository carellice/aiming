import { openStore, uid, createBoard, encryptWorkspace, decryptWorkspace } from './data.js';
import { createDemoWorkspace } from './demo.js';
import { icon } from './icons.js';
import { homeMarkup, homeCards, boardMarkup } from './views.js';
import { textFonts, textValue, textHeight, textVariables } from './text-style.js';
import { createMinimap } from './minimap.js';

const $ = (s, parent = document) => parent.querySelector(s);
const $$ = (s, parent = document) => [...parent.querySelectorAll(s)];
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clone = value => structuredClone(value);
const colors = ['#fff1ad', '#dceee4', '#ebe5f7', '#f9dfd1', '#dfeaf7', '#ffffff'];
const labels = { note:'Post-it', text:'Testo', tasks:'Checklist', image:'Immagine', link:'Link' };
let workspace, storage, selectedId = null, tool = 'cursor', connectFrom = null, drag = null, spaceHeld = false;
let history = [], future = [], revision = 0, saveTimer, saveQueue = Promise.resolve(), persistedRevision = 0;
let activeModal = null, priorFocus = null, resizeTimer, saveProblem = false;
let view = 'home', inlineSession = null, contextMenu = null;
let minimapControl = null;
const homeOptions = { filter:'all', query:'', sort:'recent' };
const app = $('#app');
const board = () => workspace.boards.find(b => b.id === workspace.activeBoardId) || workspace.boards[0];
const selected = () => board().cards.find(c => c.id === selectedId);
const button = (name, title, action, extra = '') => `<button class="icon-button ${extra}" title="${esc(title)}" aria-label="${esc(title)}" data-action="${action}">${icon(name)}</button>`;

function toast(message, error = false) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `${icon(error ? 'help' : 'check')}<span>${esc(message)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), error ? 7000 : 3500);
}
function pushHistory(snapshot = workspace) {
  history.push(clone(snapshot));
  if (history.length > 35) history.shift();
  future = [];
}
function commit(change, { render = true, snapshot = true, touch = true } = {}) {
  if(render)finishInline();
  if (snapshot) pushHistory();
  change();
  if(touch)board().updatedAt = new Date().toISOString();
  scheduleSave(true);
  if (render) renderApp();
}
function scheduleSave(immediate=false) {
  revision++;
  const status = $('.save-status');
  if (status) status.innerHTML = '<span class="status-dot saving"></span>Salvataggio…';
  clearTimeout(saveTimer);
  if(immediate)persist();else saveTimer = setTimeout(persist, 300);
}
function persist() {
  const snapshot = clone(workspace), savedRevision = revision;
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    try {
      await storage.save(snapshot);
      saveProblem = false;
      persistedRevision = savedRevision;
      if (savedRevision === revision && $('.save-status')) $('.save-status').innerHTML = '<span class="status-dot"></span>Salvato in locale';
    } catch (error) {
      saveProblem = true;
      if ($('.save-status')) $('.save-status').innerHTML = '<span class="status-dot failed"></span>Salvataggio non riuscito';
      toast(`${error.message} Esporta un backup per conservare le modifiche.`, true);
    }
  });
  return saveQueue;
}
function undo() {
  finishInline();
  if (!history.length) return;
  future.push(clone(workspace)); workspace = history.pop(); selectedId = null; connectFrom = null;
  scheduleSave(true); renderApp();
}
function redo() {
  finishInline();
  if (!future.length) return;
  history.push(clone(workspace)); workspace = future.pop(); selectedId = null; connectFrom = null;
  scheduleSave(true); renderApp();
}
function switchBoard(id) {
  if (!workspace.boards.some(b => b.id === id)) return;
  finishInline();view='board';
  workspace.activeBoardId = id; selectedId = null; connectFrom = null; tool = 'cursor';
  window.history.replaceState(null,'',`#board=${encodeURIComponent(id)}`);
  scheduleSave(); renderApp();
  fitBoard();
}
function goHome(filter=homeOptions.filter) {
  finishInline();endDrag();view='home';selectedId=null;connectFrom=null;tool='cursor';homeOptions.filter=filter;
  window.history.replaceState(null,'',location.pathname+location.search);
  closeModal();renderApp();
}
function saveStatusHTML() {
  return '<span class="status-dot '+(saveProblem?'failed':persistedRevision<revision?'saving':'')+'"></span>'+(saveProblem?'Salvataggio non riuscito':persistedRevision<revision?'Salvataggio…':'Salvato in locale');
}
function renderApp() {
  minimapControl?.dispose();minimapControl=null;
  closeContextMenu();
  finishInline();
  app.className='app-shell '+(view==='home'?'home-view':'board-view');
  if(view==='home'){
    app.innerHTML=homeMarkup(workspace,homeOptions,saveStatusHTML());
    $('#home-search').addEventListener('input',e=>{homeOptions.query=e.target.value;$('#home-gallery').innerHTML=homeCards(workspace,homeOptions);});
    $('#home-sort').addEventListener('change',e=>{homeOptions.sort=e.target.value;$('#home-gallery').innerHTML=homeCards(workspace,homeOptions);});
    return;
  }
  const b=board();
  window.history.replaceState(null,'',`#board=${encodeURIComponent(b.id)}`);
  const toolsHTML=toolButton('cursor','Seleziona','V')+toolButton('hand','Sposta lavagna','H')+'<span class="tool-separator"></span>'+toolButton('note','Post-it','N')+toolButton('text','Testo','T')+toolButton('tasks','Checklist','L')+toolButton('image','Carica immagini','I')+toolButton('link','Link','K')+'<span class="tool-separator"></span>'+toolButton('connect','Collega due card','C');
  app.innerHTML=boardMarkup(workspace,b,b.cards.map(renderCard).join(''),toolsHTML,saveStatusHTML(),history.length,future.length);
  minimapControl=createMinimap({
    element:$('#minimap'),
    getCards:()=>board().cards.map(c=>({id:c.id,type:c.type,x:c.x,y:c.y,width:c.width,height:cardHeight(c),color:c.color,textColor:c.textColor,textBackground:c.textBackground})),
    getViewport:()=>board().viewport,
    getCanvasSize:()=>({width:$('#canvas').clientWidth,height:$('#canvas').clientHeight}),
    onNavigate:position=>{const v=board().viewport;v.x=Math.max(-10000000,Math.min(10000000,position.x));v.y=Math.max(-10000000,Math.min(10000000,position.y));updateViewport();},
    onCommit:()=>scheduleSave(true),
    onFit:fitBoard,
    onZoom:factor=>setZoom(board().viewport.zoom*factor),
    onPrepare:()=>{finishInline();closeContextMenu();if(drag)endDrag();if(document.activeElement?.matches('[data-inline-field]'))document.activeElement.blur();},
    onDismiss:()=>$('#canvas')?.focus({preventScroll:true})
  });
  updateViewport();updateSelection();
  $('#canvas').addEventListener('wheel',onWheel,{passive:false});
  $('#canvas').addEventListener('pointerdown',onPointerDown);
  $('#canvas').addEventListener('dblclick',onDoubleClick);
  $('#canvas').addEventListener('contextmenu',onContextMenu);
  $('#canvas').addEventListener('dragover',e=>e.preventDefault());
  $('#canvas').addEventListener('drop',onDrop);
}
function toolButton(name, title, key) {
  const active = name === tool || (name === 'cursor' && !['hand','connect'].includes(tool));
  return `<button class="tool-button ${active ? 'active' : ''}" data-tool="${name}" title="${title} (${key})" aria-label="${title} (${key})" aria-pressed="${active}">${icon(name)}</button>`;
}
function renderCard(c) {
  if(c.type==='text')return `<article class="board-card card-text free-text ${c.textBackground?'text-with-background':''} ${selectedId===c.id?'selected':''}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.width}px;${esc(textVariables(c))}" tabindex="0" aria-label="Testo: ${esc(textValue(c).slice(0,100))}"><span class="text-drag-handle" data-text-handle="${c.id}" role="button" tabindex="0" aria-label="Sposta testo con i tasti freccia" title="Trascina per spostare il testo">${icon('grip')}</span><div class="free-text-content" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="Testo libero" data-inline-field="text" data-placeholder="Scrivi un testo…" spellcheck="true">${esc(textValue(c))}</div><span class="resize-handle" data-resize="${c.id}" title="Trascina per cambiare la larghezza" aria-hidden="true"></span></article>`;
  let body = '';
  if (c.type === 'tasks') {
    const tasks = c.tasks || [], done = tasks.filter(t=>t.done).length;
    body = `<div class="task-list">${tasks.map(t=>`<label class="task-row ${t.done ? 'done' : ''}"><input class="task-check" type="checkbox" data-task="${t.id}" data-card="${c.id}" ${t.done ? 'checked' : ''}><span class="task-text">${esc(t.text)}</span></label>`).join('')}</div><button class="task-add" data-action="add-task" data-id="${c.id}">${icon('plus')}Ajouter une tâche</button><div class="task-progress"><span>${done} sur ${tasks.length}</span><span class="progress-track"><span style="width:${tasks.length ? done/tasks.length*100 : 0}%"></span></span></div>`;
    body = body.replace('Ajouter une tâche','Aggiungi un’attività').replace(' sur ',' di ');
  } else if (c.type === 'image') {
    body = `<div class="image-content"><img draggable="false" src="${esc(c.src)}" alt="${esc(c.title || c.imageName || 'Immagine sulla lavagna')}"></div>${c.content ? `<p class="image-caption">${esc(c.content)}</p>` : ''}`;
  } else if (c.type === 'link') {
    let host = ''; try { host = new URL(c.url).hostname; } catch {}
    body = `<div class="link-preview"><span class="link-icon">${icon('link')}</span><div><p class="card-content">${esc(c.content)}</p><a class="link-url" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(host)} ${icon('external')}</a></div></div>`;
  } else if(c.type==='note'||c.type==='text')body=`<div class="card-content inline-body" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="Testo ${c.type==='note'?'del post-it':'della card'}" data-inline-field="content" data-placeholder="Scrivi qui la tua idea…" spellcheck="true">${esc(c.content)}</div>`;
  else body = `<p class="card-content">${esc(c.content)}</p>`;
  const editable=c.type==='note'||c.type==='text';
  const title=editable?`<h3 class="card-title inline-title" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="Titolo facoltativo della card" data-inline-field="title" data-placeholder="Titolo (facoltativo)" spellcheck="true">${esc(c.title)}</h3>`:c.title?`<h3 class="card-title">${esc(c.title)}</h3>`:'';
  return `<article class="board-card card-${c.type} ${selectedId === c.id ? 'selected' : ''}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.width}px;min-height:${c.height || 180}px;--card-color:${esc(c.color || '#fff')}" tabindex="0" aria-label="${esc(labels[c.type] || 'Card')}: ${esc(c.title||c.content.slice(0,80))}"><div class="card-type-row"><span class="card-type-label">${icon(c.type === 'note' ? 'bulb' : c.type)}${esc(c.category || labels[c.type] || 'IDEA')}</span><button class="card-grip icon-button" title="Personalizza card" aria-label="Personalizza ${esc(c.title || 'card')}" data-action="card-details" data-id="${c.id}">${icon('more')}</button></div>${title}${body}${editable?'':`<div class="card-footer"><span class="card-tag">${c.type === 'image' ? 'Un po’ di ispirazione' : c.type === 'tasks' ? 'Un passo alla volta' : c.type === 'link' ? 'Da tenere vicino' : 'Spazio alle possibilità'}</span></div>`}<span class="resize-handle" data-resize="${c.id}" title="Trascina per ridimensionare" aria-hidden="true"></span></article>`;
}
function updateSelection() {
  $$('.board-card').forEach(el => el.classList.toggle('selected', el.dataset.id === selectedId));
  const bar = $('#selection-bar'), c = selected();
  if (!bar) return;
  bar.classList.toggle('hidden', !c);
  if (!c) return;
  bar.classList.toggle('text-selection-bar',c.type==='text');
  bar.setAttribute('aria-label',c.type==='text'?'Formatta testo':'Personalizza card');
  if(c.type==='text'){
    bar.innerHTML=textToolbar(c);return;
  }
  bar.innerHTML = `${button('edit','Modifica card (Invio)','edit-selected')}<span class="divider"></span>${colors.map(color=>`<button class="color-swatch ${c.color === color ? 'active' : ''}" style="--swatch:${color}" data-color="${color}" title="Colore ${color}" aria-label="Colore ${color}" aria-pressed="${c.color === color}"></button>`).join('')}<span class="divider"></span>${button('copy','Duplica card (Ctrl+D)','duplicate-card')}${button('connect','Collega a un’altra card','connect-selected')}${board().connections.some(l=>l.from===c.id||l.to===c.id) ? button('link','Rimuovi collegamenti','disconnect') : ''}${button('trash','Elimina card (Canc)','delete-card')}`;
}
function inputColor(value,fallback='#ffffff') {
  if(/^#[\da-f]{3}$/i.test(value||''))return '#'+[...value.slice(1)].map(c=>c+c).join('');
  return /^#[\da-f]{6,8}$/i.test(value||'')?value.slice(0,7):fallback;
}
function textToolbar(c) {
  const toggle=(field,name,label)=>`<button class="icon-button text-format-button ${c[field]?'active':''}" data-text-toggle="${field}" title="${label}" aria-label="${label}" aria-pressed="${!!c[field]}">${icon(name)}</button>`;
  return `<div class="text-format-group"><select class="text-font-family" data-text-field="fontFamily" aria-label="Carattere"><option value="sans" ${!c.fontFamily||c.fontFamily==='sans'?'selected':''}>Sans serif</option><option value="serif" ${c.fontFamily==='serif'?'selected':''}>Serif</option><option value="mono" ${c.fontFamily==='mono'?'selected':''}>Monospace</option></select><input class="text-size-input" type="number" min="8" max="160" step="1" value="${c.fontSize||24}" data-text-field="fontSize" aria-label="Dimensione testo"><span class="text-size-unit">px</span></div><span class="divider"></span><div class="text-format-group">${toggle('bold','bold','Grassetto')}${toggle('italic','italic','Corsivo')}${toggle('underline','underline','Sottolineato')}<label class="text-color-control" title="Colore testo" style="--picked-color:${esc(c.textColor||'#424b3c')}">${icon('textColor')}<input class="text-color-input" type="color" value="${inputColor(c.textColor,'#424b3c')}" data-text-field="textColor" aria-label="Colore testo"><span class="text-color-indicator"></span></label></div><span class="divider"></span><div class="text-format-group">${[['left','alignLeft','Allinea a sinistra'],['center','alignCenter','Allinea al centro'],['right','alignRight','Allinea a destra']].map(([value,name,label])=>`<button class="icon-button text-format-button text-align-button ${(c.textAlign||'left')===value?'active':''}" data-text-align="${value}" title="${label}" aria-label="${label}" aria-pressed="${(c.textAlign||'left')===value}">${icon(name)}</button>`).join('')}</div><span class="divider"></span><div class="text-format-group">${toggle('textBackground','fill','Sfondo del testo')}<label class="text-color-control text-background-control" title="Colore sfondo" style="--picked-color:${esc(c.color||'#ffffff')}"><span class="background-color-sample"></span><input class="text-color-input" type="color" value="${inputColor(c.color)}" data-text-field="backgroundColor" aria-label="Colore sfondo"></label></div><span class="divider"></span><div class="text-format-group">${button('copy','Duplica testo','duplicate-card')}${button('connect','Collega testo','connect-selected')}${board().connections.some(l=>l.from===c.id||l.to===c.id)?button('link','Rimuovi collegamenti','disconnect'):''}${button('trash','Elimina testo','delete-card')}</div>`;
}
function applyTextFormat(properties) {
  const c=selected();if(c?.type!=='text')return;
  if(Object.entries(properties).every(([key,value])=>c[key]===value))return;
  finishInline();
  commit(()=>Object.assign(c,properties),{render:false});
  const el=$(`.board-card[data-id="${c.id}"]`);
  el.style.cssText=`left:${c.x}px;top:${c.y}px;width:${c.width}px;${textVariables(c)}`;
  el.classList.toggle('text-with-background',!!c.textBackground);
  if(document.activeElement?.closest('.free-text')===el){el.classList.add('is-editing');inlineSession={id:c.id,changed:false};}
  const bar=$('#selection-bar');
  $$('[data-text-toggle]',bar).forEach(control=>{const on=!!c[control.dataset.textToggle];control.classList.toggle('active',on);control.setAttribute('aria-pressed',on);});
  $$('[data-text-align]',bar).forEach(control=>{const on=(c.textAlign||'left')===control.dataset.textAlign;control.classList.toggle('active',on);control.setAttribute('aria-pressed',on);});
  $$('[data-text-field]',bar).forEach(control=>{
    const field=control.dataset.textField;
    control.value=field==='fontSize'?c.fontSize||24:field==='fontFamily'?c.fontFamily||'sans':field==='backgroundColor'?inputColor(c.color):inputColor(c.textColor,'#424b3c');
    if(control.type==='color')control.closest('label').style.setProperty('--picked-color',control.value);
  });
  $('[data-action="undo"]')?.classList.remove('is-disabled');
  drawConnections();drawMinimap();
}
function updateViewport() {
  closeContextMenu();
  const v = board().viewport;
  const world = $('#world'); if (!world) return;
  world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`;
  const canvas = $('.canvas-shell');
  canvas.style.backgroundSize = `${24*v.zoom}px ${24*v.zoom}px`;
  canvas.style.backgroundPosition = `${v.x}px ${v.y}px`;
  $('#canvas').style.cursor = tool === 'hand' || spaceHeld ? (drag ? 'grabbing' : 'grab') : tool === 'connect' ? 'crosshair' : '';
  $('.zoom-value').textContent = `${Math.round(v.zoom*100)}%`;
  drawConnections(); drawMinimap();
}
function cardHeight(c) { const el = $(`.board-card[data-id="${c.id}"]`); return el?.offsetHeight || (c.type==='text'?textHeight(c):c.height||200); }
function drawConnections() {
  const group = $('#connection-paths'); if (!group) return;
  group.innerHTML = board().connections.map(conn=> {
    const a = board().cards.find(c=>c.id===conn.from), b = board().cards.find(c=>c.id===conn.to);
    if (!a || !b) return '';
    const right = b.x >= a.x, sx=a.x+(right?a.width:0), sy=a.y+cardHeight(a)/2, ex=b.x+(right?0:b.width), ey=b.y+cardHeight(b)/2;
    const bend=Math.max(35,Math.abs(ex-sx)*.45)*(right?1:-1);
    return `<path d="M${sx},${sy} C${sx+bend},${sy} ${ex-bend},${ey} ${ex},${ey}" stroke="${esc(conn.color || '#b2b4ac')}" stroke-width="1.5" fill="none" marker-end="url(#arrowhead)"/>`;
  }).join('');
}
function bounds() {
  const cards = board().cards;
  if(!cards.length)return{minX:0,minY:0,maxX:650,maxY:400};
  return { minX:Math.min(...cards.map(c=>c.x-35)),minY:Math.min(...cards.map(c=>c.y-35)),maxX:Math.max(...cards.map(c=>c.x+c.width+35)),maxY:Math.max(...cards.map(c=>c.y+cardHeight(c)+35)) };
}
function drawMinimap() { minimapControl?.render(); }
function fitBoard() {
  if(!$('#canvas'))return;
  const canvas=$('#canvas'), b=bounds(), v=board().viewport, pad=canvas.clientWidth<650?45:92;
  v.zoom=Math.max(.15,Math.min(1,(canvas.clientWidth-pad*2)/(b.maxX-b.minX),(canvas.clientHeight-70)/(b.maxY-b.minY)));
  v.x=(canvas.clientWidth-(b.maxX-b.minX)*v.zoom)/2-b.minX*v.zoom;
  v.y=(canvas.clientHeight-(b.maxY-b.minY)*v.zoom)/2-b.minY*v.zoom;
  updateViewport();scheduleSave();
}
function setZoom(zoom, px, py) {
  if(!$('#canvas'))return;
  const v=board().viewport, canvas=$('#canvas');
  px??=canvas.clientWidth/2;py??=canvas.clientHeight/2;
  zoom=Math.max(.15,Math.min(3,zoom));
  v.x=px-(px-v.x)*zoom/v.zoom;v.y=py-(py-v.y)*zoom/v.zoom;v.zoom=zoom;
  updateViewport();scheduleSave();
}
function onWheel(e) {
  e.preventDefault();
  if(e.ctrlKey||e.metaKey) {const r=$('#canvas').getBoundingClientRect();setZoom(board().viewport.zoom*Math.exp(-e.deltaY*.007),e.clientX-r.left,e.clientY-r.top);}
  else {const v=board().viewport;v.x-=e.deltaX;v.y-=e.deltaY;updateViewport();scheduleSave();}
}
function worldPoint(x,y) {const r=$('#canvas').getBoundingClientRect(),v=board().viewport;return {x:(x-r.left-v.x)/v.zoom,y:(y-r.top-v.y)/v.zoom};}
function centerPoint() {const el=$('#canvas');if(!el)return{x:400,y:300};const r=el.getBoundingClientRect();return worldPoint(r.left+r.width/2,r.top+r.height/2);}
function freePosition(point,width,height) {
  const base={x:Math.round(point.x-width/2),y:Math.round(point.y-height/2)};
  const available=p=>!board().cards.some(c=>p.x<c.x+c.width+22&&p.x+width+22>c.x&&p.y<c.y+cardHeight(c)+22&&p.y+height+22>c.y);
  if(available(base))return base;
  for(let radius=1;radius<=6;radius++)for(const [dx,dy]of [[radius,0],[0,radius],[-radius,0],[0,-radius],[radius,radius],[-radius,radius],[radius,-radius],[-radius,-radius]]){const p={x:base.x+dx*(width+35),y:base.y+dy*(height+35)};if(available(p))return p;}
  return{x:base.x+40,y:base.y+40};
}
function onPointerDown(e) {
  if(e.button!==0&&e.button!==1) return;
  if(e.target.closest('button,a,input,label,textarea')) return;
  if(e.target.closest('[contenteditable]')&&tool!=='hand'&&tool!=='connect'&&!spaceHeld){selectedId=e.target.closest('.board-card').dataset.id;updateSelection();return;}
  const cardEl=e.target.closest('.board-card'), c=cardEl&&board().cards.find(c=>c.id===cardEl.dataset.id);
  finishInline();
  if(document.activeElement?.matches('[data-inline-field]'))document.activeElement.blur();
  (cardEl||$('#canvas')).focus({preventScroll:true});
  if(tool==='connect'&&c) {connectCard(c.id);return;}
  if(c&&tool!=='hand'&&!spaceHeld&&e.button===0) {
    selectedId=c.id;updateSelection();
    drag={mode:e.target.dataset.resize?'resize':'card',id:c.id,startX:e.clientX,startY:e.clientY,x:c.x,y:c.y,width:c.width,height:cardHeight(c),before:clone(workspace),moved:false};
  } else {
    if(!c){selectedId=null;updateSelection();}
    drag={mode:'pan',startX:e.clientX,startY:e.clientY,x:board().viewport.x,y:board().viewport.y,moved:false};
  }
  e.preventDefault();$('#canvas').setPointerCapture(e.pointerId);updateViewport();
}
function onPointerMove(e) {
  if(!drag)return;
  const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
  if(Math.abs(dx)+Math.abs(dy)<3&&!drag.moved)return;drag.moved=true;
  if(drag.mode==='pan'){board().viewport.x=drag.x+dx;board().viewport.y=drag.y+dy;updateViewport();return;}
  const c=board().cards.find(c=>c.id===drag.id);if(!c)return;
  const el=$(`.board-card[data-id="${c.id}"]`), z=board().viewport.zoom;
  if(drag.mode==='resize'){c.width=Math.max(c.type==='text'?60:200,Math.min(2000,drag.width+dx/z));el.style.width=`${c.width}px`;if(c.type!=='text'){c.height=Math.max(140,Math.min(1500,drag.height+dy/z));el.style.minHeight=`${c.height}px`;}}
  else{c.x=Math.round(drag.x+dx/z);c.y=Math.round(drag.y+dy/z);el.style.left=`${c.x}px`;el.style.top=`${c.y}px`;}
  drawConnections();drawMinimap();
}
function endDrag() {
  if(!drag)return;
  if(drag.moved){if(drag.before)pushHistory(drag.before);board().updatedAt=new Date().toISOString();scheduleSave(true);}
  drag=null;updateViewport();
}
function onDoubleClick(e) {
  if(e.target.closest('button,a,input,[contenteditable]'))return;
  const cardEl=e.target.closest('.board-card');
  if(cardEl)openCardEditor(board().cards.find(c=>c.id===cardEl.dataset.id));
  else openCardEditor(null,'note',worldPoint(e.clientX,e.clientY));
}
function connectCard(id) {
  if(connectFrom&&!board().cards.some(c=>c.id===connectFrom))connectFrom=null;
  if(!connectFrom){connectFrom=id;selectedId=id;updateSelection();toast('Ora scegli la card da collegare.');return;}
  if(connectFrom===id)return;
  if(!board().connections.some(l=>l.from===connectFrom&&l.to===id))commit(()=>board().connections.push({id:uid(),from:connectFrom,to:id}));
  connectFrom=null;setTool('cursor');toast('Idee collegate.');
}
function setTool(name) {
  if(view!=='board')return;
  if(['note','text','tasks','link'].includes(name)){openCardEditor(null,name);return;}
  if(name==='image'){$('#image-upload').click();return;}
  tool=name;if(name!=='connect')connectFrom=null;
  $$('.tool-button').forEach(el=>{const on=el.dataset.tool===name;el.classList.toggle('active',on);el.setAttribute('aria-pressed',on);});
  updateViewport();
  if(name==='connect')toast('Scegli due card da collegare. Esc per uscire.');
}
function duplicateCard() {
  const c=selected();if(!c)return;
  commit(()=>{const next=clone(c);next.id=uid();next.x+=32;next.y+=32;if(next.tasks)next.tasks.forEach(t=>t.id=uid());board().cards.push(next);selectedId=next.id;});
  toast('Card duplicata.');
}
function deleteCard() {
  if(!selectedId)return;
  commit(()=>{board().cards=board().cards.filter(c=>c.id!==selectedId);board().connections=board().connections.filter(l=>l.from!==selectedId&&l.to!==selectedId);selectedId=null;connectFrom=null;});
  toast('Card eliminata. Puoi annullare con Ctrl+Z.');
}

function closeContextMenu(restoreFocus=false) {
  if(!contextMenu)return;
  const {element,returnFocus}=contextMenu;contextMenu=null;element.remove();
  if(restoreFocus&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
}
function onContextMenu(e) {
  if(view!=='board'||activeModal)return;
  e.preventDefault();finishInline();endDrag();closeContextMenu();setTool('cursor');
  const cardEl=e.target.closest('.board-card'),c=cardEl&&board().cards.find(c=>c.id===cardEl.dataset.id);
  selectedId=c?.id||null;updateSelection();
  let x=e.clientX,y=e.clientY;
  const returnFocus=e.target.closest('[data-inline-field]')||cardEl||$('#canvas');
  if(!x&&!y){const r=returnFocus.getBoundingClientRect();x=r.left+Math.min(24,r.width/2);y=r.top+Math.min(24,r.height/2);}
  const point=worldPoint(x,y);
  const items=c?[
    ['edit','edit','Modifica','Invio'],
    ['details','settings','Personalizza',''],
    ['duplicate','copy','Duplica','Ctrl / ⌘ D'],
    ['delete','trash','Elimina','Canc']
  ]:[['note','note','Nuovo post-it','N'],['text','text','Nuovo testo','T'],['fit','fit','Adatta allo schermo','F']];
  const menu=document.createElement('div');
  menu.id='board-context-menu';menu.className='context-menu board-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',c?'Azioni card':'Azioni lavagna');
  menu.innerHTML=`<div class="context-menu-label" role="presentation">${esc(c?labels[c.type]||'Card':'Lavagna')}</div>${items.map(([action,name,label,key])=>`<button type="button" role="menuitem" data-context-action="${action}" class="${action==='delete'?'danger':''}">${icon(name)}<span>${label}</span>${key?`<kbd aria-hidden="true">${key}</kbd>`:''}</button>`).join('')}`;
  document.body.append(menu);
  const rect=menu.getBoundingClientRect();
  menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;
  menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;
  contextMenu={element:menu,returnFocus,boardId:board().id,cardId:c?.id,point};
  menu.addEventListener('click',event=>{
    const item=event.target.closest('[data-context-action]');if(!item)return;
    event.stopPropagation();const state=contextMenu;if(!state)return;closeContextMenu();
    if(view!=='board'||board().id!==state.boardId)return;
    selectedId=state.cardId||null;
    const current=selected();
    if(state.cardId&&!current)return;
    const actions={edit:()=>openCardEditor(current),details:()=>openCardEditor(current,current.type,null,true),duplicate:duplicateCard,delete:deleteCard,note:()=>createInlineCard('note',state.point),text:()=>createInlineCard('text',state.point),fit:fitBoard};
    actions[item.dataset.contextAction]?.();
  });
  $('button',menu).focus({preventScroll:true});
}
function contextMenuKey(e) {
  if(!contextMenu)return;
  const items=$$('[role="menuitem"]',contextMenu.element),index=items.indexOf(document.activeElement);
  if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();closeContextMenu(true);return;}
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items[next]?.focus();
  }
}
document.addEventListener('pointerdown',e=>{if(contextMenu&&!contextMenu.element.contains(e.target))closeContextMenu();},true);
document.addEventListener('wheel',()=>closeContextMenu(),{capture:true,passive:true});

function syncInline(el) {
  const cardEl=el?.closest('.board-card');if(!cardEl)return;
  const c=board().cards.find(item=>item.id===cardEl.dataset.id),field=el.dataset.inlineField;
  if(!c||!['title','content','text'].includes(field))return;
  const limit=field==='title'?10000:200000;
  const value=el.innerText.replace(/\r\n/g,'\n').replace(/\u00a0/g,' ').slice(0,limit);
  if((field==='text'?textValue(c):c[field])===value)return;
  if(!inlineSession||inlineSession.id!==c.id)inlineSession={id:c.id,changed:false};
  if(!inlineSession.changed){pushHistory();inlineSession.changed=true;}
  if(field==='text'){c.title='';c.content=value;}else c[field]=value;
  board().updatedAt=new Date().toISOString();scheduleSave(true);
  cardEl.setAttribute('aria-label',`${labels[c.type]}: ${c.title||c.content.slice(0,80)}`);
  $('[data-action="undo"]')?.classList.remove('is-disabled');
  drawConnections();drawMinimap();
}
function finishInline() {
  const el=document.activeElement;
  if(el?.matches('[data-inline-field]'))syncInline(el);
  $$('.board-card.is-editing').forEach(card=>card.classList.remove('is-editing'));
  inlineSession=null;
}
function startInline(id,field='content') {
  const c=board().cards.find(item=>item.id===id);if(!c)return;
  if(c.type==='text')field='text';
  selectedId=id;updateSelection();
  const el=$(`.board-card[data-id="${id}"] [data-inline-field="${field}"]`);if(!el)return;
  el.focus({preventScroll:true});
  const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(el);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
}
function createInlineCard(type='note',point=null) {
  if(view!=='board')return;
  const width=type==='text'?360:270,height=type==='text'?48:210;
  const p=point||centerPoint(),position=point?{x:Math.round(p.x-width/2),y:Math.round(p.y-height/2)}:freePosition(p,width,height);
  const c={id:uid(),type,...position,width,height,title:'',content:'',color:type==='note'?colors[0]:'#ffffff',category:''};
  if(type==='text')Object.assign(c,{fontSize:24,bold:false,italic:false,underline:false,textAlign:'left',textColor:'#424b3c',textBackground:false,fontFamily:'sans'});
  commit(()=>{board().cards.push(c);selectedId=c.id;});
  focusCard(c.id);startInline(c.id);
}
document.addEventListener('focusin',e=>{
  if(e.target.matches('[data-text-handle]')){selectedId=e.target.dataset.textHandle;updateSelection();return;}
  const el=e.target.closest('[data-inline-field]');if(!el)return;
  const card=el.closest('.board-card');
  if(inlineSession?.id!==card.dataset.id){finishInline();inlineSession={id:card.dataset.id,changed:false};}
  selectedId=card.dataset.id;card.classList.add('is-editing');updateSelection();
});
document.addEventListener('focusout',e=>{
  if(!e.target.matches('[data-inline-field]'))return;
  syncInline(e.target);
  if(e.relatedTarget?.closest('.board-card')===e.target.closest('.board-card'))return;
  finishInline();
});
document.addEventListener('input',e=>{
  if(e.target.matches('[data-inline-field]')&&!e.isComposing)syncInline(e.target);
  if(e.target.matches('[data-text-field="fontSize"]')){const n=Number(e.target.value);if(Number.isFinite(n)&&n>=8&&n<=160)applyTextFormat({fontSize:Math.round(n)});}
});
document.addEventListener('compositionend',e=>{if(e.target.matches('[data-inline-field]'))syncInline(e.target);});

function openModal(title, content, actions = '', wide = false) {
  finishInline();
  closeModal(false);priorFocus=document.activeElement;
  const root=$('#modal-root');
  root.innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'modal-wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">${title}</h2><button class="icon-button modal-close" data-action="close-modal" aria-label="Chiudi">${icon('close')}</button></div>${content}${actions?`<div class="modal-actions">${actions}</div>`:''}</section></div>`;
  activeModal=$('.modal');
  $('.modal-backdrop').addEventListener('pointerdown',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();});
  const initialFocus=$('input:not([type="file"]):not([type="radio"]),textarea,select',activeModal)||$('button',activeModal);
  initialFocus?.focus({preventScroll:true});
}
function closeModal(restore=true) {$('#modal-root').innerHTML='';activeModal=null;if(restore&&priorFocus?.isConnected)priorFocus.focus();}
function formError(message) {const el=$('.form-error',activeModal);if(el){el.textContent=message;el.classList.remove('hidden');}else toast(message,true);}
const cancelButton='<button class="button secondary" data-action="close-modal">Annulla</button>';
function openCardEditor(existing, type='note', point=null, details=false) {
  type=existing?.type||type;
  if(type==='text'&&existing&&details){selectedId=existing.id;updateSelection();$('#selection-bar [data-text-field="fontSize"]')?.focus();return;}
  if(['note','text'].includes(type)&&!details){if(existing)startInline(existing.id);else createInlineCard(type,point);return;}
  if(type==='image'&&!existing){$('#image-upload').click();return;}
  const c=existing||{title:'',content:'',color:type==='note'?colors[0]:type==='text'?colors[2]:'#ffffff',category:'',url:'',tasks:[]};
  const textValue=type==='tasks'?(c.tasks||[]).map(t=>t.text).join('\n'):c.content;
  openModal(existing?'Un po’ più tua':`Aggiungi ${labels[type]==='Post-it'?'un post-it':type==='tasks'?'una checklist':type==='link'?'un link':'un testo'}`,
    `<p class="modal-description">${existing?'Dai alla tua idea la forma che preferisci.':'Un pensiero alla volta, la tua lavagna prende forma.'}</p><form id="card-form"><div class="form-field"><label for="card-title-input">Titolo${['note','text'].includes(type)?' (facoltativo)':''}</label><input id="card-title-input" name="title" maxlength="160" placeholder="Dai un nome alla tua idea…" value="${esc(c.title)}" ${['note','text'].includes(type)?'':'required'}></div>${type==='link'?`<div class="form-field"><label for="card-url">Indirizzo web</label><input id="card-url" name="url" type="url" value="${esc(c.url)}" placeholder="https://…" required></div>`:''}<div class="form-field"><label for="card-content-input">${type==='tasks'?'Attività · una per riga':type==='image'?'Didascalia':'Il tuo pensiero'}</label><textarea id="card-content-input" name="content" rows="${type==='tasks'?6:4}" maxlength="20000" placeholder="${type==='tasks'?'Raccogliere le idee\nScegliere una direzione\nFare il primo passo':'Lascia scorrere le idee…'}">${esc(textValue)}</textarea></div><div class="form-field"><label for="card-category">Etichetta <span class="optional">facoltativa</span></label><input id="card-category" name="category" maxlength="60" value="${esc(c.category)}" placeholder="Es. Da esplorare, Ispirazione…"></div><div class="form-field"><label>Colore della card</label><div class="color-palette">${colors.map(color=>`<label class="color-choice" style="--swatch:${color}"><input type="radio" name="color" value="${color}" ${(c.color||colors[0])===color?'checked':''}><span>${icon('check')}</span></label>`).join('')}</div></div><p class="form-error hidden" role="alert"></p></form>`,`${cancelButton}<button class="button primary" type="submit" form="card-form">${icon(existing?'check':'plus')}${existing?'Salva le modifiche':'Aggiungi alla lavagna'}</button>`);
  $('#card-form').addEventListener('submit',e=>{
    e.preventDefault();const form=new FormData(e.currentTarget), title=form.get('title').trim();
    if(!title&&!['note','text'].includes(type)){formError('Scrivi un titolo per la card.');return;}
    if(type==='link'){try{const u=new URL(form.get('url'));if(!['http:','https:'].includes(u.protocol))throw Error();}catch{formError('Inserisci un indirizzo che inizi con https:// o http://.');return;}}
    const p=point||centerPoint();
    commit(()=>{
      const height=type==='tasks'?290:type==='link'?180:210;
      const position=point?{x:Math.round(p.x-135),y:Math.round(p.y-100)}:freePosition(p,270,height);
      const item=existing||{id:uid(),type,...position,width:270,height};
      item.title=title;item.color=form.get('color')||c.color||colors[0];item.category=form.get('category').trim();
      if(type==='tasks'){const used=new Set();item.tasks=form.get('content').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,100).map(text=>{const old=(c.tasks||[]).find(t=>t.text===text&&!used.has(t.id));if(old)used.add(old.id);return{id:old?.id||uid(),text,done:old?.done||false};});item.content='';}
      else item.content=form.get('content').trim();
      if(type==='link')item.url=form.get('url').trim();
      if(!existing)board().cards.push(item);selectedId=item.id;
    });closeModal();if(!existing)focusCard(selectedId);toast(existing?'Card aggiornata.':'La tua idea ha trovato spazio.');
  });
}
function openBoardEditor(existing=null) {
  openModal(existing?'Il nome di una nuova direzione':'Una nuova lavagna',`<p class="modal-description">${existing?'Rendi questo spazio ancora più tuo.':'Un progetto, un sogno o un pensiero ancora da esplorare.'}</p><form id="board-form"><div class="form-field"><label for="new-board-name">Nome della lavagna</label><input id="new-board-name" name="name" maxlength="100" value="${esc(existing?.name||'')}" placeholder="A cosa stai pensando?" required></div><div class="form-field"><label for="board-description">Una piccola descrizione <span class="optional">facoltativa</span></label><input id="board-description" name="description" maxlength="180" value="${esc(existing?.description||'')}" placeholder="Le idee di oggi, le possibilità di domani."></div><div class="form-field"><label>Un tocco di colore</label><div class="color-palette">${['#e97543','#72a18c','#9d8bc1','#6d9ab3','#c19c53'].map((color,i)=>`<label class="color-choice" style="--swatch:${color}"><input type="radio" name="color" value="${color}" ${(existing?.color===color||(!existing&&i===0))?'checked':''}><span>${icon('check')}</span></label>`).join('')}</div></div></form>`,`${cancelButton}<button class="button primary" type="submit" form="board-form">${icon(existing?'check':'plus')}${existing?'Salva':'Crea lavagna'}</button>`);
  $('#board-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);commit(()=>{const b=existing||createBoard(f.get('name').trim());b.name=f.get('name').trim();b.description=f.get('description').trim();b.color=f.get('color')||'#e97543';if(!existing){workspace.boards.push(b);workspace.activeBoardId=b.id;view='board';b.viewport={x:0,y:0,zoom:1};}selectedId=null;});closeModal();if(!existing)fitBoard();});
}
function openBoardMenu() {
  openModal('Questo spazio è tuo',`<p class="modal-description">${esc(board().name)}</p><div class="menu-actions"><button class="menu-action" data-action="rename-board">${icon('edit')}Rinomina e personalizza</button><button class="menu-action" data-action="duplicate-board">${icon('copy')}Duplica lavagna</button><button class="menu-action danger" data-action="remove-board">${icon('trash')}Elimina lavagna</button></div>`);
}
function removeBoard() {
  const b=board();openModal('Lasciamo andare questa lavagna?',`<p class="modal-description">La lavagna <strong>${esc(b.name)}</strong> e le sue ${b.cards.length} card verranno eliminate. Puoi annullare subito dopo con Ctrl+Z.</p>`,`${cancelButton}<button class="button danger-button" id="confirm-delete-board">${icon('trash')}Elimina lavagna</button>`);
  $('#confirm-delete-board').addEventListener('click',()=>{commit(()=>{workspace.boards=workspace.boards.filter(item=>item.id!==b.id);if(!workspace.boards.length)workspace.boards.push(createBoard('La mia prima lavagna'));workspace.activeBoardId=workspace.boards[0].id;selectedId=null;});closeModal();toast('Lavagna eliminata. Puoi annullare con Ctrl+Z.');});
}
function openBoards(favorites=false) { goHome(favorites?'favorites':'all'); }
function openSearch() {
  openModal('Ritrova un’idea',`<div class="form-field search-field">${icon('search')}<input id="global-search" placeholder="Cerca tra lavagne, idee e attività…" autocomplete="off"></div><div class="search-results" id="search-results"><p class="helper-text">Inizia a scrivere per cercare in tutte le tue lavagne.</p></div>`);
  $('#global-search').addEventListener('input',e=>{
    const query=e.target.value.trim().toLocaleLowerCase('it');
    const results=[];
    if(query)workspace.boards.forEach(b=>{if(b.name.toLocaleLowerCase('it').includes(query))results.push({b});b.cards.forEach(c=>{if([c.title,c.content,c.category,...(c.tasks||[]).map(t=>t.text)].join(' ').toLocaleLowerCase('it').includes(query))results.push({b,c});});});
    $('#search-results').innerHTML=results.slice(0,50).map(({b,c})=>`<button class="search-result" data-result-board="${b.id}" ${c?`data-result-card="${c.id}"`:''}>${icon(c?.type||'grid')}<span><strong>${esc(c?(c.title||c.content.slice(0,100)||'Testo senza titolo'):b.name)}</strong><small>${esc(c?b.name:'Lavagna')} ${c?`· ${labels[c.type]||'Card'}`:''}</small></span>${icon('arrow')}</button>`).join('')||`<p class="empty-results">${query?'Nessuna idea trovata. Prova un’altra parola.':'Inizia a scrivere per cercare.'}</p>`;
  });
}
function focusCard(id) {
  if(!$('#canvas'))return;
  selectedId=id;const c=selected();if(!c)return;
  const v=board().viewport,canvas=$('#canvas');v.zoom=Math.min(1,canvas.clientWidth/(c.width+160));v.x=canvas.clientWidth/2-(c.x+c.width/2)*v.zoom;v.y=canvas.clientHeight/2-(c.y+cardHeight(c)/2)*v.zoom;
  updateViewport();updateSelection();scheduleSave();
}
function openBackup(tab='export') {
  const exporting=tab==='export';
  openModal('Le tue idee vengono con te',`<p class="modal-description">Un backup di tutte le lavagne, comprese le immagini. Protetto dalla password che scegli tu.</p><div class="modal-tabs"><button class="tab-button ${exporting?'active':''}" data-backup-tab="export">${icon('download')}Esporta backup</button><button class="tab-button ${!exporting?'active':''}" data-backup-tab="import">${icon('upload')}Ripristina backup</button></div><form id="backup-form">${!exporting?'<div class="form-field"><label for="backup-file">Il tuo file Aiming</label><label class="drop-zone" for="backup-file">'+icon('upload')+'<strong>Scegli il backup cifrato</strong><span id="backup-file-name">Un file .json esportato da Aiming</span></label><input id="backup-file" name="file" type="file" accept=".json,application/json" class="file-input" required></div>':''}<div class="form-field"><label for="backup-password">${exporting?'Scegli una password':'Password del backup'}</label><div class="password-wrap"><input id="backup-password" name="password" type="password" autocomplete="${exporting?'new-password':'current-password'}" ${exporting?'minlength="8"':''} required placeholder="${exporting?'Almeno 8 caratteri':'La password usata per esportare'}"><button class="icon-button" type="button" data-action="show-password" title="Mostra o nascondi password" aria-label="Mostra o nascondi password">${icon('eye')}</button></div></div>${exporting?'<div class="form-field"><label for="backup-confirm">Ripeti la password</label><input id="backup-confirm" name="confirm" type="password" autocomplete="new-password" required placeholder="Scrivila ancora una volta"></div><p class="helper-text security-note">'+icon('lock')+'Cifratura AES-256-GCM. Conserva la password: non è recuperabile.</p>':'<div class="form-field"><label>Come vuoi ripristinare?</label><div class="import-mode"><label class="radio-card"><input type="radio" name="mode" value="merge" checked><span><strong>Aggiungi alle mie lavagne</strong><small>Conserva le lavagne già presenti.</small></span></label><label class="radio-card"><input type="radio" name="mode" value="replace"><span><strong>Sostituisci tutti i dati</strong><small>Le lavagne attuali verranno sostituite dal backup.</small></span></label></div></div>'}<p class="form-error hidden" role="alert"></p></form>`,`${cancelButton}<button class="button primary" type="submit" form="backup-form" id="backup-submit">${icon(exporting?'lock':'upload')}${exporting?'Cifra ed esporta':'Decifra e ripristina'}</button>`);
  $$('#modal-root [data-backup-tab]').forEach(el=>el.addEventListener('click',()=>openBackup(el.dataset.backupTab)));
  $('#backup-file')?.addEventListener('change',e=>{$('#backup-file-name').textContent=e.target.files[0]?.name||'Un file .json esportato da Aiming';});
  $('#backup-form').addEventListener('submit',async e=>{
    e.preventDefault();const form=new FormData(e.currentTarget),password=form.get('password'),submit=$('#backup-submit');
    if(exporting&&password!==form.get('confirm')){formError('Le due password non coincidono. Riprova.');return;}
    submit.disabled=true;submit.textContent=exporting?'Sto proteggendo le tue idee…':'Sto aprendo il tuo backup…';
    try {
      if(exporting){
        const encrypted=await encryptWorkspace(clone(workspace),password);
        const blob=new Blob([JSON.stringify(encrypted,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`aiming-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);closeModal();toast('Backup cifrato esportato. Conserva la password.');
      }else{
        const file=$('#backup-file').files[0];if(!file)throw Error('Scegli prima un file di backup.');if(file.size>80*1024*1024)throw Error('Il file è troppo grande. Il limite è 80 MB.');
        let envelope;try{envelope=JSON.parse(await file.text());}catch{throw Error('Il file non contiene un JSON valido.');}
        const imported=await decryptWorkspace(envelope,password);
        const next=clone(workspace);
        if(form.get('mode')==='replace'){Object.assign(next,imported);}
        else {imported.boards.forEach(b=>{b.id=uid();const ids=new Map();b.cards.forEach(c=>{const old=c.id;c.id=uid();ids.set(old,c.id);if(c.tasks)c.tasks.forEach(t=>t.id=uid());});b.connections.forEach(c=>{c.id=uid();c.from=ids.get(c.from);c.to=ids.get(c.to);});next.boards.push(b);});next.activeBoardId=next.boards.at(-imported.boards.length).id;}
        clearTimeout(saveTimer);saveQueue=saveQueue.catch(()=>{}).then(()=>storage.save(next));await saveQueue;
        pushHistory();workspace=next;revision++;persistedRevision=revision;saveProblem=false;selectedId=null;connectFrom=null;renderApp();closeModal();toast(`${imported.boards.length} lavagn${imported.boards.length===1?'a ripristinata':'e ripristinate'}. Bentornate, idee.`);
      }
    }catch(error){if(activeModal)formError(error.message||'Non è stato possibile completare il backup.');else toast(error.message,true);submit.disabled=false;submit.textContent=exporting?'Cifra ed esporta':'Decifra e ripristina';}
  });
}
function openSettings() {
  const grid=workspace.settings?.grid||'dots',background=workspace.settings?.background||'#f8f9f7';
  openModal('Il tuo spazio, il tuo stile',`<p class="modal-description">Scegli lo sfondo che lascia respirare le tue idee.</p><form id="settings-form"><div class="form-field"><label>Trama della lavagna</label><div class="settings-grid">${[['dots','Puntini'],['lines','Griglia'],['none','Pulita']].map(([value,label])=>`<label class="theme-option"><input type="radio" name="grid" value="${value}" ${grid===value?'checked':''}><span class="grid-preview grid-${value}"></span><strong>${label}</strong></label>`).join('')}</div></div><div class="form-field"><label>Colore di fondo</label><div class="color-palette">${['#f8f9f7','#fffaf2','#f0f5f3','#f2f3fa','#ffffff'].map(color=>`<label class="color-choice" style="--swatch:${color}"><input type="radio" name="background" value="${color}" ${background===color?'checked':''}><span>${icon('check')}</span></label>`).join('')}</div></div><div class="settings-local-note">${icon('shield')}<div><strong>A casa, su questo dispositivo.</strong><p>I contenuti sono salvati nel browser, senza account o sincronizzazione. La password protegge i backup esportati. Esporta un backup prima di cancellare i dati del browser o cambiare dispositivo.</p></div></div></form>`,`${cancelButton}<button class="button primary" type="submit" form="settings-form">${icon('check')}Questo mi somiglia</button>`);
  $('#settings-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);commit(()=>{workspace.settings={grid:f.get('grid'),background:f.get('background')};});closeModal();toast('Un tocco di personalità, fatto.');});
}
function openHelp() {
  const shortcuts=[['V','Seleziona e sposta card'],['H / Spazio','Trascina la lavagna'],['N','Nuovo post-it'],['T','Nuovo testo libero'],['Ctrl / ⌘ + B','Testo in grassetto'],['Ctrl / ⌘ + I','Testo in corsivo'],['Ctrl / ⌘ + U','Testo sottolineato'],['L','Nuova checklist'],['I','Carica immagini'],['K','Aggiungi un link'],['C','Collega due card'],['F','Adatta allo schermo'],['Ctrl / ⌘ + Z','Annulla'],['Ctrl / ⌘ + ⇧ + Z','Ripeti'],['Ctrl / ⌘ + D','Duplica la card'],['Ctrl / ⌘ + K','Cerca ovunque'],['Canc / ⌫','Elimina la card']];
  openModal('Un piccolo aiuto, tanto spazio',`<p class="modal-description">Scrivi direttamente nei post-it e nei testi liberi. Per spostare un testo usa la maniglia accanto; per le altre card trascina il bordo. Un doppio clic sullo sfondo crea un post-it.</p><div class="help-tip">${icon('hand')}<p><strong>Muoviti senza limiti.</strong><br>Trascina lo sfondo o scorri con il trackpad. Usa Ctrl (⌘ su Mac) + rotella per lo zoom. Puoi anche incollare immagini e testo.</p></div><div class="shortcut-grid">${shortcuts.map(([key,label])=>`<div class="shortcut-item"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div>`,`<button class="button primary" data-action="close-modal">Torniamo alle idee ${icon('arrow')}</button>`,true);
}
async function loadImages(files,point=null) {
  const accepted=[...files].filter(f=>/^image\/(png|jpeg|webp|gif|avif)$/.test(f.type));
  if(!accepted.length){toast('Scegli un’immagine PNG, JPEG, WebP, GIF o AVIF.',true);return;}
  const targetBoard=board().id, p=point||centerPoint(),newCards=[];
  for(const [i,file]of accepted.entries()){
    try{
      if(file.size>20*1024*1024)throw Error(`${file.name}: il limite è 20 MB per immagine.`);
      const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Immagine non leggibile.'));reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);});
      const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Formato immagine non leggibile.'));image.src=src;});
      const raster=document.createElement('canvas'),ratio=Math.min(1,2048/Math.max(img.naturalWidth,img.naturalHeight));raster.width=Math.max(1,Math.round(img.naturalWidth*ratio));raster.height=Math.max(1,Math.round(img.naturalHeight*ratio));raster.getContext('2d').drawImage(img,0,0,raster.width,raster.height);
      newCards.push({id:uid(),type:'image',x:Math.round(p.x-145+i*35),y:Math.round(p.y-130+i*35),width:290,height:280,title:file.name.replace(/\.[^.]+$/,''),content:'',color:'#ffffff',category:'ISPIRAZIONE',src:raster.toDataURL('image/png'),imageName:file.name});
    }catch(error){toast(error.message,true);}
  }
  if(newCards.length){commit(()=>{workspace.boards.find(b=>b.id===targetBoard)?.cards.push(...newCards);if(board().id===targetBoard)selectedId=newCards.at(-1).id;});toast(`${newCards.length} immagin${newCards.length===1?'e aggiunta':'i aggiunte'} alla lavagna.`);}
}
function onDrop(e) {e.preventDefault();if(e.dataTransfer.files.length)loadImages(e.dataTransfer.files,worldPoint(e.clientX,e.clientY));}

document.addEventListener('click',e=>{
  const textToggle=e.target.closest('[data-text-toggle]');if(textToggle){const c=selected();if(c?.type==='text')applyTextFormat({[textToggle.dataset.textToggle]:!c[textToggle.dataset.textToggle]});return;}
  const textAlign=e.target.closest('[data-text-align]');if(textAlign){applyTextFormat({textAlign:textAlign.dataset.textAlign});return;}
  const filter=e.target.closest('[data-home-filter]');if(filter){homeOptions.filter=filter.dataset.homeFilter;renderApp();return;}
  const favorite=e.target.closest('[data-favorite-board]');if(favorite){const b=workspace.boards.find(b=>b.id===favorite.dataset.favoriteBoard);if(b)commit(()=>{b.favorite=!b.favorite;},{touch:false});return;}
  const options=e.target.closest('[data-options-board]');if(options){workspace.activeBoardId=options.dataset.optionsBoard;openBoardMenu();return;}
  const boardTarget=e.target.closest('[data-board]');if(boardTarget){switchBoard(boardTarget.dataset.board);closeModal();return;}
  const result=e.target.closest('[data-result-board]');if(result){switchBoard(result.dataset.resultBoard);closeModal();if(result.dataset.resultCard)focusCard(result.dataset.resultCard);return;}
  const color=e.target.closest('[data-color]');if(color){if(selected())commit(()=>selected().color=color.dataset.color);return;}
  const toolButton=e.target.closest('[data-tool]');if(toolButton){setTool(toolButton.dataset.tool);return;}
  const control=e.target.closest('[data-action]');if(!control)return;
  if(control.tagName==='A')e.preventDefault();
  const action=control.dataset.action;
  const actions={
    'new-board':()=>openBoardEditor(),'boards':()=>openBoards(),'favorites':()=>openBoards(true),'search':openSearch,'settings':openSettings,'help':openHelp,
    'backup':()=>openBackup(),'close-modal':closeModal,'board-menu':openBoardMenu,'rename-board':()=>openBoardEditor(board()),'remove-board':removeBoard,
    'duplicate-board':()=>{commit(()=>{const b=clone(board());b.id=uid();b.name+=' · Copia';b.favorite=false;const ids=new Map();b.cards.forEach(c=>{const old=c.id;c.id=uid();ids.set(old,c.id);if(c.tasks)c.tasks.forEach(t=>t.id=uid());});b.connections.forEach(c=>{c.id=uid();c.from=ids.get(c.from);c.to=ids.get(c.to);});workspace.boards.push(b);workspace.activeBoardId=b.id;selectedId=null;});closeModal();toast('Una nuova possibilità, duplicata.');},
    'favorite':()=>commit(()=>{board().favorite=!board().favorite;},{touch:false}),'edit-card':()=>openCardEditor(board().cards.find(c=>c.id===control.dataset.id)),
    'card-details':()=>{const c=board().cards.find(c=>c.id===control.dataset.id)||selected();if(c)openCardEditor(c,c.type,null,true);},
    'edit-selected':()=>{if(selected())openCardEditor(selected());},'duplicate-card':duplicateCard,'delete-card':deleteCard,
    'disconnect':()=>commit(()=>{board().connections=board().connections.filter(l=>l.from!==selectedId&&l.to!==selectedId);}),
    'connect-selected':()=>{connectFrom=selectedId;setTool('connect');},
    'add-note':()=>openCardEditor(null,'note'),'add-task':()=>{const c=board().cards.find(c=>c.id===control.dataset.id);openCardEditor(c);setTimeout(()=>{$('#card-content-input')?.focus();},50);},
    'fit':fitBoard,'zoom-in':()=>setZoom(board().viewport.zoom*1.2),'zoom-out':()=>setZoom(board().viewport.zoom/1.2),'reset-zoom':()=>setZoom(1),
    'undo':undo,'redo':redo,
    'show-password':()=>{const input=$('#backup-password');input.type=input.type==='password'?'text':'password';}
  };
  actions[action]?.();
});
document.addEventListener('change',e=>{
  if(e.target.matches('[data-text-field]')){
    const field=e.target.dataset.textField,value=e.target.value;
    if(field==='fontSize'){const n=Number(value);if(!Number.isFinite(n)||n<8||n>160){e.target.value=selected()?.fontSize||24;return;}applyTextFormat({fontSize:Math.round(n)});}
    else if(field==='fontFamily'&&Object.hasOwn(textFonts,value))applyTextFormat({fontFamily:value});
    else if(field==='textColor'&&/^#[\da-f]{6}$/i.test(value))applyTextFormat({textColor:value});
    else if(field==='backgroundColor'&&/^#[\da-f]{6}$/i.test(value))applyTextFormat({color:value,textBackground:true});
    return;
  }
  if(e.target.matches('[data-task]')){const c=board().cards.find(c=>c.id===e.target.dataset.card),task=c?.tasks.find(t=>t.id===e.target.dataset.task);if(task)commit(()=>{task.done=e.target.checked;});}
});
$('#image-upload').addEventListener('change',e=>{loadImages(e.target.files);e.target.value='';});
document.addEventListener('pointermove',onPointerMove);document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
document.addEventListener('pointerdown',e=>{if(e.button===0&&e.target.closest('[data-text-toggle],[data-text-align]'))e.preventDefault();});
document.addEventListener('keydown',e=>{
  if(!workspace)return;
  if(contextMenu){contextMenuKey(e);return;}
  if(activeModal){
    if(e.key==='Escape'){e.preventDefault();closeModal();return;}
    if(e.key==='Tab'){const focusable=$$('button:not(:disabled),input:not([type="hidden"]),textarea,select,a[href]',activeModal).filter(el=>el.offsetParent!==null);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    return;
  }
  if(e.target.closest('[contenteditable]')){
    const key=e.key.toLowerCase();
    if((e.ctrlKey||e.metaKey)&&selected()?.type==='text'&&['b','i','u'].includes(key)){e.preventDefault();const field={b:'bold',i:'italic',u:'underline'}[key];applyTextFormat({[field]:!selected()[field]});return;}
    if(e.key==='Escape'){e.preventDefault();e.target.blur();$('#canvas')?.focus();}return;
  }
  if(e.target.closest('input,textarea,select'))return;
  const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
  if(mod&&key==='k'){e.preventDefault();openSearch();return;}
  if(mod&&key==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if(mod&&key==='y'){e.preventDefault();redo();return;}
  if(mod&&key==='d'&&view==='board'){e.preventDefault();duplicateCard();return;}
  if(mod)return;
  if(view!=='board')return;
  if(key==='escape'){selectedId=null;connectFrom=null;setTool('cursor');updateSelection();return;}
  if(e.code==='Space'){e.preventDefault();spaceHeld=true;updateViewport();return;}
  if(key==='delete'||key==='backspace'){if(selectedId){e.preventDefault();deleteCard();}return;}
  if(key==='enter'&&selected()){e.preventDefault();openCardEditor(selected());return;}
  if(['arrowup','arrowdown','arrowleft','arrowright'].includes(key)&&selected()){
    e.preventDefault();const step=e.shiftKey?20:2;commit(()=>{const c=selected();c.x+=key==='arrowright'?step:key==='arrowleft'?-step:0;c.y+=key==='arrowdown'?step:key==='arrowup'?-step:0;});return;
  }
  const tools={v:'cursor',h:'hand',n:'note',t:'text',l:'tasks',i:'image',k:'link',c:'connect'};
  if(tools[key]){e.preventDefault();setTool(tools[key]);}else if(key==='f'){e.preventDefault();fitBoard();}else if(key==='+'||key==='=')setZoom(board().viewport.zoom*1.2);else if(key==='-')setZoom(board().viewport.zoom/1.2);else if(key==='?')openHelp();
});
document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceHeld=false;if(workspace&&!contextMenu)updateViewport();}});
window.addEventListener('blur',()=>{closeContextMenu();spaceHeld=false;if(workspace)endDrag();});
document.addEventListener('paste',e=>{
  if(!workspace||view!=='board'||activeModal||contextMenu||e.target.closest('input,textarea,[contenteditable]'))return;
  const files=[...e.clipboardData.items].filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);
  if(files.length){e.preventDefault();loadImages(files);return;}
  const text=e.clipboardData.getData('text/plain').trim();
  if(text){e.preventDefault();const p=centerPoint();commit(()=>{const c={id:uid(),type:'note',title:text.split('\n')[0].slice(0,120),content:text.includes('\n')?text.split('\n').slice(1).join('\n').slice(0,20000):'',x:Math.round(p.x-135),y:Math.round(p.y-105),width:270,height:210,color:colors[0],category:'IDEA AL VOLO'};board().cards.push(c);selectedId=c.id;});toast('Pensiero catturato.');}
});
window.addEventListener('resize',()=>{closeContextMenu();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(workspace)updateViewport();},100);});
window.addEventListener('pagehide',()=>{if(workspace){clearTimeout(saveTimer);persist();}});
window.addEventListener('beforeunload',e=>{if(saveProblem){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&workspace){clearTimeout(saveTimer);persist();}});

async function init() {
  try {
    storage=await openStore();
    workspace=await storage.load();
    const fresh=!workspace;
    if(fresh)workspace=createDemoWorkspace();
    workspace.settings||={grid:'dots',background:'#f8f9f7'};
    let requestedBoard='';try{requestedBoard=decodeURIComponent(location.hash.replace(/^#board=/,''));}catch{}
    if(location.hash.startsWith('#board=')&&workspace.boards.some(b=>b.id===requestedBoard)){workspace.activeBoardId=requestedBoard;view='board';}
    renderApp();
    if(fresh)await persist();
    else updateViewport();
  } catch(error) {
    app.innerHTML=`<main class="startup-error"><span class="brand-mark">${icon('target')}</span><h1>Le tue idee meritano attenzione.</h1><p>${esc(error.message)}</p><p>I dati esistenti non sono stati sovrascritti. Riapri Aiming in questo browser dopo aver controllato lo spazio e i permessi di archiviazione.</p><button class="button primary" id="retry-startup">Riprova</button></main>`;
    $('#retry-startup').addEventListener('click',()=>location.reload());
  }
}
init();

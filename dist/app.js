import * as D from './domain.js';
import * as V from './views.js';
const STORAGE='cockpit-cds-manual-v3';
let store,who='',tab='budget',selectedMonth='',setupDraft=null,dirty=false,modalDirty=false,modalInvoice=null,timer;
try{store=D.validateStore(JSON.parse(localStorage.getItem(STORAGE)||'null'));}catch{store=D.initialStore();}
const root=document.getElementById('app'),modal=document.getElementById('modal');
const current=()=>store.cockpits.find(c=>c.id===store.activeId);
function notify(message,error=false){const el=document.getElementById('toast');el.textContent=message;el.style.display='block';el.style.background=error?'#9d343b':'#14243d';clearTimeout(timer);timer=setTimeout(()=>el.style.display='none',6500);}
function transact(fn){const next=structuredClone(store),c=next.cockpits.find(x=>x.id===next.activeId);const result=fn(c,next);try{localStorage.setItem(STORAGE,JSON.stringify(next));}catch{throw Error('Sauvegarde locale impossible. Vérifiez que le stockage du navigateur est disponible.');}store=next;return result;}
const shared = document.documentElement.hasAttribute('data-shared');
let revision, saving = false;
async function dispatch(action, args, local) {
  if (!shared) return transact(local);
  saving = true;
  try {
    const response = await fetch('/api/state', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({revision, action, args, cockpitId: store.activeId})
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    const selected = action === 'newCockpit' ? data.result.id : store.activeId;
    store = data.store;
    selectSharedCockpit(selected);
    revision = data.revision;
    return data.result;
  } finally {
    saving = false;
  }
}
let onboarding = false;
function openFirstScreen() {
  tab = who === 'lassaad' ? (shared ? 'allocation' : 'budget') : (shared ? 'budget' : 'setup');
  const key = 'cockpit-guide-v1-' + (shared ? 'shared-' : 'local-') + who;
  try {
    onboarding = !localStorage.getItem(key);
    if (onboarding) localStorage.setItem(key, 'seen');
  } catch { onboarding = true; }
  if (onboarding) tab = 'guide';
}
function openNewPo() {
  modal.innerHTML = `<div class="dialog-header"><h2>Nouveau PO</h2><button type="button" class="close" data-action="close" aria-label="Fermer">×</button></div>
    <div class="body"><form id="new-po-form">
      <label class="field">Référence du PO<input name="poRef" required maxlength="80" placeholder="124178"></label>
      <label class="field">Owner du PO<select name="owner"><option value="laurent">Laurent</option><option value="jennifer">Jennifer</option></select></label>
      <button class="btn teal" type="submit">Créer le PO</button>
    </form></div>`;
  modal.showModal();
}
async function startShared() {
  try {
    const response = await fetch('/api/state', {cache: 'no-store'});
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    store = data.store;
    revision = data.revision;
    try { selectSharedCockpit(sessionStorage.getItem('cockpit-active-po')); } catch {}
    who = data.role;
    openFirstScreen();
    render();
  } catch (error) {
    root.textContent = 'Impossible de charger le PO partagé. Rechargez la page pour réessayer.';
  }
}
function selectSharedCockpit(id) {
  if (!store.cockpits.some(c => c.id === id)) return;
  store.activeId = id;
  try { sessionStorage.setItem('cockpit-active-po', id); } catch {}
}

let epicPicker = null;
function openEpicPicker(id) {
  const field = document.querySelector('[data-project="' + CSS.escape(id) + '"]');
  const input = field?.querySelector('[name="p-epics"]');
  if (!input) return;
  epicPicker = { input, field, selected: new Set(input.value.toUpperCase().split(/[\s,;]+/).filter(Boolean)), query: '', cursor: null };
  modal.innerHTML = `<div class="dialog-header"><h2>Epics du projet Jira OP</h2><button type="button" class="close" data-action="close" aria-label="Fermer">×</button></div>
    <div class="body"><form id="epic-search" class="inline"><label for="epic-query">Nom ou clé Jira</label><input id="epic-query" type="search" maxlength="80" placeholder="OP-123"><button class="btn">Rechercher</button></form>
    <p id="epic-selection"></p><p id="epic-message" role="status"></p><div id="epic-results"></div>
    <div class="inline"><button type="button" class="btn" data-action="epic-more" hidden>Résultats suivants</button>
    <button type="button" class="btn teal" data-action="epic-apply">Appliquer au projet</button></div></div>`;
  modal.showModal();
  updateEpicSelection();
  loadEpics();
}
function updateEpicSelection() {
  document.getElementById('epic-selection').innerHTML = [...epicPicker.selected].map(key =>
    `<button class="btn" data-action="epic-toggle" data-id="${V.h(key)}" type="button">${V.h(key)} · Retirer</button>`
  ).join(' ') || 'Aucun epic sélectionné';
  for (const button of modal.querySelectorAll('#epic-results [data-id]')) {
    const selected = epicPicker.selected.has(button.dataset.id);
    button.textContent = selected ? 'Retirer' : 'Rattacher';
    button.setAttribute('aria-pressed', String(selected));
  }
}
async function loadEpics(more = false) {
  const picker = epicPicker;
  if (!picker || (more && (!picker.cursor || picker.loading))) return;
  const request = Symbol();
  picker.request = request;
  picker.loading = true;
  const params = new URLSearchParams({q: picker.query});
  if (more) params.set('cursor', picker.cursor);
  const message = document.getElementById('epic-message');
  const results = document.getElementById('epic-results');
  const next = modal.querySelector('[data-action="epic-more"]');
  if (!more) results.textContent = '';
  next.hidden = true;
  message.textContent = 'Recherche dans Jira OP…';
  try {
    const response = await fetch('/api/jira/epics?' + params);
    const data = await response.json();
    if (epicPicker !== picker || picker.request !== request) return;
    if (!response.ok) throw Error(data.error);
    picker.cursor = data.cursor;
    results.insertAdjacentHTML('beforeend', data.epics.map(epic =>
      `<div class="epic-result"><a target="_blank" rel="noopener noreferrer" href="https://accor-it.atlassian.net/browse/${V.h(epic.key)}">${V.h(epic.key)}</a> · ${V.h(epic.title)} <button class="btn" type="button" data-action="epic-toggle" data-id="${V.h(epic.key)}"></button></div>`
    ).join(''));
    message.textContent = !data.epics.length && !more ? 'Aucun résultat.' : '';
    next.hidden = !picker.cursor;
    updateEpicSelection();
  } catch (error) {
    if (epicPicker === picker && picker.request === request) message.textContent = error.message;
  } finally {
    if (picker.request === request) picker.loading = false;
  }
}

let jiraPreview = null;
async function openJiraWorklogs() {
  const preview = { id: current().id, month: selectedMonth };
  jiraPreview = preview;
  modal.innerHTML = '<div class="dialog-header"><h2>Temps Jira du mois</h2><button class="close" type="button" data-action="close" aria-label="Fermer">×</button></div><div class="body" id="jira-worklog-body" role="status">Lecture de Jira…</div>';
  modal.showModal();
  try {
    const params = new URLSearchParams({cockpitId: preview.id, month: preview.month});
    const response = await fetch('/api/jira/worklogs?' + params);
    const data = await response.json();
    if (jiraPreview !== preview) return;
    if (!response.ok) throw Error(data.error);
    if (data.revision !== revision) throw Error('Le cockpit partagé a changé. Actualisez la page avant le préremplissage.');
    const body = document.getElementById('jira-worklog-body');
    if (!data.rows.length) {
      body.textContent = data.linkedEpics
        ? 'Aucun temps visible dans Jira pour ce mois et les périodes des projets.' + (data.excluded ? ' Temps hors période projet écartés : ' + data.excluded + '.' : '')
        : 'Aucune epic Jira OP rattachée à un projet actif sur ce mois.';
      return;
    }
    preview.rows = data.rows;
    preview.authors = [...new Map(data.rows.map(row => [row.account, row.author]))];
    const choices = '<option value="">Choisir un profil</option><option value="skip">Ignorer cet intervenant</option>' +
      D.ROLES.map(role => `<option value="${V.h(role.id)}">${V.h(role.name)}</option>`).join('');
    body.removeAttribute('role');
    body.innerHTML = `
      <p>${data.linkedEpics} epics et ${data.issueCount} tickets consultés.${data.excluded?' Temps hors période projet écartés : '+data.excluded+'.':''}</p>
      <p>Les temps visibles dans Jira sont regroupés par projet et intervenant. Choisissez le profil de chacun, ou ignorez les temps qui ne doivent pas être facturés.</p>
      <label class="field">Heures par jour facturable <input id="jira-hours-day" type="number" value="8" min="0.5" max="24" step="0.5"></label>
      <div class="table-wrap"><table><thead><tr><th>Intervenant</th><th>Profil de facturation</th></tr></thead><tbody>
      ${preview.authors.map(([,name],i)=>`<tr><td>${V.h(name)}</td><td><select data-jira-author="${i}" aria-label="Profil de ${V.h(name)}">${choices}</select></td></tr>`).join('')}
      </tbody></table></div>
      <div class="table-wrap"><table><thead><tr><th>Projet</th><th>Intervenant</th><th>Heures Jira</th><th>Tickets</th></tr></thead><tbody>
      ${data.rows.map(row=>`<tr><td>${V.h(row.projectName)}</td><td>${V.h(row.author)}</td><td>${V.dec(row.seconds/3600)}</td><td>${row.tickets.map(key=>`<a target="_blank" rel="noopener noreferrer" href="https://accor-it.atlassian.net/browse/${V.h(key)}">${V.h(key)}</a>`).join(', ')}</td></tr>`).join('')}
      </tbody></table></div>
      <p>Les heures sont totalisées par projet et profil, puis arrondies à la demi-journée la plus proche. Vérifiez les jours proposés dans la grille avant d’enregistrer.</p>
      <button class="btn teal" type="button" data-action="jira-apply">Appliquer à la grille</button>`;
  } catch (error) {
    if (jiraPreview === preview) document.getElementById('jira-worklog-body').textContent = error.message;
  }
}
function applyJiraWorklogs() {
  const preview = jiraPreview;
  if (!preview?.rows || preview.id !== current().id || preview.month !== selectedMonth) return;
  const input = document.getElementById('jira-hours-day');
  const hours = Number(input.value);
  if (!input.value || !input.checkValidity() || hours <= 0) throw Error('Renseignez une durée valide en heures par jour.');
  const selectors = [...modal.querySelectorAll('[data-jira-author]')];
  if (selectors.some(field => !field.value)) throw Error('Choisissez un profil ou ignorez chaque intervenant.');
  const roles = new Map(preview.authors.map(([account],i)=>[account, selectors[i].value]));
  const totals = new Map();
  for (const row of preview.rows) {
    const role = roles.get(row.account);
    if (role === 'skip') continue;
    const field = document.querySelector('[data-allocation="' + CSS.escape(row.projectId) + '"] [data-role="' + CSS.escape(role) + '"]');
    if (field && !field.disabled) totals.set(field, (totals.get(field) || 0) + row.seconds);
  }
  if (!totals.size) throw Error('Aucun temps sélectionné pour le préremplissage.');
  if ([...totals.keys()].some(field => Number(field.value) > 0) &&
      !confirm('Remplacer les valeurs existantes uniquement dans les cellules concernées par cet import Jira ?')) return;
  for (const [field,seconds] of totals) field.value = Math.round(seconds / (hours * 3600) * 2) / 2;
  dirty = true;
  closeModal();
  updateAllocation();
  notify('Proposition Jira appliquée. Vérifiez les jours puis enregistrez la ventilation.');
}

function abandon(){return !dirty||confirm('Des modifications ne sont pas enregistrées. Les abandonner ?');}
function closeModal(){if(modalDirty&&!confirm('Abandonner les modifications de la facture ?'))return false;modal.close();epicPicker=null;jiraPreview=null;modalDirty=false;modalInvoice=null;return true;}
function availableMonth(c){const months=D.monthsBetween(c.start,c.end).filter(m=>!c.openingMonth||m>c.openingMonth);return months.includes(selectedMonth)?selectedMonth:months.includes(c.reportMonth)?c.reportMonth:months[0]||'';}
function render(){if(!who){root.innerHTML=V.login();return;}const c=current();selectedMonth=availableMonth(c);if(tab==='setup'&&!setupDraft)setupDraft=structuredClone(c);const body=tab==='setup'?V.setup(setupDraft,shared):tab==='allocation'?V.allocation(c,selectedMonth,shared):tab==='invoices'?V.invoices(c,who):tab==='guide'?V.guide(c,shared,who,onboarding):V.budget(c,who);root.innerHTML=V.shell(store,who,tab,body,shared);dirty=false;if(tab==='setup')updateSplit();if(tab==='allocation')updateAllocation();}
function value(form,name){return form.elements.namedItem(name)?.value??'';}
function number(form,name){const raw=value(form,name).trim();return raw===''?0:Number(raw);}
function readDefinition(){const form=document.getElementById('setup-form'),base=setupDraft||current();if(!form)return structuredClone(base);const next={...structuredClone(base)};for(const name of ['name','poRef','start','end','reportMonth','openingMonth','owner','coOwner','supplier'])next[name]=value(form,name).trim();for(const name of ['year','budget','monthlyDays'])next[name]=number(form,name);next.rates=Object.fromEntries(D.ROLES.map(r=>[r.id,number(form,`rate-${r.id}`)]));next.projects=[...form.querySelectorAll('[data-project]')].map(el=>{const p=base.projects.find(p=>p.id===el.dataset.project);const get=name=>el.querySelector(`[name="p-${name}"]`)?.value??'';const optional=name=>get(name).trim()===''?null:Number(get(name));return {...p,name:get('name').trim(),category:get('category'),budget:Number(get('budget')||0),start:get('start'),end:get('end'),openingValidated:Number(get('openingValidated')||0),device:Object.fromEntries(D.ROLES.map(r=>[r.id,Number(get('device-'+r.id)||0)])),pointsPlanned:optional('pointsPlanned'),pointsDelivered:optional('pointsDelivered'),epics:get('epics').trim(),notes:get('notes').trim()};});return next;}
function updateSplit(){const c=readDefinition(),el=document.getElementById('split-summary');if(!el)return;const allocated=D.sum(c.projects.map(p=>p.budget)),left=D.moneyRound(c.budget-allocated);el.innerHTML=`<div><span class="muted small">Budget du PO</span><strong>${V.euro(c.budget)}</strong></div><div><span class="muted small">Réparti sur ${c.projects.length} projet(s)</span><strong>${V.euro(allocated)}</strong></div><div class="${left===0?'text-green':'text-amber'}"><span class="small">${left<0?'Dépassement à corriger':'Reste à répartir'}</span><strong>${V.euro(left)}</strong></div>`;for(const box of document.querySelectorAll('[data-project]')){const p=c.projects.find(p=>p.id===box.dataset.project);box.querySelector('.device-heading span').textContent='ETP par pas de 0,5 · '+D.staffingText(p.device);}}
function allocationRows(){return [...document.querySelectorAll('[data-allocation]')].flatMap(row=>[...row.querySelectorAll('[data-role]')].map(input=>({projectId:row.dataset.allocation==='unknown'?null:row.dataset.allocation,roleId:input.dataset.role,days:Number(input.value||0),note:row.querySelector('[name="unknown-note"]')?.value||''})));}
function updateAllocation(){const c=current(),rows=allocationRows();let total=0,over=[];for(const row of document.querySelectorAll('[data-allocation]')){let n=0;const p=c.projects.find(p=>p.id===row.dataset.allocation);for(const input of row.querySelectorAll('[data-role]')){const days=Number(input.value||0),r=input.dataset.role;n+=days*c.rates[r];if(p&&days>D.daysInProjectMonth(p,selectedMonth,c.monthlyDays)*p.device[r]+.01)over.push(`${p.name} / ${D.ROLES.find(x=>x.id===r).short}`);}row.querySelector('[data-row-total]').textContent=V.euro(n);total+=n;}const el=document.getElementById('allocation-total');if(el)el.textContent=V.euro(total);const warning=document.getElementById('capacity-feedback');if(warning)warning.textContent=over.length?'Au-dessus du dispositif prévu : '+over.join(', ')+'. Vérifiez les jours avant enregistrement.':'';}
function openInvoice(id){const i=D.visiblePoInvoices(current(),who).find(i=>i.id===id);if(!i)throw Error('Facture introuvable');modal.innerHTML=V.invoiceDetail(current(),i,who);modalInvoice=id;modalDirty=false;if(!modal.open)modal.showModal();}
function invoicePatch(){const form=document.getElementById('invoice-form');return {number:value(form,'number'),date:value(form,'date'),supplierNote:value(form,'supplierNote'),lines:[...form.querySelectorAll('[data-invoice-line]')].map(row=>({id:row.dataset.invoiceLine,billedDays:Number(row.querySelector('[name="billedDays"]').value||0),billedRate:Number(row.querySelector('[name="billedRate"]').value||0)}))};}
function updateInvoice(){const i=current().invoices.find(i=>i.id===modalInvoice);if(!i)return;const patch=invoicePatch(),billed=D.sum(patch.lines.map(l=>D.moneyRound(l.billedDays*l.billedRate))),delta=D.moneyRound(billed-D.invoiceTotals(i).expected);for(const row of modal.querySelectorAll('[data-invoice-line]')){const l=patch.lines.find(l=>l.id===row.dataset.invoiceLine);row.querySelector('[data-line-total]').textContent=V.euro(l.billedDays*l.billedRate);}document.getElementById('billed-total').textContent=V.euro(billed);document.getElementById('invoice-delta').textContent=(delta>0?'+':'')+V.euro(delta);const match=document.getElementById('invoice-match');match.textContent=delta?'Écart à vérifier : une explication fournisseur est requise avant envoi.':'Conforme à la ventilation';match.className='alert '+(delta?'':'success');}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csv(){const f=D.finances(current()),headers=['PO','Projet','Type','Dispositif ETP','Début','Fin','Budget HT','Consommé validé HT','Restant HT','Forecast HT'];const protect=x=>{let s=String(x??'');if(typeof x==='string'&&/^\s*[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=f.rows.map(p=>[current().poRef,p.name,p.category,p.staffing,p.start,p.end,p.budget,p.actual,p.remaining,p.forecast]);download('cockpit-projets.csv','\ufeff'+[headers,...rows].map(row=>row.map(protect).join(';')).join('\r\n'),'text/csv;charset=utf-8');}
document.addEventListener('click',async event=>{const b=event.target.closest('[data-action]');if(!b||b.disabled||saving)return;try{const action=b.dataset.action,id=b.dataset.id;if(action==='login'){who=id;openFirstScreen();setupDraft=null;render();}else if(action==='logout'){if(!abandon())return;who='';setupDraft=null;render();}else if(action==='help-continue'){onboarding=false;tab=who==='lassaad'?'allocation':'budget';render();}else if(action==='nav'){if(!abandon())return;onboarding=false;tab=id;setupDraft=null;render();}else if(action==='jira-worklogs'){await openJiraWorklogs();}else if(action==='jira-apply'){applyJiraWorklogs();}else if(action==='jira-epics'){openEpicPicker(id);}else if(action==='epic-toggle'&&epicPicker){if(epicPicker.selected.has(id))epicPicker.selected.delete(id);else epicPicker.selected.add(id);updateEpicSelection();}else if(action==='epic-more'){await loadEpics(true);}else if(action==='epic-apply'&&epicPicker){const keys=[...epicPicker.selected].join(', ');epicPicker.input.value=keys;epicPicker.field.querySelector('[data-epic-label]').textContent=keys||'Aucun epic rattaché';dirty=true;closeModal();}else if(action==='new'){if(!abandon())return;if(shared){openNewPo();return;}else transact((c,s)=>{const x=D.newCockpit();s.cockpits.push(x);s.activeId=x.id;});onboarding=false;tab='setup';setupDraft=null;selectedMonth='';render();}else if(action==='add-project'){setupDraft=readDefinition();setupDraft.projects.push(D.newProject(setupDraft.year));render();dirty=true;document.querySelector('.project-form:last-child').scrollIntoView({block:'center',behavior:'smooth'});}else if(action==='remove-project'){const draft=readDefinition(),p=draft.projects.find(p=>p.id===id),c=current();const linked=c.invoices.some(i=>i.lines.some(l=>l.projectId===id))||Object.values(c.expenses).some(s=>s.rows.some(r=>r.projectId===id))||p.openingValidated>0;if(linked)throw Error('Ce projet a un historique. Ajustez sa date de fin au lieu de le supprimer.');if(!confirm('Retirer ce projet du brouillon ?'))return;draft.projects=draft.projects.filter(p=>p.id!==id);setupDraft=draft;render();dirty=true;}else if(action==='prefill'){if(!confirm('Remplacer les jours saisis par une suggestion issue du dispositif prévu ? Vérifiez ensuite les jours réellement travaillés.'))return;for(const row of document.querySelectorAll('[data-allocation]')){const p=current().projects.find(p=>p.id===row.dataset.allocation);for(const input of row.querySelectorAll('[data-role]'))if(!input.disabled)input.value=p?Math.round(D.daysInProjectMonth(p,selectedMonth,current().monthlyDays)*p.device[input.dataset.role]*2)/2:0;}dirty=true;updateAllocation();}else if(action==='create-invoice'){if(dirty)throw Error('Validez les modifications de la ventilation avant de créer la facture.');const result=await dispatch('createInvoice',[selectedMonth],c=>D.createInvoice(c,selectedMonth,who));render();openInvoice(result.id);notify('Facture créée. Vérifiez les jours et les TJM facturés.');}else if(action==='revise'){const reason=prompt('Motif de reprise de la ventilation (la facture sera conservée comme annulée) :');if(reason===null)return;await dispatch('revise',[b.dataset.month,reason],c=>D.reviseExpense(c,b.dataset.month,reason,who));render();notify('Ventilation rouverte ; la facture précédente est archivée.');}else if(action==='invoice'){if(!abandon())return;openInvoice(id);}else if(action==='project'){const p=current().projects.find(p=>p.id===id);modal.innerHTML=V.projectDetail(current(),p,who);modalInvoice=null;modalDirty=false;modal.showModal();}else if(action==='close'){closeModal();}else if(action==='csv'){csv();}else if(action==='backup'){download('cockpit-sauvegarde.json',JSON.stringify(store,null,2),'application/json');notify('Sauvegarde JSON exportée.');}else if(action==='download-invoice'){if(modalDirty&&who==='lassaad'){const patch=invoicePatch();await dispatch('editInvoice',[id,patch,false],c=>D.editInvoice(c,id,patch,who));modalDirty=false;}const i=D.visiblePoInvoices(current(),who).find(i=>i.id===id);if(!i)throw Error('Facture introuvable');download(i.number.replace(/[^a-zA-Z0-9_-]/g,'_')+'.html',V.invoiceDocument(current(),i),'text/html;charset=utf-8');}}catch(error){notify(error.message,true);}});
document.addEventListener('submit',async event=>{const form=event.target;if(form.id==='new-po-form'){
  event.preventDefault();
  if(saving)return;
  try {
    await dispatch('newCockpit',[value(form,'poRef'),value(form,'owner')]);
    closeModal(); onboarding=false; tab='setup'; setupDraft=null; selectedMonth=''; render();
    notify('PO créé. Vous pouvez maintenant ajouter et paramétrer ses projets.');
  } catch(error) { notify(error.message,true); }
  return;
}if(form.id==='epic-search'&&epicPicker){event.preventDefault();epicPicker.query=document.getElementById('epic-query').value;loadEpics();return;}if(!['setup-form','allocation-form','invoice-form','review-form'].includes(form.id))return;event.preventDefault();if(saving)return;try{const intent=event.submitter?.value||'save';if(form.id==='setup-form'){const next=readDefinition(),activate=intent==='activate';await dispatch('definition',[next,activate],(c,s)=>{if(s.cockpits.some(x=>x.id!==c.id&&x.poRef.trim().toUpperCase()===next.poRef.trim().toUpperCase()&&next.poRef))throw Error('Ce PO dispose déjà d’un cockpit. Sélectionnez son portefeuille.');D.saveDefinition(c,next,who,activate);});setupDraft=null;render();notify(activate?'Cockpit activé. Lassaad peut démarrer la ventilation.':'Paramétrage enregistré.');}else if(form.id==='allocation-form'){const rows=allocationRows();await dispatch('expense',[selectedMonth,rows,form.elements.zeroConfirmed.checked],c=>D.saveExpense(c,selectedMonth,rows,who,form.elements.zeroConfirmed.checked));render();notify('Ventilation validée. Vous pouvez créer la facture.');}else if(form.id==='invoice-form'){const id=form.dataset.id,patch=invoicePatch();await dispatch('editInvoice',[id,patch,intent==='send'],c=>{D.editInvoice(c,id,patch,who);if(intent==='send')D.sendInvoice(c,id,who);});render();openInvoice(id);notify(intent==='send'?'Facture transmise à l’owner du PO dans le cockpit.':'Facture enregistrée.');}else if(form.id==='review-form'){const id=form.dataset.id,note=value(form,'reviewNote');await dispatch('review',[id,note,intent],c=>intent==='return'?D.returnInvoice(c,id,note,who):D.validateInvoice(c,id,note,who));render();openInvoice(id);notify(intent==='return'?'Facture retournée à Lassaad.':'Facture validée et imputée une seule fois.');}}catch(error){notify(error.message,true);if(form.id==='setup-form'){document.getElementById('setup-feedback').innerHTML=`<div class="alert"><div><strong>Paramétrage à compléter</strong>${V.h(error.message)}</div></div>`;document.getElementById('setup-feedback').scrollIntoView({block:'start',behavior:'smooth'});}}});
document.addEventListener('input',event=>{if(event.target.closest('#setup-form')){dirty=true;updateSplit();}else if(event.target.closest('#allocation-form')){dirty=true;updateAllocation();}else if(event.target.closest('#invoice-form')){modalDirty=true;updateInvoice();}else if(event.target.closest('#review-form'))modalDirty=true;});
document.addEventListener('change',event=>{const kind=event.target.dataset.change;if(!kind)return;if(!abandon()){if(kind==='cockpit')event.target.value=store.activeId;else event.target.value=selectedMonth;return;}try{if(kind==='cockpit'){const id=event.target.value;if(shared)selectSharedCockpit(id);else transact((c,s)=>s.activeId=id);setupDraft=null;selectedMonth='';}else if(kind==='month')selectedMonth=event.target.value;render();}catch(error){notify(error.message,true);}});
modal.addEventListener('cancel',event=>{event.preventDefault();closeModal();});
window.addEventListener('beforeunload',event=>{if(dirty||modalDirty){event.preventDefault();event.returnValue='';}});
if (shared) startShared();
else render();

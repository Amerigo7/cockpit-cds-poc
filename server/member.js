const $ = id => document.getElementById(id);
const month = $('member-month');
const status = $('member-status');
const refresh = $('member-load');
const validate = $('member-validate');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const when = new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'});
const day = new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeZone:'UTC'});
const currentMonth = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Paris',year:'numeric',month:'2-digit'}).format(new Date());
const monthName = new Intl.DateTimeFormat('fr-FR', { month:'long', year:'numeric', timeZone:'UTC' });
const [currentYear, currentIndex] = currentMonth.split('-').map(Number);
for (let year = currentYear; year >= 2026; year--) {
  for (let index = year === currentYear ? currentIndex : 12; index >= 1; index--) {
    const value = year + '-' + String(index).padStart(2, '0');
    month.add(new Option(monthName.format(new Date(Date.UTC(year, index - 1, 1))), value));
  }
}
month.value = currentMonth;
let current = null, busy = false;

function periodLabel(value) {
  const [year, m] = value.split('-').map(Number);
  return 'Du ' + day.format(new Date(Date.UTC(year,m-1,1))) + ' au ' + day.format(new Date(Date.UTC(year,m,0)));
}

function display(sheet) {
  const totals = sheet?.totals;
  const summary = $('member-summary');
  const epics = $('member-epics');
  const results = $('member-results');
  const live = month.value === currentMonth;
  const hours = totals?.total_hours_business ?? 0;
  const days = totals?.total_business_days ?? 0;
  const rounded = totals?.rounded_business_days ?? 0;
  summary.innerHTML = sheet ? `<div class="panel-body member-total"><p>${periodLabel(month.value)}${sheet.asOf && live ? ' · Calcul arrêté le ' + when.format(new Date(sheet.asOf)) : ''}</p><div class="member-total-heading"><h2>${number.format(rounded)} j retenus</h2><strong class="member-validation ${sheet.validatedAt ? 'is-validated' : 'needs-validation'}">${sheet.validatedAt ? 'Validé' : 'À valider'}</strong></div><p>${number.format(hours)} h ouvrées sans doublon · ${number.format(days)} j avant arrondi à la demi-journée supérieure</p></div>` : '';
  epics.innerHTML = sheet?.epics?.length ? `<h2>Activité par epic</h2><p>Les plages communes à plusieurs epics sont réparties à parts égales. L’arrondi s’applique au total du mois.</p>
    <table><thead><tr><th>Epic Jira</th><th>Tickets</th><th>Heures réparties</th><th>Jours avant arrondi</th></tr></thead><tbody>${sheet.epics.map(group=>`<tr><td>${group.key ? jiraLink(group.key) + ' · ' : ''}${escape(group.name)}</td><td>${group.tickets.map(escape).join(', ')}</td><td>${number.format(group.hours)} h</td><td>${number.format(group.hours/9)} j</td></tr>`).join('')}</tbody></table>` : '';
  results.innerHTML = sheet?.tickets.length ? `<details><summary>Détail par ticket (${sheet.tickets.length})</summary><table><thead><tr><th>Ticket</th><th>Epic</th><th>Statut</th><th>Périodes d’assignation</th><th>Jours (9 h / j)</th></tr></thead><tbody>
    ${sheet.tickets.map(ticket=>`<tr><td>${jiraLink(ticket.key)}<br>${escape(ticket.summary)}</td><td>${ticket.epic_key ? jiraLink(ticket.epic_key) : 'Non identifié'}</td><td>${escape(ticket.status || 'Done')}</td><td><details><summary>${number.format(ticket.hours_business)} h ouvrées</summary>${sheet.periods.filter(p=>p.key===ticket.key).map(p=>`<div>${when.format(new Date(p.start))} → ${when.format(new Date(p.end))} · ${number.format(p.hours_business)} h ouvrées</div>`).join('')}</details></td><td>${number.format(ticket.business_days)} j</td></tr>`).join('')}</tbody></table></details>` : '';
}
function jiraLink(key) {
  return `<a target="_blank" rel="noopener noreferrer" href="https://accor-it.atlassian.net/browse/${encodeURIComponent(key)}">${escape(key)}</a>`;
}
async function request(action) {
  const response = await fetch('/api/member/sheet?' + new URLSearchParams({month:month.value}), action ? {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,version:current?.version})
  } : {});
  if (response.status === 401) { location.replace('/'); throw Error('Reconnectez-vous.'); }
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}
async function read(action) {
  if (busy || !month.value) return;
  busy = true;
  refresh.disabled = validate.disabled = month.disabled = true;
  status.textContent = action === 'validate' ? 'Validation de la fiche…' : 'Calcul de l’activité depuis Jira…';
  try {
    let data = await request(action === 'open' ? undefined : action);
    if (action === 'open' && !data.sheet?.validatedAt) data = await request('refresh');
    $('member-name').textContent = data.name;
    current = data.sheet;
    validate.hidden = !current || Boolean(current.validatedAt);
    status.textContent = current?.validatedAt ? 'Validation enregistrée le ' + when.format(new Date(current.validatedAt))
      : current?.tickets.length ? 'Vérifiez les périodes avant de valider la fiche.' : 'Aucune période d’assignation correspondant au mois.';
    display(current);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
    month.disabled = validate.disabled = false;
    refresh.disabled = Boolean(current?.validatedAt);
  }
}
month.addEventListener('change', () => {
  current = null;
  validate.hidden = true;
  display(null);
  read('open');
});
refresh.addEventListener('click', () => read('refresh'));
validate.addEventListener('click', () => {
  if (current && confirm('Valider la fiche et figer le résultat de ce mois ?')) read('validate');
});
read('open');

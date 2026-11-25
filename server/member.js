const $ = id => document.getElementById(id);
const month = $('member-month');
const status = $('member-status');
const refresh = $('member-load');
const validate = $('member-validate');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const when = new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'});
const currentMonth = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Paris',year:'numeric',month:'2-digit'}).format(new Date());
month.value = currentMonth;
$('activity-panel').hidden = month.value !== currentMonth;
let current = null, busy = false;
async function read(action) {
  if (busy || !month.value) return;
  busy = true;
  refresh.disabled = validate.disabled = month.disabled = true;
  status.textContent = action === 'refresh' ? 'Lecture de l’historique Jira…' : 'Chargement de la fiche…';
  try {
    const response = await fetch('/api/member/sheet?' + new URLSearchParams({month:month.value}), action ? {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,version:current?.version})
    } : {});
    if (response.status === 401) { location.replace('/'); return; }
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    $('member-name').textContent = data.name;
    current = data.sheet;
    validate.hidden = !current || Boolean(current.validatedAt);
    status.textContent = !current ? 'Aucune fiche chargée pour ce mois. Lancez la lecture Jira.'
      : current.validatedAt ? 'Fiche validée le ' + when.format(new Date(current.validatedAt))
      : current.tickets.length ? 'Vérifiez les périodes puis validez votre fiche.' : 'Aucun ticket correspondant trouvé pour ce mois. Vous pouvez confirmer cette fiche à zéro.';
    const totals = current?.totals;
    $('member-summary').textContent = totals
      ? number.format(totals.total_hours_business) + ' h ouvrées sans doublon · ' + number.format(totals.total_business_days) + ' j · ' + number.format(totals.total_worklog_hours) + ' h saisies dans Jira'
      : '';
    $('member-results').innerHTML = current?.tickets.length ? `<table><thead><tr><th>Ticket</th><th>Type</th><th>Passé en Done</th><th>Assignation et périodes</th><th>Jours (9 h / j)</th><th>Temps Jira</th></tr></thead><tbody>${current.tickets.map(ticket => `<tr><td><a target="_blank" rel="noopener noreferrer" href="https://accor-it.atlassian.net/browse/${escape(ticket.key)}">${escape(ticket.key)}</a><br>${escape(ticket.summary)}</td><td>${escape(ticket.issuetype)}</td><td>${when.format(new Date(ticket.done_date))}</td><td><details><summary>${number.format(ticket.hours_business)} h</summary>${current.periods.filter(p=>p.key===ticket.key).map(p=>`<div>${when.format(new Date(p.start))} → ${when.format(new Date(p.end))} · ${number.format(p.hours_business)} h ouvrées</div>`).join('')}</details></td><td>${number.format(ticket.business_days)} j</td><td>${number.format(ticket.worklog_hours)} h</td></tr>`).join('')}</tbody></table>` : '';
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
  $('activity-panel').hidden = month.value !== currentMonth;
  validate.hidden = true;
  $('member-summary').textContent = '';
  $('member-results').textContent = '';
  read();
});
refresh.addEventListener('click', () => read('refresh'));
validate.addEventListener('click', () => {
  if (current && confirm('Valider définitivement la fiche pour ce mois ?')) read('validate');
});
read();


$('member-activity').addEventListener('click', async event => {
  const button = event.currentTarget;
  const feedback = $('activity-status');
  const results = $('activity-results');
  button.disabled = true;
  feedback.textContent = 'Calcul des périodes d’assignation dans Jira…';
  results.textContent = '';
  try {
    const response = await fetch('/api/member/sheet?' + new URLSearchParams({month:currentMonth}), {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'activity'})
    });
    if (response.status === 401) { location.replace('/'); return; }
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    const { activity } = data;
    const totals = activity.totals;
    feedback.textContent = totals
      ? number.format(totals.total_hours_business) + ' h ouvrées sans doublon · ' + number.format(totals.total_business_days) + ' j · Calcul arrêté le ' + when.format(new Date(activity.asOf))
      : 'Aucune période d’assignation éligible trouvée pour le mois en cours.';
    if (!totals) return;
    results.innerHTML = `<table><thead><tr><th>Ticket</th><th>Statut Jira</th><th>Périodes d’assignation</th><th>Jours (9 h / j)</th></tr></thead><tbody>${activity.tickets.map(ticket => `<tr><td><a href="https://accor-it.atlassian.net/browse/${escape(ticket.key)}" target="_blank" rel="noopener noreferrer">${escape(ticket.key)}</a><br>${escape(ticket.summary)}</td><td>${escape(ticket.status)}</td><td><details><summary>${number.format(ticket.hours_business)} h ouvrées</summary>${activity.periods.filter(p=>p.key===ticket.key).map(p=>`<div>${when.format(new Date(p.start))} → ${when.format(new Date(p.end))} · ${number.format(p.hours_business)} h ouvrées</div>`).join('')}</details></td><td>${number.format(ticket.business_days)} j</td></tr>`).join('')}</tbody></table>`;
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

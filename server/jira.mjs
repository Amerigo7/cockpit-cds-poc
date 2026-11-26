const cloud = '7fc30b42-e831-4c22-aef3-5e0bbb7c692e';
const epicFilter = 'project = OP AND issuetype = Epic';
const keyPattern = /^OP-[1-9]\d*$/;

export async function searchEpics({ query = '', cursor, keys } = {}, fetcher = fetch, env = process.env) {
  const email = env.JIRA_EMAIL?.trim();
  const token = env.JIRA_API_TOKEN?.trim();
  const missing = [!email && 'JIRA_EMAIL', !token && 'JIRA_API_TOKEN'].filter(Boolean);
  if (missing.length) throw Error('Configuration Jira OP manquante : ' + missing.join(', '));
  const term = query.trim().slice(0, 80);
  let filter = '';
  if (keys) {
    if (keys.some(key => !keyPattern.test(key))) throw Error('Sélectionnez uniquement des epics du projet Jira OP.');
    filter = ' AND key IN (' + keys.join(',') + ')';
  } else if (keyPattern.test(term.toUpperCase())) {
    filter = ' AND key = ' + term.toUpperCase();
  } else if (term) {
    const words = term.replace(/[^\p{L}\p{N} -]/gu, ' ').trim();
    if (!words) return { epics: [], cursor: null };
    filter = ' AND summary ~ "' + words + '"';
  }
  const auth = Buffer.from(email + ':' + token).toString('base64');
  const response = await fetcher('https://api.atlassian.com/ex/jira/' + cloud + '/rest/api/3/search/jql', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: 'Basic ' + auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: epicFilter + filter + ' ORDER BY created DESC',
      fields: ['summary'], maxResults: 50, ...(cursor ? { nextPageToken: cursor } : {})
    })
  });
  if (!response.ok) throw Error('Jira OP ne répond pas à la recherche (' + response.status + '). Vérifiez les droits de lecture du compte Jira.');
  const result = await response.json();
  return {
    epics: result.issues.filter(issue => keyPattern.test(issue.key)).map(issue => ({
      key: issue.key, title: issue.fields?.summary || ''
    })),
    cursor: result.nextPageToken || null
  };
}

export function epicKeys(value) {
  return String(value || '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
}

export async function verifyNewEpicLinks(current, projects, search = searchEpics) {
  const previous = new Map(current.projects.map(project => [project.id, new Set(epicKeys(project.epics))]));
  const added = new Set();
  const assigned = new Set();
  for (const project of projects) {
    for (const key of epicKeys(project.epics)) {
      if (assigned.has(key)) throw Error('Un epic ne peut être rattaché qu’à un projet par PO : ' + key);
      assigned.add(key);
      if (!previous.get(project.id)?.has(key)) added.add(key);
    }
  }
  const keys = [...added];
  for (let i = 0; i < keys.length; i += 40) {
    const batch = keys.slice(i, i + 40);
    const result = await search({ keys: batch });
    const found = new Set(result.epics.map(epic => epic.key));
    const missing = batch.filter(key => !found.has(key));
    if (missing.length) throw Error('Epics Jira OP introuvables ou non accessibles : ' + missing.join(', '));
  }
}

const parisDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
});
const ticketKey = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;

export async function previewWorklogs(cockpit, month, fetcher = fetch, env = process.env) {
  const epicProjects = new Map();
  for (const project of cockpit.projects) {
    if (project.start.slice(0, 7) > month || project.end.slice(0, 7) < month) continue;
    for (const key of epicKeys(project.epics)) {
      if (!keyPattern.test(key) || epicProjects.has(key)) throw Error('Vérifiez les rattachements Jira OP du PO.');
      epicProjects.set(key, project);
    }
  }
  if (!epicProjects.size) return { rows: [], linkedEpics: 0, issueCount: 0, excluded: 0 };
  const email = env.JIRA_EMAIL?.trim(), token = env.JIRA_API_TOKEN?.trim();
  if (!email || !token) throw Error('La connexion Jira OP doit être configurée sur le serveur.');
  const deadline = Date.now() + 23000;
  const auth = Buffer.from(email + ':' + token).toString('base64');
  async function request(path, body) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error('Jira a pris trop de temps. Aucune proposition partielle n’a été chargée.');
    const response = await fetcher('https://api.atlassian.com/ex/jira/' + cloud + '/rest/api/3/' + path, {
      redirect: 'error', signal: AbortSignal.timeout(Math.min(8000, remaining)),
      headers: { Authorization: 'Basic ' + auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw Error('Lecture des temps Jira impossible (HTTP ' + response.status + '). Vérifiez les droits de lecture des temps.');
    return response.json();
  }
  const issues = new Map();
  async function children(parents) {
    for (let first = 0; first < parents.length; first += 40) {
      const batch = parents.slice(first, first + 40);
      let cursor;
      const seen = new Set();
      do {
        const page = await request('search/jql', {
          jql: 'parent IN (' + batch.join(',') + ') ORDER BY key ASC',
          fields: ['parent'], maxResults: 100, ...(cursor ? { nextPageToken: cursor } : {})
        });
        for (const issue of page.issues) {
          const key = issue.key, parent = issue.fields?.parent?.key;
          const project = epicProjects.get(parent) ?? issues.get(parent);
          if (!ticketKey.test(key) || !project || issues.has(key)) continue;
          issues.set(key, project);
          if (issues.size > 350) throw Error('Plus de 350 tickets rattachés aux epics actives. Réduisez le périmètre Jira avant de réessayer.');
        }
        cursor = page.nextPageToken;
        if (seen.has(cursor)) throw Error('Pagination Jira incomplète.');
        seen.add(cursor);
      } while (cursor);
    }
  }
  await children([...epicProjects.keys()]);
  await children([...issues.keys()]); // Include subtasks of the epic’s issues.
  const from = Date.parse(month + '-01T00:00:00Z');
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  // Request a padded UTC window, then apply the exact Paris month locally.
  const buffer = 86400000;
  const work = [...issues];
  const rows = new Map(), seenLogs = new Set();
  let excluded = 0;
  async function collect() {
    while (work.length) {
      const [key, project] = work.pop();
      let offset = 0;
      for (;;) {
        const params = new URLSearchParams({
          startedAfter: String(from - buffer), startedBefore: String(+to + buffer),
          startAt: String(offset), maxResults: '100'
        });
        const page = await request('issue/' + key + '/worklog?' + params);
        for (const log of page.worklogs) {
          if (!log.id || !Number.isFinite(log.timeSpentSeconds) || log.timeSpentSeconds <= 0 ||
              !Number.isFinite(Date.parse(log.started)) || seenLogs.has(log.id)) continue;
          const date = parisDate.format(new Date(log.started));
          if (!date.startsWith(month + '-')) continue;
          seenLogs.add(log.id);
          if (date < project.start || date > project.end) { excluded++; continue; }
          const account = log.author?.accountId || 'unknown';
          const id = JSON.stringify([project.id, account]);
          if (!rows.has(id)) rows.set(id, {
            projectId: project.id, projectName: project.name, account, author: log.author?.displayName || 'Intervenant inconnu',
            seconds: 0, tickets: new Set()
          });
          const row = rows.get(id);
          row.seconds += log.timeSpentSeconds;
          row.tickets.add(key);
        }
        offset += page.worklogs.length;
        if (offset >= page.total) break;
        if (!page.worklogs.length) throw Error('Pagination des temps Jira incomplète.');
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(6, work.length)}, collect));
  return {
    rows: [...rows.values()].map(row => ({ ...row, tickets: [...row.tickets].sort() }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.author.localeCompare(b.author)),
    linkedEpics: epicProjects.size, issueCount: issues.size, excluded
  };
}

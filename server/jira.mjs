const cloud = '7fc30b42-e831-4c22-aef3-5e0bbb7c692e';
const epicFilter = 'project = OP AND issuetype = Epic';
const keyPattern = /^OP-[1-9]\d*$/;

export async function searchEpics({ query = '', cursor, keys } = {}, fetcher = fetch, env = process.env) {
  if (!env.JIRA_EMAIL || !env.JIRA_API_TOKEN) throw Error('La connexion Jira OP doit être configurée sur le serveur.');
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
  const auth = Buffer.from(env.JIRA_EMAIL + ':' + env.JIRA_API_TOKEN).toString('base64');
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

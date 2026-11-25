import test from 'node:test';
import assert from 'node:assert/strict';
import { searchEpics, verifyNewEpicLinks, previewWorklogs } from '../server/jira.mjs';

test('la recherche Jira reste limitée aux epics OP et conserve la pagination', async () => {
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(url, /^https:\/\/api\.atlassian\.com\//);
    assert.equal(body.jql, 'project = OP AND issuetype = Epic AND key = OP-123 ORDER BY created DESC');
    assert.equal(body.nextPageToken, 'next');
    return { ok: true, json: async () => ({
      issues: [{ key: 'OP-123', fields: { summary: 'Exemple' } }, { key: 'OTHER-1' }],
      nextPageToken: 'following'
    }) };
  };
  const env = { JIRA_EMAIL: 'fixture@example.test', JIRA_API_TOKEN: 'fixture' };
  assert.deepEqual(await searchEpics({ query: 'op-123', cursor: 'next' }, fetcher, env), {
    epics: [{ key: 'OP-123', title: 'Exemple' }], cursor: 'following'
  });
});

test('un nouveau rattachement est vérifié et les doublons dans un PO sont refusés', async () => {
  const original = { projects: [{ id: 'a', epics: 'OP-1' }] };
  const search = async ({ keys }) => {
    assert.deepEqual(keys, ['OP-2']);
    return { epics: [{ key: 'OP-2' }] };
  };
  await verifyNewEpicLinks(original, [{ id: 'a', epics: 'OP-1, OP-2' }], search);
  await assert.rejects(verifyNewEpicLinks(original, [{ id: 'a', epics: 'OP-1' }, { id: 'b', epics: 'OP-1' }], search), /qu’à un projet/);
  await assert.rejects(verifyNewEpicLinks(original, [{ id: 'a', epics: 'OP-2' }], async () => ({ epics: [] })), /introuvables/);
});

test('les temps Jira suivent le projet de l’epic, le mois de Paris et les dates projet', async () => {
  const c = { projects: [{ id: 'p', name: 'Max V2', start: '2027-01-01', end: '2027-01-25', epics: 'OP-1' }] };
  const log = (id, started, seconds) => ({
    id, started, timeSpentSeconds: seconds, author: { accountId: 'a', displayName: 'Test' }
  });
  const answer = data => ({ ok: true, json: async () => data });
  const fetcher = async (url, options) => {
    if (url.endsWith('search/jql')) {
      const { jql } = JSON.parse(options.body);
      return answer({ issues: jql.includes('(OP-1)')
        ? [{ key: 'OP-2', fields: { parent: { key: 'OP-1' } } }]
        : [{ key: 'OP-3', fields: { parent: { key: 'OP-2' } } }] });
    }
    if (url.includes('/OP-2/')) {
      return answer({ total: 2, worklogs: url.includes('startAt=0')
        ? [log('1', '2026-12-31T23:30:00Z', 3600)]
        : [log('2', '2027-01-28T09:00:00Z', 7200)] });
    }
    return answer({ total: 2, worklogs: [
      log('3', '2027-01-10T09:00:00Z', 7200),
      log('4', '2027-01-31T23:30:00Z', 14400)
    ] });
  };
  const result = await previewWorklogs(c, '2027-01', fetcher, { JIRA_EMAIL:'test@example.test', JIRA_API_TOKEN:'test' });
  assert.deepEqual(result, {
    linkedEpics: 1, issueCount: 2, excluded: 1,
    rows: [{ projectId: 'p', projectName: 'Max V2', account: 'a', author: 'Test', seconds: 10800, tickets: ['OP-2','OP-3'] }]
  });
});

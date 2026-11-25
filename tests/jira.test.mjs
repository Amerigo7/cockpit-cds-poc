import test from 'node:test';
import assert from 'node:assert/strict';
import { searchEpics, verifyNewEpicLinks } from '../server/jira.mjs';

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

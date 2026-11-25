import test from 'node:test';
import assert from 'node:assert/strict';
import { initialStore, finances } from '../dist/domain.js';
import { applyAction } from '../server/actions.mjs';

test('Jennifer active le PO, Lassaad transmet et seul Laurent impute la facture', () => {
  const store = initialStore();
  const c = store.cockpits[0];
  assert.throws(() => applyAction(store, 'lassaad', 'definition', [c, true]));
  applyAction(store, 'jennifer', 'definition', [structuredClone(c), true]);
  const lines = [{ projectId: c.projects[0].id, roleId: 'dev', days: 2 }];
  assert.throws(() => applyAction(store, 'laurent', 'createInvoice', ['2027-01', lines, false]));
  const invoice = applyAction(store, 'lassaad', 'createInvoice', ['2027-01', lines, false]);
  const patch = { number: invoice.number, date: invoice.date, lines: invoice.lines };
  applyAction(store, 'lassaad', 'editInvoice', [invoice.id, patch, true]);
  assert.throws(() => applyAction(store, 'jennifer', 'review', [invoice.id, '', 'validate']));
  assert.equal(finances(c).actual, 0);
  applyAction(store, 'laurent', 'review', [invoice.id, '', 'validate']);
  assert.equal(finances(c).actual, 950);
});

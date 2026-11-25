import test from 'node:test';
import assert from 'node:assert/strict';
import { initialStore, finances, visiblePoInvoices, pendingInvoiceDiscrepancies } from '../dist/domain.js';
import { applyAction } from '../server/actions.mjs';

test('Jennifer active le PO, Lassaad transmet et seul Laurent impute la facture', () => {
  const store = initialStore();
  const c = store.cockpits[0];
  assert.throws(() => applyAction(store, 'lassaad', 'definition', [c, true]));
  applyAction(store, 'jennifer', 'definition', [structuredClone(c), true]);
  const lines = [{ projectId: c.projects[0].id, roleId: 'dev', days: 2 }];
  assert.throws(() => applyAction(store, 'laurent', 'createInvoice', ['2027-01', lines, false]));
  assert.throws(() => applyAction(store, 'lassaad', 'createInvoice', ['2027-01', lines, false]), /ventilation/);
  applyAction(store, 'lassaad', 'expense', ['2027-01', lines, false]);
  const invoice = applyAction(store, 'lassaad', 'createInvoice', ['2027-01']);
  const patch = { number: invoice.number, date: invoice.date, lines: invoice.lines };
  applyAction(store, 'lassaad', 'editInvoice', [invoice.id, patch, true]);
  assert.throws(() => applyAction(store, 'jennifer', 'review', [invoice.id, '', 'validate']));
  assert.equal(finances(c).actual, 0);
  applyAction(store, 'laurent', 'review', [invoice.id, '', 'validate']);
  assert.equal(finances(c).actual, 950);
});

test('les PO partagés sont indépendants et leurs références sont uniques', () => {
  const store = initialStore();
  const original = store.cockpits[0];
  const second = applyAction(store, 'jennifer', 'newCockpit', ['#124178']);
  assert.equal(second.poRef, '124178');
  assert.notEqual(second.id, original.id);
  assert.equal(store.activeId, original.id);
  assert.throws(() => applyAction(store, 'laurent', 'newCockpit', ['124178']), /déjà/);
  assert.throws(() => applyAction(store, 'lassaad', 'newCockpit', ['124179']), /profil/);
  const update = { ...structuredClone(second), name: 'Autre portefeuille' };
  applyAction(store, 'laurent', 'definition', [update, false], second.id);
  assert.equal(second.name, 'Autre portefeuille');
  assert.notEqual(original.name, second.name);
});

test('seul l’owner désigné voit l’alerte et peut valider une facture reçue', () => {
  const store = initialStore();
  const c = applyAction(store, 'laurent', 'newCockpit', ['124199', 'jennifer']);
  assert.equal(c.owner, 'Jennifer');
  const demo = store.cockpits[0];
  const definition = { ...structuredClone(demo), poRef: c.poRef, owner: c.owner };
  assert.throws(() => applyAction(store, 'laurent', 'definition', [{ ...definition, owner: 'Laurent' }, true], c.id), /défini à la création/);
  applyAction(store, 'laurent', 'definition', [definition, true], c.id);
  const lines = [{ projectId: c.projects[0].id, roleId: 'dev', days: 2 }];
  applyAction(store, 'lassaad', 'expense', ['2027-01', lines, false], c.id);
  const i = applyAction(store, 'lassaad', 'createInvoice', ['2027-01'], c.id);
  assert.equal(visiblePoInvoices(c, 'jennifer').length, 0);
  const patch = { number: i.number, date: i.date, supplierNote: 'Écart de démo', lines: i.lines.map(l => ({ ...l, billedRate: l.billedRate + 10 })) };
  applyAction(store, 'lassaad', 'editInvoice', [i.id, patch, true], c.id);
  assert.equal(visiblePoInvoices(c, 'laurent').length, 0);
  assert.equal(pendingInvoiceDiscrepancies(c, 'laurent').length, 0);
  assert.equal(pendingInvoiceDiscrepancies(c, 'jennifer').length, 1);
  assert.throws(() => applyAction(store, 'laurent', 'review', [i.id, 'Contrôle', 'validate'], c.id), /owner/);
  applyAction(store, 'jennifer', 'review', [i.id, 'Écart accepté', 'validate'], c.id);
  assert.equal(pendingInvoiceDiscrepancies(c, 'jennifer').length, 0);
  assert.equal(finances(c).actual, 970);
});

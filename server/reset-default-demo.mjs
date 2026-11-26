import { createInvoice, demoCockpit, editInvoice, newCockpit, saveExpense, sendInvoice } from '../dist/domain.js';

function restoredDemo(store) {
  const currentDemo = store.cockpits.find(c => c.poRef === '124177');
  const currentExample = store.cockpits.find(c => c.poRef === 'TEST FACTU');
  if (!currentDemo || !currentExample) return null;

  const demo = demoCockpit();
  demo.id = currentDemo.id;
  const example = newCockpit(2027);
  Object.assign(example, {
    id: currentExample.id, poRef: 'TEST FACTU', name: 'TEST FACTU', budget: 10000, status: 'active'
  });
  const project = example.projects[0];
  Object.assign(project, { name: 'Projet de recette', budget: 10000, start: example.start, end: example.end });
  project.device.dev = 1;
  const month = example.reportMonth;
  saveExpense(example, month, [{ projectId: project.id, roleId: 'dev', days: 2 }], 'lassaad');
  const invoice = createInvoice(example, month, 'lassaad');
  editInvoice(example, invoice.id, {
    number: invoice.number, date: invoice.date,
    supplierNote: 'Écart de démonstration : 10 € par jour de plus sur 2 jours Dev.',
    lines: invoice.lines.map(line => ({ ...line, billedRate: line.billedRate + 10 }))
  }, 'lassaad');
  sendInvoice(example, invoice.id, 'lassaad');

  return {
    ...store,
    activeId: demo.id,
    cockpits: store.cockpits.map(c => c.id === demo.id ? demo : c.id === example.id ? example : c)
  };
}

async function saveRestoredDemo(db, store, revision) {
  const reset = restoredDemo(store);
  if (!reset) return 'missing';
  const result = await db.query('UPDATE cockpit SET state = $1, revision = revision + 1 WHERE id = 1 AND revision = $2', [reset, revision]);
  return result.rowCount === 1 ? 'reset' : 'conflict';
}

export async function resetDemo(db) {
  const { rows: [row] } = await db.query('SELECT revision, state FROM cockpit WHERE id = 1');
  if (!row) return 'missing';
  return saveRestoredDemo(db, row.state, row.revision);
}

// One-time cleanup of the hosted Admin acceptance test.
export async function resetDefaultDemo(db) {
  const revision = 46;
  const { rows: [row] } = await db.query('SELECT state FROM cockpit WHERE id = 1 AND revision = $1', [revision]);
  if (!row) return;
  const store = row.state;
  const currentDemo = store.cockpits.find(c => c.poRef === '124177');
  const currentExample = store.cockpits.find(c => c.poRef === 'TEST FACTU');
  if (store.cockpits.length !== 2 || currentDemo?.status !== 'active' ||
      currentDemo.invoices.length !== 1 || currentDemo.invoices[0].status !== 'sent' ||
      currentExample?.invoices.length !== 1 || currentExample.invoices[0].status !== 'validated') return;

  if (await saveRestoredDemo(db, store, revision) === 'reset') console.info('Copie de démonstration réinitialisée.');
}

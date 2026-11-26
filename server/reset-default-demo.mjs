import { createInvoice, demoCockpit, editInvoice, newCockpit, saveExpense, sendInvoice } from '../dist/domain.js';

// Reset the exact demo state requested by the user. The revision check also
// prevents this one-time reset from overwriting changes on future restarts.
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

  const reset = { ...store, activeId: demo.id, cockpits: [demo, example] };
  const result = await db.query('UPDATE cockpit SET state = $1, revision = revision + 1 WHERE id = 1 AND revision = $2', [reset, revision]);
  if (result.rowCount) console.info('Copie de démonstration réinitialisée.');
}

import { createInvoice, editInvoice, saveExpense, sendInvoice } from '../dist/domain.js';

// One-off reset of the exact dashboard snapshot reviewed for the acceptance test.
export async function resetReceiptWorkspace(db) {
  const revision = 26;
  const { rows: [row] } = await db.query('SELECT state FROM cockpit WHERE id = 1 AND revision = $1', [revision]);
  if (!row) return;
  const store = row.state;
  const demo = store.cockpits.find(c => c.id === 'cockpit-fbcb6d7b-bfcd-4a78-bb13-4bc3d649fd01' && c.poRef === '124177');
  const receipt = store.cockpits.find(c => c.id === 'cockpit-62719634-a7ec-47e4-a5dc-a473d2600472' && c.poRef === 'RECETTE-ECART-124177');
  if (!demo || !receipt || receipt.invoices[0]?.status !== 'validated') return;

  Object.assign(demo, { status: 'draft', expenses: {}, invoices: [], audit: [] });
  Object.assign(receipt, { poRef: 'TEST FACTU', name: 'TEST FACTU', expenses: {}, invoices: [], audit: [] });
  const [project] = receipt.projects;
  const month = receipt.reportMonth;
  saveExpense(receipt, month, [{ projectId: project.id, roleId: 'dev', days: 2 }], 'lassaad');
  const invoice = createInvoice(receipt, month, 'lassaad');
  editInvoice(receipt, invoice.id, {
    number: invoice.number, date: invoice.date,
    supplierNote: 'Écart volontaire de démonstration : 10 € par jour de plus sur 2 jours Dev.',
    lines: invoice.lines.map(line => ({ ...line, billedRate: line.billedRate + 10 }))
  }, 'lassaad');
  sendInvoice(receipt, invoice.id, 'lassaad');

  const reset = { ...store, activeId: demo.id, cockpits: [demo, receipt] };
  const result = await db.query('UPDATE cockpit SET state = $1, revision = revision + 1 WHERE id = 1 AND revision = $2', [reset, revision]);
  if (result.rowCount) console.info('Remise à zéro des PO terminée.');
}

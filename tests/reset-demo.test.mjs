import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCockpit, invoiceTotals, newCockpit } from '../dist/domain.js';
import { resetDemo } from '../server/reset-default-demo.mjs';

function fakeDatabase(cockpits, conflicts = false) {
  const db = {
    state: { activeId: cockpits.at(-1).id, cockpits },
    revision: 88,
    writes: 0,
    async query(statement, args) {
      if (statement.startsWith('SELECT')) return { rows: [{ state: this.state, revision: this.revision }] };
      this.writes++;
      if (conflicts || args[1] !== this.revision) return { rowCount: 0 };
      this.state = args[0];
      this.revision++;
      return { rowCount: 1 };
    }
  };
  return db;
}

test('la remise à zéro recrée seulement les deux PO et supporte plusieurs démonstrations', async () => {
  const max = demoCockpit();
  max.status = 'active';
  max.projects[0].epics = 'OP-42';
  const other = { ...newCockpit(), poRef: 'AUTRE' };
  const billing = { ...newCockpit(), poRef: 'TEST FACTU' };
  const db = fakeDatabase([max, other, billing]);

  for (let run = 0; run < 2; run++) {
    assert.equal(await resetDemo(db), 'reset');
    const [resetMax, sameOther, resetBilling] = db.state.cockpits;
    assert.equal(resetMax.id, max.id);
    assert.equal(resetMax.status, 'draft');
    assert.equal(resetMax.projects.length, 4);
    assert.ok(resetMax.projects.every(project => !project.epics));
    assert.deepEqual(resetMax.expenses, {});
    assert.deepEqual(resetMax.invoices, []);
    assert.equal(db.state.activeId, max.id);
    assert.strictEqual(sameOther, other);
    assert.equal(resetBilling.id, billing.id);
    const [invoice] = resetBilling.invoices;
    assert.equal(resetBilling.invoices.length, 1);
    assert.equal(invoice.status, 'sent');
    const { expected, billed, delta } = invoiceTotals(invoice);
    assert.deepEqual({ expected, billed, delta }, { expected: 950, billed: 970, delta: 20 });
  }
});

test('la remise à zéro protège les mises à jour concurrentes et exige les deux PO', async () => {
  const max = demoCockpit();
  const billing = { ...newCockpit(), poRef: 'TEST FACTU' };
  const conflicting = fakeDatabase([max, billing], true);
  assert.equal(await resetDemo(conflicting), 'conflict');
  assert.equal(conflicting.revision, 88);
  const missing = fakeDatabase([max]);
  assert.equal(await resetDemo(missing), 'missing');
  assert.equal(missing.writes, 0);
});

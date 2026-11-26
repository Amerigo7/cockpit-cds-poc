import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const extractor = fileURLToPath(new URL('../scripts/jira_assignee_time.py', import.meta.url));
const extraction = new Map();
const monthFormat = /^\d{4}-(0[1-9]|1[0-2])$/;

export function memberConfig(env = process.env) {
  const email = env.CDS_MEMBER_EMAIL?.trim().toLowerCase();
  const password = env.CDS_MEMBER_PASSWORD;
  const account = env.CDS_MEMBER_JIRA_ID?.trim();
  const name = env.CDS_MEMBER_NAME?.trim();
  return email && password?.length >= 20 && account && name ? { email, password, account, name } : null;
}

export function businessSheet(snapshot) {
  const { totals, tickets, periods, ...metadata } = snapshot;
  return {
    ...metadata,
    totals: totals ? {
      assignee_name: totals.assignee_name,
      nb_tickets: totals.nb_tickets,
      total_hours_business: totals.total_hours_business,
      total_worklog_hours: totals.total_worklog_hours,
      total_business_days: totals.total_hours_business / 9,
      rounded_business_days: Math.ceil(totals.total_hours_business / 4.5) / 2
    } : null,
    tickets: tickets.map(({ hours_calendar, ...ticket }) => ({ ...ticket, business_days: ticket.hours_business / 9 })),
    periods: periods.map(({ hours_calendar, ...period }) => ({ ...period, business_days: period.hours_business / 9 }))
  };
}

export async function getMemberSheet(db, member, month) {
  if (!monthFormat.test(month)) throw Error('Sélectionnez un mois valide.');
  const { rows: [row] } = await db.query(
    'SELECT snapshot, version, validated_at FROM cds_member_sheet WHERE email = $1 AND month = $2',
    [member.email, month]
  );
  return row ? { ...businessSheet(row.snapshot), version: row.version, validatedAt: row.validated_at } : null;
}

async function extractSheet(member, month) {
  let stdout;
  try {
    ({ stdout } = await execute('python3', [
      extractor, '--month', month, '--assignee', member.account, '--business-hours', '--clip-month', '--json', '--activity'
    ], {
      timeout: 26000,
      maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH, JIRA_EMAIL: process.env.JIRA_EMAIL, JIRA_API_TOKEN: process.env.JIRA_API_TOKEN }
    }));
  } catch (error) {
    const stderr = String(error.stderr || '');
    const status = stderr.match(/HTTP (\d{3})/)?.[1];
    const category = error.killed ? 'timeout' : stderr.match(/^(\w+Error):/m)?.[1] || error.code || 'unknown';
    const counts = stderr.match(/INFO \d+ (?:tickets candidats|entrées d’historique)/g) || [];
    console.warn('Calcul mensuel Jira échoué', { category, status, counts });
    throw Error(status ? 'Lecture Jira impossible (HTTP ' + status + ').' : 'La lecture Jira n’a pas abouti. Réessayez.');
  }
  const report = JSON.parse(stdout);
  return businessSheet({
    tickets: report.tickets,
    periods: report.periods.map(({assignee_accountId, ...period}) => period),
    totals: report.people[0] || null,
    loadedAt: new Date().toISOString(),
    asOf: report.as_of,
    epics: report.epics
  });
}

export async function refreshMemberSheet(db, member, month) {
  const currentMonth = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit'
  }).format(new Date());
  if (!monthFormat.test(month) || month > currentMonth) throw Error('Sélectionnez un mois déjà commencé.');
  const existing = await getMemberSheet(db, member, month);
  if (existing?.validatedAt) return existing;
  const key = member.email + ':' + month;
  if (extraction.has(key)) return extraction.get(key);
  const run = (async () => {
    const snapshot = await extractSheet(member, month);
    await db.query(`
      INSERT INTO cds_member_sheet(email, month, snapshot) VALUES ($1,$2,$3)
      ON CONFLICT (email, month) DO UPDATE SET snapshot = EXCLUDED.snapshot, version = cds_member_sheet.version + 1
      WHERE cds_member_sheet.validated_at IS NULL
    `, [member.email, month, snapshot]);
    return getMemberSheet(db, member, month);
  })();
  extraction.set(key, run);
  try { return await run; } finally { extraction.delete(key); }
}

export async function validateMemberSheet(db, member, month, version) {
  if (!monthFormat.test(month) || !Number.isSafeInteger(version)) throw Error('Chargez une fiche à valider.');
  const result = await db.query(`
    UPDATE cds_member_sheet SET validated_at = now()
    WHERE email = $1 AND month = $2 AND version = $3 AND validated_at IS NULL
  `, [member.email, month, version]);
  if (!result.rowCount) throw Error('La fiche a changé ou est déjà validée. Actualisez la page.');
  return getMemberSheet(db, member, month);
}

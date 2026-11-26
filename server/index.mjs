import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { initialStore, getInvoiceForMonth, isPoOwner, visiblePoInvoices, moneyRound } from '../dist/domain.js';
import { applyAction } from './actions.mjs';
import { sessions, loginPage, adminNavigation } from './session.mjs';
import { memberConfig, getMemberSheet, refreshMemberSheet, validateMemberSheet, businessSheet } from './member.mjs';
import { resetReceiptWorkspace } from './reset-receipt.mjs';
import { resetDefaultDemo } from './reset-default-demo.mjs';
import { searchEpics, verifyNewEpicLinks, previewWorklogs } from './jira.mjs';

const roles = ['laurent', 'jennifer', 'lassaad'];
const passwords = Object.fromEntries(roles.map(role => [role, process.env[role.toUpperCase() + '_PASSWORD']]));
if (!process.env.DATABASE_URL || Object.values(passwords).some(value => !value || value.length < 20)) {
  throw Error('DATABASE_URL et les trois mots de passe individuels sont requis.');
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query('CREATE TABLE IF NOT EXISTS cockpit (id integer PRIMARY KEY, revision integer NOT NULL, state jsonb NOT NULL)');
await db.query('INSERT INTO cockpit VALUES (1, 0, $1) ON CONFLICT DO NOTHING', [initialStore()]);

await db.query('CREATE TABLE IF NOT EXISTS cds_session (token_hash text PRIMARY KEY, role text NOT NULL, expires_at timestamptz NOT NULL)');
await db.query('ALTER TABLE cds_session ADD COLUMN IF NOT EXISTS cockpit_opened boolean NOT NULL DEFAULT true');
const member = memberConfig();
if (member) passwords[member.email] = member.password;
await db.query(`CREATE TABLE IF NOT EXISTS cds_member_sheet (
  email text NOT NULL, month text NOT NULL, snapshot jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1, validated_at timestamptz,
  PRIMARY KEY(email, month)
)`);
const adminPassword = process.env.ADMIN_PASSWORD;
const adminEnabled = Boolean(adminPassword && adminPassword.length >= 32 &&
  !Object.values(passwords).includes(adminPassword));
if (adminEnabled) passwords.admin = adminPassword;
const auth = sessions(db, passwords);

// One-time cleanup of the initial hosted acceptance test. The revision guard
// leaves subsequent edits intact, including when this release restarts.
await db.query(`
  UPDATE cockpit
  SET state = jsonb_set(state, '{cockpits,0}',
        (state #> '{cockpits,0}') ||
        '{"status":"draft","expenses":{},"invoices":[],"audit":[]}'::jsonb),
      revision = revision + 1
  WHERE id = 1 AND revision = 4
    AND state #>> '{cockpits,0,poRef}' = '124177'
    AND state #>> '{cockpits,0,status}' = 'active'
    AND state #>> '{cockpits,0,invoices,0,id}' = 'invoice-e7677eea-0ae0-4672-b68f-3d3d0c18f262'
    AND state #>> '{cockpits,0,invoices,0,reviewNote}' = 'Recette du POC partagé'
`);

await resetReceiptWorkspace(db);
await resetDefaultDemo(db);

const assets = { '/cockpit': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/views.js': ['views.js', 'text/javascript'], '/domain.js': ['domain.js', 'text/javascript'] };
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
function visibleState(state, role) {
  const copy = structuredClone(state);
  if (role === 'lassaad') return copy;
  for (const cockpit of copy.cockpits) {
    const visible = new Set(visiblePoInvoices(cockpit, role));
    cockpit.invoices = cockpit.invoices.flatMap(invoice => {
      if (visible.has(invoice)) return [invoice];
      if (invoice.status !== 'validated') return [];
      // Keep only the project totals needed for the shared budget forecast.
      const totals = new Map();
      for (const line of invoice.lines) {
        totals.set(line.projectId, (totals.get(line.projectId) || 0) + moneyRound(line.billedDays * line.billedRate));
      }
      return [{ month: invoice.month, status: 'validated', lines: [...totals].map(([projectId, amount]) => ({ projectId, amount: moneyRound(amount) })) }];
    });
    if (!isPoOwner(cockpit, role)) {
      cockpit.audit = cockpit.audit.filter(event => !/facture/i.test(event.action));
    }
  }
  return copy;
}
async function readBody(req, limit = 500_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('Requête trop volumineuse.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  const requestUrl = new URL(req.url, 'http://localhost');
  const requestPath = requestUrl.pathname;
  const [, view, scopedPath] = /^\/admin\/(laurent|jennifer|lassaad|member)(\/.*)$/.exec(requestPath) || [];
  const path = scopedPath ?? requestPath;
  if (requestPath === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true });
  try {
    if (req.method === 'POST' && ['/login', '/logout'].includes(requestPath)) {
      if (req.headers['sec-fetch-site'] !== 'same-origin') return json(res, 403, { error: 'Requête hors du cockpit.' });
      if (path === '/logout') {
        await auth.logout(req, res);
      } else {
        if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return json(res, 400, { error: 'Formulaire de connexion requis.' });
        const form = new URLSearchParams(await readBody(req, 4096));
        const chosen = form.get('role');
        const role = chosen === 'member' ? (form.get('email') || '').trim().toLowerCase() :
          roles.includes(chosen) || (chosen === 'admin' && adminEnabled) ? chosen : '';
        const ok = chosen === 'member' && role !== member?.email ? false :
          await auth.login(req, res, role, form.get('password') || '');
        if (!ok) return loginPage(res, 'invalid', Boolean(member), chosen, adminEnabled);
      }
      res.writeHead(303, { Location: path === '/logout' ? '/' : '/cockpit' });
      return res.end();
    }
    if (requestPath === '/' && req.method === 'GET') return loginPage(res, '', Boolean(member), '', adminEnabled);
    if (requestPath === '/login.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(await readFile(new URL('./login.js', import.meta.url), 'utf8'));
    }
    const account = await auth.role(req);
    const admin = account === 'admin' && adminEnabled;
    if (view && (!admin || (view === 'member' && !member))) {
      return json(res, 403, { error: 'Changement de profil réservé à un administrateur connecté.' });
    }
    if (!view && path === '/cockpit' && req.method === 'GET') {
      if (admin || !account || !await auth.openCockpit(req)) {
        res.writeHead(303, { Location: admin ? '/admin/laurent/cockpit' : '/' });
        return res.end();
      }
    }
    if ((!account || (account === 'admin' && !view)) && path !== '/style.css') {
      return json(res, 401, { error: 'Connexion au cockpit requise.' });
    }
    const role = view === 'member' ? member.email : view || account;
    const navigation = view ? adminNavigation(view, Boolean(member)) : '';
    if (role && role === member?.email && path !== '/style.css') {
      if (req.method === 'GET' && ['/cockpit','/member.js'].includes(path)) {
        const filename = path === '/cockpit' ? 'member.html' : 'member.js';
        const html = path === '/cockpit';
        res.writeHead(200, { 'Content-Type': (html ? 'text/html' : 'text/javascript') + '; charset=utf-8' });
        const body = await readFile(new URL('./' + filename, import.meta.url), 'utf8');
        return res.end(html ? body.replace('<body>', '<body>' + navigation) : body);
      }
      if (path !== '/api/member/sheet') return json(res, 403, { error: 'Accès réservé à votre fiche CDS.' });
      const month = requestUrl.searchParams.get('month') || '';
      try {
        let sheet;
        if (req.method === 'GET') sheet = await getMemberSheet(db, member, month);
        else if (req.method === 'POST' && req.headers['sec-fetch-site'] === 'same-origin' &&
            req.headers['content-type'] === 'application/json') {
          const { action, version } = JSON.parse(await readBody(req, 4096));
          if (action === 'refresh') sheet = await refreshMemberSheet(db, member, month);
          else if (action === 'validate') {
            sheet = await validateMemberSheet(db, member, month, version);
            if (admin) console.info('Fiche validée via la vue admin membre', { month });
          }
          else return json(res, 400, { error: 'Action inconnue.' });
        } else return json(res, 403, { error: 'Requête hors du cockpit.' });
        return json(res, 200, { name: member.name, sheet });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }
    if (path === '/api/member/submissions' && req.method === 'GET') {
      if (role !== 'lassaad') return json(res, 403, { error: 'Fiches validées réservées au responsable CDS.' });
      const { rows } = await db.query(`
        SELECT month, snapshot, validated_at FROM cds_member_sheet
        WHERE email = $1 AND validated_at IS NOT NULL ORDER BY month DESC
      `, [member?.email || '']);
      return json(res, 200, { name: member?.name, sheets: rows.map(row => ({ ...row, snapshot: businessSheet(row.snapshot) })) });
    }
    if (path === '/api/jira/worklogs' && req.method === 'GET') {
      if (role !== 'lassaad') return json(res, 403, { error: 'Lecture des temps réservée à Lassaad.' });
      const id = requestUrl.searchParams.get('cockpitId');
      const month = requestUrl.searchParams.get('month') || '';
      const { rows: [row] } = await db.query('SELECT revision, state FROM cockpit WHERE id = 1');
      const cockpit = row.state.cockpits.find(c => c.id === id);
      if (!cockpit || cockpit.status !== 'active' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
          month < cockpit.start.slice(0, 7) || month > cockpit.end.slice(0, 7) || month <= cockpit.openingMonth) {
        return json(res, 400, { error: 'Sélectionnez un mois ouvert dans un PO actif.' });
      }
      if (getInvoiceForMonth(cockpit, month)) return json(res, 409, { error: 'Ce mois est verrouillé par une facture.' });
      try {
        return json(res, 200, { ...await previewWorklogs(cockpit, month), revision: row.revision });
      } catch (error) {
        const message = error.name === 'TimeoutError' || error instanceof TypeError
          ? 'Les temps Jira OP sont momentanément indisponibles.' : error.message;
        return json(res, 503, { error: message });
      }
    }
    if (path === '/api/jira/epics' && req.method === 'GET') {
      if (role === 'lassaad') return json(res, 403, { error: 'Recherche Jira réservée à Accor.' });
      try {
        const result = await searchEpics({
          query: requestUrl.searchParams.get('q') || '',
          cursor: requestUrl.searchParams.get('cursor') || undefined
        });
        return json(res, 200, result);
      } catch (error) {
        const message = error.name === 'TimeoutError' || error instanceof TypeError
          ? 'Jira OP est momentanément indisponible.' : error.message;
        return json(res, 503, { error: message });
      }
    }
    if (path === '/api/state' && req.method === 'GET') {
      const { rows: [row] } = await db.query('SELECT revision, state FROM cockpit WHERE id = 1');
      return json(res, 200, { role, revision: row.revision, store: visibleState(row.state, role) });
    }
    if (path === '/api/state' && req.method === 'POST') {
      if (req.headers['sec-fetch-site'] !== 'same-origin' || req.headers['content-type'] !== 'application/json') {
        return json(res, 403, { error: 'Requête hors du cockpit.' });
      }
      const { revision, action, args, cockpitId } = JSON.parse(await readBody(req));
      const { rows: [row] } = await db.query('SELECT revision, state FROM cockpit WHERE id = 1');
      const conflict = () => json(res, 409, { error: 'Le PO a changé depuis votre dernière lecture. Copiez votre saisie si nécessaire, puis actualisez la page avant de réessayer.' });
      if (revision !== row.revision) return conflict();
      let result;
      try {
        const current = row.state.cockpits.find(c => c.id === (cockpitId ?? row.state.activeId));
        const existingProjects = current?.projects;
        result = applyAction(row.state, role, action, args, cockpitId);
        if (action === 'definition') await verifyNewEpicLinks({ projects: existingProjects }, result.projects);
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      const updated = await db.query('UPDATE cockpit SET state = $1, revision = revision + 1 WHERE id = 1 AND revision = $2', [row.state, revision]);
      if (!updated.rowCount) return conflict();
      if (admin) console.info('Action effectuée via la vue admin', { view, action });
      return json(res, 200, { revision: revision + 1, store: visibleState(row.state, role), result: result?.id ? { id: result.id } : null });
    }
    if (req.method === 'GET' && Object.hasOwn(assets, path)) {
      const [file, type] = assets[path];
      let body = await readFile(new URL('../dist/' + file, import.meta.url), 'utf8');
      if (path === '/cockpit') body = body.replace('<html lang="fr">', '<html lang="fr" data-shared>').replace('<body>', '<body>' + navigation);
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      return res.end(body);
    }
    return json(res, 404, { error: 'Page introuvable.' });
  } catch (error) {
    console.error(error.name);
    return json(res, 500, { error: 'Le cockpit partagé est momentanément indisponible.' });
  }
}).listen(Number(process.env.PORT || 4173), '0.0.0.0');

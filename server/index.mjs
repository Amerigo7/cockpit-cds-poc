import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { initialStore } from '../dist/domain.js';
import { applyAction } from './actions.mjs';

const roles = ['laurent', 'jennifer', 'lassaad'];
const passwords = Object.fromEntries(roles.map(role => [role, process.env[role.toUpperCase() + '_PASSWORD']]));
if (!process.env.DATABASE_URL || Object.values(passwords).some(value => !value || value.length < 20)) {
  throw Error('DATABASE_URL et les trois mots de passe individuels sont requis.');
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query('CREATE TABLE IF NOT EXISTS cockpit (id integer PRIMARY KEY, revision integer NOT NULL, state jsonb NOT NULL)');
await db.query('INSERT INTO cockpit VALUES (1, 0, $1) ON CONFLICT DO NOTHING', [initialStore()]);

const assets = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/views.js': ['views.js', 'text/javascript'], '/domain.js': ['domain.js', 'text/javascript'] };
const digest = value => createHash('sha256').update(value).digest();
function authenticatedRole(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  const [role, password = ''] = Buffer.from(header.slice(6), 'base64').toString().split(':', 2);
  return roles.includes(role) && timingSafeEqual(digest(password), digest(passwords[role])) ? role : null;
}
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
function visibleState(state, role) {
  const copy = structuredClone(state);
  const cockpit = copy.cockpits[0];
  if (role !== 'lassaad') {
    for (const invoice of cockpit.invoices) {
      const visible = role === 'laurent' && ['sent', 'returned', 'validated'].includes(invoice.status);
      if (visible) continue;
      delete invoice.supplierNote;
      delete invoice.reviewNote;
      delete invoice.number;
      if (invoice.status !== 'validated') invoice.lines = [];
    }
  }
  return copy;
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 500_000) throw Error('Requête trop volumineuse.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks));
}
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true });
  const role = authenticatedRole(req);
  if (!role) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Cockpit CDS", charset="UTF-8"');
    return json(res, 401, { error: 'Identifiants du testeur requis.' });
  }
  try {
    if (path === '/api/state' && req.method === 'GET') {
      const { rows: [row] } = await db.query('SELECT revision, state FROM cockpit WHERE id = 1');
      return json(res, 200, { role, revision: row.revision, store: visibleState(row.state, role) });
    }
    if (path === '/api/state' && req.method === 'POST') {
      if (req.headers['sec-fetch-site'] !== 'same-origin' || req.headers['content-type'] !== 'application/json') {
        return json(res, 403, { error: 'Requête hors du cockpit.' });
      }
      const { revision, action, args } = await readBody(req);
      const { rows: [row] } = await db.query('SELECT revision, state FROM cockpit WHERE id = 1');
      const conflict = () => json(res, 409, { error: 'Le PO a changé depuis votre dernière lecture. Copiez votre saisie si nécessaire, puis actualisez la page avant de réessayer.' });
      if (revision !== row.revision) return conflict();
      let result;
      try {
        result = applyAction(row.state, role, action, args);
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
      const updated = await db.query('UPDATE cockpit SET state = $1, revision = revision + 1 WHERE id = 1 AND revision = $2', [row.state, revision]);
      if (!updated.rowCount) return conflict();
      return json(res, 200, { revision: revision + 1, store: visibleState(row.state, role), result: result?.id ? { id: result.id } : null });
    }
    if (req.method === 'GET' && Object.hasOwn(assets, path)) {
      const [file, type] = assets[path];
      let body = await readFile(new URL('../dist/' + file, import.meta.url), 'utf8');
      if (path === '/') body = body.replace('<html lang="fr">', '<html lang="fr" data-shared>');
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      return res.end(body);
    }
    return json(res, 404, { error: 'Page introuvable.' });
  } catch (error) {
    console.error(error.name);
    return json(res, 500, { error: 'Le cockpit partagé est momentanément indisponible.' });
  }
}).listen(Number(process.env.PORT || 4173), '0.0.0.0');

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const cookieName = '__Host-cds_session';
const digest = value => createHash('sha256').update(value).digest();
const tokenHash = token => digest(token).toString('hex');
const lifetime = 8 * 60 * 60;
const attributes = '; Path=/; HttpOnly; Secure; SameSite=Lax';

export function sessions(db, passwords) {
  const checkPassword = (role, password) => Object.hasOwn(passwords, role) &&
    timingSafeEqual(digest(password), digest(passwords[role]));
  const readCookie = req => {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim())
      .find(part => part.startsWith(cookieName + '='));
    const token = cookie?.slice(cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token || '') ? tokenHash(token) : null;
  };
  return {
    async role(req) {
      const hash = readCookie(req);
      if (!hash) return null;
      const { rows } = await db.query('SELECT role FROM cds_session WHERE token_hash = $1 AND expires_at > now()', [hash]);
      return rows[0]?.role || null;
    },
    async openCockpit(req) {
      const hash = readCookie(req);
      if (!hash) return false;
      const { rowCount } = await db.query(
        'UPDATE cds_session SET cockpit_opened = true WHERE token_hash = $1 AND expires_at > now() AND NOT cockpit_opened',
        [hash]
      );
      return rowCount === 1;
    },
    async login(req, res, role, password) {
      if (!checkPassword(role, password)) return false;
      const token = randomBytes(32).toString('base64url');
      await db.query('DELETE FROM cds_session WHERE expires_at <= now() OR token_hash = $1', [readCookie(req)]);
      await db.query('INSERT INTO cds_session (token_hash, role, expires_at, cockpit_opened) VALUES ($1, $2, now() + make_interval(secs => $3), false)',
        [tokenHash(token), role, lifetime]);
      res.setHeader('Set-Cookie', cookieName + '=' + token + attributes + '; Max-Age=' + lifetime);
      return true;
    },
    async logout(req, res) {
      const hash = readCookie(req);
      if (hash) await db.query('DELETE FROM cds_session WHERE token_hash = $1', [hash]);
      res.setHeader('Set-Cookie', cookieName + '=' + attributes + '; Max-Age=0');
    }
  };
}

export function loginPage(res, error = '', memberEnabled = false) {
  res.writeHead(error ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connexion · Cockpit CDS</title><link rel="stylesheet" href="/style.css"></head>
  <body class="shared-login"><main class="auth-layout">
  <section class="auth-intro"><p class="auth-brand">COMMERCIAL, DIGITAL &amp; TECH</p>
    <h1>Cockpit CDS</h1><p>Suivi des budgets, des imputations et des factures par PO.</p>
  </section>
  <section class="shared-login-card"><h2>Connexion</h2><p>Choisissez votre profil pour ouvrir le cockpit.</p>
  <form action="/login" method="post">
    <fieldset class="auth-profiles"><legend>Profil</legend>
      <label><input type="radio" name="role" value="laurent" required><span><strong>Laurent</strong><small>Accor · Owner du PO</small></span></label>
      <label><input type="radio" name="role" value="jennifer"><span><strong>Jennifer</strong><small>Accor · Pilotage</small></span></label>
      <label><input type="radio" name="role" value="lassaad"><span><strong>Lassaad</strong><small>Fournisseur · Responsable CDS</small></span></label>
      ${memberEnabled ? '<label><input type="radio" name="role" value="member"><span><strong>Membre CDS</strong><small>Ma fiche d’imputation</small></span></label>' : ''}
    </fieldset>
    ${memberEnabled ? '<label class="field auth-member-email">E-mail Jira<input type="email" name="email" autocomplete="username"></label>' : ''}
    <label class="field">Mot de passe<input type="password" name="password" autocomplete="current-password" required></label>
    ${error ? '<p role="alert" class="text-red">Identifiant ou mot de passe incorrect.</p>' : ''}
    <button type="submit" class="btn teal">Se connecter</button>
  </form></section></main></body></html>`);
}

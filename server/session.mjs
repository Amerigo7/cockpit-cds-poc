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
    async login(req, res, role, password) {
      if (!checkPassword(role, password)) return false;
      const token = randomBytes(32).toString('base64url');
      await db.query('DELETE FROM cds_session WHERE expires_at <= now() OR token_hash = $1', [readCookie(req)]);
      await db.query('INSERT INTO cds_session (token_hash, role, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))',
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

export function loginPage(res, error = '') {
  res.writeHead(error ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connexion · Cockpit CDS</title><link rel="stylesheet" href="/style.css"></head>
  <body class="shared-login"><main class="shared-login-card"><p class="brand">Cockpit CDS</p><h1>Connexion au cockpit partagé</h1>
  <form action="/login" method="post">
    <label class="field">Identifiant<select name="role" required><option value="">Choisir votre accès</option><option value="laurent">Laurent</option><option value="jennifer">Jennifer</option><option value="lassaad">Lassaad</option></select></label>
    <label class="field">Mot de passe<input type="password" name="password" autocomplete="current-password" required></label>
    ${error ? '<p role="alert" class="text-red">Identifiant ou mot de passe incorrect.</p>' : ''}
    <button type="submit" class="btn teal">Se connecter</button>
  </form></main></body></html>`);
}

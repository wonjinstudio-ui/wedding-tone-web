// 계정: 이메일+비밀번호, 구글·카카오 로그인(OAuth 2.0 인가 코드 방식), 세션.
// 비밀번호는 scrypt(솔트 16바이트)로만 저장. 세션 토큰은 무작위 32바이트, DB에는 sha256만.
import crypto from 'node:crypto';
import { HttpError, readJson, parseCookies, cookie, rateLimiter, send } from './http.js';
import { newId, now, isoAfter } from './db.js';

const SESSION_COOKIE = 'ws_session';
const STATE_COOKIE = 'ws_oauth_state';
const loginLimit = rateLimiter(10, 60_000);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}

export function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, h] = stored.split('$');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(h, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, free_weddings_left: u.free_weddings_left, created_at: u.created_at };
}

function createUser(ctx, { email, passwordHash = null, name = null }) {
  const id = newId('u');
  ctx.db.app.run('INSERT INTO users (id, email, password_hash, name, free_weddings_left, created_at) VALUES (?,?,?,?,?,?)',
    id, email, passwordHash, name, ctx.cfg.freeWeddings, now());
  return ctx.db.app.get('SELECT * FROM users WHERE id=?', id);
}

function startSession(ctx, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  ctx.db.app.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    sha256(token), userId, now(), isoAfter(ctx.cfg.sessionDays));
  res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, token, { maxAge: ctx.cfg.sessionDays * 86400, secure: ctx.cfg.prod }));
  return token;
}

// 요청한 사람(쿠키 또는 Authorization: Bearer). 없으면 null.
export function currentUser(ctx, req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = ctx.db.app.get('SELECT * FROM sessions WHERE token_hash=?', sha256(token));
  if (!s || s.expires_at < now()) return null;
  return ctx.db.app.get('SELECT * FROM users WHERE id=?', s.user_id) || null;
}

export function requireUser(ctx, req) {
  const u = currentUser(ctx, req);
  if (!u) throw new HttpError(401, '로그인이 필요해요');
  return u;
}

// ---------- 이메일 ----------
async function signup(ctx, req, res) {
  const b = await readJson(req);
  const email = String(b.email || '').trim().toLowerCase();
  const pw = String(b.password || '');
  if (!EMAIL.test(email)) throw new HttpError(400, '이메일 형식이 아니에요');
  if (pw.length < 8 || pw.length > 200) throw new HttpError(400, '비밀번호는 8자 이상이어야 해요');
  loginLimit('signup:' + (req.socket.remoteAddress || ''));
  if (ctx.db.app.get('SELECT 1 FROM users WHERE email=?', email)) throw new HttpError(409, '이미 가입된 이메일이에요');
  const u = createUser(ctx, { email, passwordHash: hashPassword(pw), name: b.name ? String(b.name).slice(0, 60) : null });
  const token = startSession(ctx, res, u.id);
  send(res, 201, { user: publicUser(u), token });
}

async function login(ctx, req, res) {
  const b = await readJson(req);
  const email = String(b.email || '').trim().toLowerCase();
  loginLimit('login:' + email);
  loginLimit('ip:' + (req.socket.remoteAddress || ''));
  const u = ctx.db.app.get('SELECT * FROM users WHERE email=?', email);
  if (!u || !checkPassword(String(b.password || ''), u.password_hash)) throw new HttpError(401, '이메일 또는 비밀번호가 맞지 않아요');
  const token = startSession(ctx, res, u.id);
  send(res, 200, { user: publicUser(u), token });
}

function logout(ctx, req, res) {
  const token = parseCookies(req)[SESSION_COOKIE] || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (token) ctx.db.app.run('DELETE FROM sessions WHERE token_hash=?', sha256(token));
  res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAge: 0, secure: ctx.cfg.prod }));
  send(res, 200, { ok: true });
}

function me(ctx, req, res) {
  send(res, 200, { user: publicUser(requireUser(ctx, req)) });
}

// ---------- 작가 설정 (2026-11-23: 필터 조정값이 브라우저에만 저장돼 다른 컴퓨터에선 사라지고 같은 컴퓨터의 다른 작가에게 보이던 것) ----------
// { look: 필터 이름 | null, lookAdj: { 필터 이름: { strength: 0~1.5, adjust: { 항목: 숫자 } } } }
const PREF_NAME = /^[A-Za-z0-9_\-가-힣 .]{1,80}$/;
function cleanPrefs(b) {
  const out = {};
  if ('look' in b) {
    if (b.look !== null && !(typeof b.look === 'string' && PREF_NAME.test(b.look))) throw new HttpError(400, 'look은 필터 이름이나 null');
    out.look = b.look;
  }
  if ('lookAdj' in b) {
    const a = b.lookAdj;
    if (typeof a !== 'object' || a === null || Array.isArray(a) || Object.keys(a).length > 50) throw new HttpError(400, 'lookAdj 형식이 아니에요');
    out.lookAdj = {};
    for (const [k, v] of Object.entries(a)) {
      if (!PREF_NAME.test(k) || typeof v !== 'object' || v === null) throw new HttpError(400, 'lookAdj 형식이 아니에요');
      const st = Number(v.strength);
      if (!Number.isFinite(st) || st < 0 || st > 1.5) throw new HttpError(400, 'strength는 0~1.5');
      const adj = {};
      for (const [ak, av] of Object.entries(v.adjust || {}).slice(0, 20)) {
        if (!/^[a-z_]{1,20}$/.test(ak) || !Number.isFinite(Number(av)) || Math.abs(Number(av)) > 1000) throw new HttpError(400, 'adjust 형식이 아니에요');
        adj[ak] = Number(av);
      }
      out.lookAdj[k] = { strength: st, adjust: adj };
    }
  }
  return out;
}

function readPrefs(ctx, userId) {
  const r = ctx.db.app.get('SELECT data FROM user_prefs WHERE user_id=?', userId);
  return r ? JSON.parse(r.data) : { look: null, lookAdj: {} };
}

function prefsGet(ctx, req, res) {
  send(res, 200, { prefs: readPrefs(ctx, requireUser(ctx, req).id) });
}

async function prefsPut(ctx, req, res) {
  const u = requireUser(ctx, req);
  const next = { ...readPrefs(ctx, u.id), ...cleanPrefs(await readJson(req, 32 * 1024)) };
  ctx.db.app.run('INSERT INTO user_prefs (user_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    u.id, JSON.stringify(next), now());
  send(res, 200, { prefs: next });
}

// ---------- 구글·카카오 (OAuth 2.0 인가 코드) ----------
// 흐름: /start → 회사 로그인 화면 → /callback?code&state → 토큰 교환 → 사용자 정보 → 우리 계정 찾기/만들기 → 세션 → 웹 화면으로
const PROVIDERS = {
  google: {
    scope: 'openid email profile',
    profile: (j) => ({ subject: String(j.sub), email: j.email_verified === false ? null : (j.email || null), name: j.name || null }),
  },
  kakao: {
    scope: 'account_email profile_nickname',
    profile: (j) => ({ subject: String(j.id), email: j.kakao_account?.is_email_verified === false ? null : (j.kakao_account?.email || null),
      name: j.kakao_account?.profile?.nickname || j.properties?.nickname || null }),
  },
};

function redirect(res, url, extraHeaders = {}) {
  res.writeHead(302, { Location: url, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end();
}

function oauthStart(ctx, req, res, { provider }) {
  const p = ctx.cfg[provider];
  if (!PROVIDERS[provider]) throw new HttpError(404, '없는 로그인 방식이에요');
  if (!p) throw new HttpError(503, `${provider === 'google' ? '구글' : '카카오'} 로그인이 아직 설정되지 않았어요`);
  const state = crypto.randomBytes(24).toString('base64url');
  const u = new URL(p.authUrl);
  u.search = new URLSearchParams({ client_id: p.clientId, redirect_uri: `${ctx.cfg.publicUrl}/api/auth/${provider}/callback`,
    response_type: 'code', scope: PROVIDERS[provider].scope, state }).toString();
  redirect(res, u.toString(), { 'Set-Cookie': cookie(STATE_COOKIE, `${provider}.${state}`, { maxAge: 600, secure: ctx.cfg.prod, path: '/api/auth' }) });
}

async function oauthCallback(ctx, req, res, { provider }) {
  const p = ctx.cfg[provider];
  if (!PROVIDERS[provider] || !p) throw new HttpError(404, '없는 로그인 방식이에요');
  const url = new URL(req.url, 'http://x');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = parseCookies(req)[STATE_COOKIE] || '';
  const fail = (why) => redirect(res, `${ctx.cfg.webOrigin}/login?error=${encodeURIComponent(why)}`,
    { 'Set-Cookie': cookie(STATE_COOKIE, '', { maxAge: 0, path: '/api/auth' }) });
  if (!code || !state || saved !== `${provider}.${state}`) return fail('로그인 요청이 만료됐거나 맞지 않아요. 다시 시도해 주세요');
  const tok = await fetch(p.tokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: p.clientId, client_secret: p.clientSecret,
      redirect_uri: `${ctx.cfg.publicUrl}/api/auth/${provider}/callback` }),
  });
  if (!tok.ok) return fail('로그인 회사에서 토큰을 받지 못했어요');
  const { access_token: at } = await tok.json();
  const ur = await fetch(p.userUrl, { headers: { Authorization: `Bearer ${at}` } });
  if (!ur.ok) return fail('로그인 회사에서 사용자 정보를 받지 못했어요');
  const prof = PROVIDERS[provider].profile(await ur.json());
  if (!prof.subject) return fail('사용자 정보가 비어 있어요');
  // 이미 연결된 계정 → 그 계정 / 같은 이메일의 기존 계정 → 연결 / 없으면 새로
  let user;
  const link = ctx.db.app.get('SELECT * FROM oauth_accounts WHERE provider=? AND subject=?', provider, prof.subject);
  if (link) user = ctx.db.app.get('SELECT * FROM users WHERE id=?', link.user_id);
  else {
    user = prof.email ? ctx.db.app.get('SELECT * FROM users WHERE email=?', prof.email.toLowerCase()) : null;
    if (!user) user = createUser(ctx, { email: prof.email ? prof.email.toLowerCase() : null, name: prof.name });
    ctx.db.app.run('INSERT INTO oauth_accounts (provider, subject, user_id, email, created_at) VALUES (?,?,?,?,?)',
      provider, prof.subject, user.id, prof.email, now());
  }
  const token = crypto.randomBytes(32).toString('base64url');
  ctx.db.app.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    sha256(token), user.id, now(), isoAfter(ctx.cfg.sessionDays));
  redirect(res, `${ctx.cfg.webOrigin}/`, { 'Set-Cookie': [
    cookie(SESSION_COOKIE, token, { maxAge: ctx.cfg.sessionDays * 86400, secure: ctx.cfg.prod }),
    cookie(STATE_COOKIE, '', { maxAge: 0, path: '/api/auth' })] });
}

export function authRoutes(router) {
  router.add('POST', '/api/auth/signup', signup)
    .add('POST', '/api/auth/login', login)
    .add('POST', '/api/auth/logout', logout)
    .add('GET', '/api/me', me)
    .add('GET', '/api/me/prefs', prefsGet)
    .add('PUT', '/api/me/prefs', prefsPut)
    .add('GET', '/api/auth/:provider/start', oauthStart)
    .add('GET', '/api/auth/:provider/callback', oauthCallback);
}

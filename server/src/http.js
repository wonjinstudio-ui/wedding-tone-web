// 아주 작은 라우터·도우미 (외부 패키지 없이)

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    // '/api/weddings/:id/files/:name' → 정규식
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  match(method, pathname) {
    let pathOnly = false;
    for (const r of this.routes) {
      const m = pathname.match(r.re);
      if (!m) continue;
      pathOnly = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return pathOnly ? 'method' : null;
  }
}

export function send(res, status, data, headers = {}) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
  res.writeHead(status, { 'Content-Type': Buffer.isBuffer(data) ? headers['Content-Type'] || 'application/octet-stream' : 'application/json; charset=utf-8',
    'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new HttpError(413, '본문이 너무 커요')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = 256 * 1024) {
  const ct = req.headers['content-type'] || '';
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'Content-Type은 application/json이어야 해요');
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    const v = JSON.parse(raw.toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch { throw new HttpError(400, '본문이 JSON 객체가 아니에요'); }
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, path = '/' } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ''}`;
}

// 아주 단순한 횟수 제한(로그인 시도 등). 서버 1대 기준.
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const t = Date.now();
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    arr.push(t);
    hits.set(key, arr);
    if (hits.size > 10000) hits.clear();
    if (arr.length > max) throw new HttpError(429, '잠시 뒤에 다시 시도해 주세요');
  };
}

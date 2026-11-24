// API 서버 입구. 실행: node src/server.js  (설정은 src/config.js의 환경 변수)
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { openDbs } from './db.js';
import { makeStorage } from './storage.js';
import { Router, HttpError, send } from './http.js';
import { authRoutes } from './auth.js';
import { weddingRoutes, sweepExpired } from './weddings.js';

export function createApp(cfg = config) {
  const ctx = { cfg, db: openDbs(cfg), storage: makeStorage(cfg) };
  const router = new Router();
  router.add('GET', '/api/health', (c, req, res) => send(res, 200, { ok: true }));
  authRoutes(router);
  weddingRoutes(router);

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    // 웹 화면(다른 주소)에서 쿠키와 함께 부를 수 있게
    const origin = req.headers.origin;
    if (origin && origin === cfg.webOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE', 'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Max-Age': '600' });
      return res.end();
    }
    try {
      const { pathname } = new URL(req.url, 'http://x');
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, '없는 주소예요');
      if (m === 'method') throw new HttpError(405, '허용되지 않는 방식이에요');
      await m.handler(ctx, req, res, m.params);
    } catch (e) {
      if (!res.headersSent) {
        if (e instanceof HttpError) send(res, e.status, { error: e.message, ...e.extra });
        else { console.error(e); send(res, 500, { error: '서버 오류' }); }
      } else res.destroy();
    }
    if (!cfg.quiet) console.log(`[API] ${req.method} ${req.url.split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  const timer = setInterval(() => { try { const n = sweepExpired(ctx); if (n) console.log(`[API] 보관 기간 지난 결혼식 ${n}건 삭제 요청`); } catch (e) { console.error(e); } }, 3600e3);
  timer.unref();
  return { server, ctx, close: () => { clearInterval(timer); server.close(); ctx.db.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (config.prod && !config.engineKey) throw new Error('운영에서는 ENGINE_API_KEY가 꼭 필요해요');
  const { server } = createApp();
  server.listen(config.port, config.host, () => console.log(`[API] http://${config.host}:${config.port} (저장소: ${config.r2 ? 'R2' : config.storageDir})`));
}

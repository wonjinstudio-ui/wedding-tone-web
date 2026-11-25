// node --test test/  — 파이썬 엔진 없이 API 서버만 시험(엔진·구글·카카오는 가짜 서버로 흉내).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { presign } from '../src/storage.js';
import { hashPassword, checkPassword } from '../src/auth.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap-api-'));
let app, base, fakeEngine, fakeOAuth, engineCalls = [];

function listen(srv) { return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`))); }

before(async () => {
  // 가짜 엔진 API: 받은 요청을 기록하고 간단히 답함
  fakeEngine = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      engineCalls.push({ method: req.method, url: req.url, key: req.headers['x-engine-key'], body: b });
      if (req.url.includes('/render')) { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 1])); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, path: req.url }));
    });
  });
  const engineUrl = await listen(fakeEngine);
  // 가짜 구글: 토큰·사용자 정보
  fakeOAuth = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.startsWith('/token')) return res.end(JSON.stringify({ access_token: new URLSearchParams(b).get('code') === 'good' ? 'AT1' : 'bad' }));
      if (req.url.startsWith('/user')) return res.end(JSON.stringify({ sub: 'g-123', email: 'oauth@example.com', email_verified: true, name: '구글 작가' }));
      res.end('{}');
    });
  });
  const oauthUrl = await listen(fakeOAuth);
  app = createApp({
    port: 0, host: '127.0.0.1', prod: false, quiet: true, webOrigin: 'http://web.test', publicUrl: 'http://api.test',
    appDb: path.join(tmp, 'app.sqlite'), jobsDb: path.join(tmp, 'jobs.sqlite'), storageDir: path.join(tmp, 'storage'), r2: null,
    engineUrl, engineKey: 'k123', sessionDays: 30, freeWeddings: 1, pricePerWeddingKrw: 14900, maxPhotos: 5,
    maxUploadBytes: 1024 * 1024, retentionDays: 14, devPayments: true,
    google: { clientId: 'cid', clientSecret: 'cs', authUrl: `${oauthUrl}/auth`, tokenUrl: `${oauthUrl}/token`, userUrl: `${oauthUrl}/user` },
    kakao: null,
  });
  base = await listen(app.server);
});
after(() => { app.close(); fakeEngine.close(); fakeOAuth.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, p, { token, json, raw, headers = {}, redirect = 'follow' } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: json ? JSON.stringify(json) : raw, redirect });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500)]);
const finishJob = (id, result) => app.ctx.db.jobs.run("UPDATE jobs SET state='done', progress=1, result=? WHERE id=?", JSON.stringify(result), id);

test('AWS 서명 v4 미리 서명 주소: 공개 예제 값과 같음', () => {
  const u = presign({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', bucket: '', key: 'test.txt', region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', expires: 86400,
    date: new Date('2013-05-24T00:00:00Z') });
  assert.match(u, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test('비밀번호 해시', () => {
  const h = hashPassword('correct horse');
  assert.ok(checkPassword('correct horse', h));
  assert.ok(!checkPassword('wrong', h));
});

let A, B, wid;
test('가입·로그인·내 정보·중복·틀린 비밀번호', async () => {
  let r = await call('POST', '/api/auth/signup', { json: { email: 'A@Example.com', password: 'short' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/auth/signup', { json: { email: 'a@example.com', password: 'password123' } });
  assert.equal(r.status, 400);                                                                  // 약관 동의 없음
  r = await call('POST', '/api/auth/signup', { json: { email: 'a@example.com', password: 'password123', agree: true } });
  assert.equal(r.status, 201); A = r.body.token;
  assert.equal(app.ctx.db.app.get('SELECT terms_version FROM users WHERE email=?', 'a@example.com').terms_version, '2026-11-trial');
  assert.equal(r.body.user.free_weddings_left, 1);
  assert.match(r.headers.get('set-cookie'), /ws_session=.*HttpOnly; SameSite=Lax/);
  r = await call('POST', '/api/auth/signup', { json: { email: 'a@example.com', password: 'password123', agree: true } });
  assert.equal(r.status, 409);
  r = await call('POST', '/api/auth/login', { json: { email: 'a@example.com', password: 'nope-nope' } });
  assert.equal(r.status, 401);
  r = await call('POST', '/api/auth/signup', { json: { email: 'b@example.com', password: 'password456', agree: true } });
  B = r.body.token;
  r = await call('GET', '/api/me', { token: A });
  assert.equal(r.body.user.email, 'a@example.com');
  assert.equal((await call('GET', '/api/me')).status, 401);
});

test('결혼식 만들기·남의 결혼식 못 봄·업로드 검사', async () => {
  let r = await call('POST', '/api/weddings', { token: A, json: { title: '테스트 예식' } });
  assert.equal(r.status, 201); wid = r.body.wedding.id;
  assert.match(wid, /^w[a-z2-7]{12}$/);
  assert.equal(r.body.wedding.stage, 'uploading');
  assert.equal((await call('GET', `/api/weddings/${wid}`, { token: B })).status, 404);
  r = await call('POST', `/api/weddings/${wid}/uploads`, { token: A, json: { files: [{ name: '../evil.jpg', size: 10 }] } });
  assert.equal(r.status, 400);
  r = await call('POST', `/api/weddings/${wid}/uploads`, { token: A, json: { files: Array.from({ length: 6 }, (_, i) => ({ name: `${i}.jpg`, size: 10 })) } });
  assert.equal(r.status, 400);   // 장수 상한 5
  r = await call('POST', `/api/weddings/${wid}/uploads`, { token: A, json: { files: [{ name: 'IMG_0001.JPG', size: jpg.length }] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.targets[0].url, `http://api.test/api/weddings/${wid}/files/IMG_0001.JPG`);
  r = await call('PUT', `/api/weddings/${wid}/files/IMG_0001.JPG`, { token: A, raw: jpg });
  assert.equal(r.status, 200);
  r = await call('PUT', `/api/weddings/${wid}/files/IMG_0002.JPG`, { token: A, raw: Buffer.from('not a jpeg at all') });
  assert.equal(r.status, 400);
  r = await call('PUT', `/api/weddings/${wid}/files/IMG_0003.JPG`, { token: B, raw: jpg });
  assert.equal(r.status, 404);
  assert.deepEqual(fs.readdirSync(path.join(tmp, 'storage/uploads', wid)), ['IMG_0001.JPG']);
  // 같은 폴더를 다시 넣으면 이미 올라간 이름은 건너뛰고, 올리려던 장수를 기억(6차)
  r = await call('POST', `/api/weddings/${wid}/uploads`, { token: A, json: { files: ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG'].map((name) => ({ name, size: jpg.length })) } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.skip, ['IMG_0001.JPG']);
  assert.deepEqual(r.body.targets.map((t) => t.name), ['IMG_0002.JPG', 'IMG_0003.JPG']);
  r = await call('GET', `/api/weddings/${wid}`, { token: A });
  assert.equal(r.body.wedding.planned, 3);
  assert.equal(r.body.wedding.uploaded, 1);
});

test('작업 흐름: 분석 → 보정 화면 중계 → 학습 → 체험으로 내보내기 → 다운로드', async () => {
  assert.equal((await call('POST', `/api/weddings/${wid}/learn`, { token: A })).status, 409);         // 분석 전
  let r = await call('POST', `/api/weddings/${wid}/analyze`, { token: A });
  assert.equal(r.status, 202); const prep = r.body.job;
  const row = app.ctx.db.jobs.get('SELECT * FROM jobs WHERE id=?', prep);
  assert.equal(row.kind, 'prepare'); assert.equal(row.wedding_id, wid); assert.equal(JSON.parse(row.params).source, 'jpg');
  assert.equal((await call('POST', `/api/weddings/${wid}/analyze`, { token: A })).status, 409);       // 이미 진행 중
  assert.equal((await call('PUT', `/api/weddings/${wid}/files/X.jpg`, { token: A, raw: jpg })).status, 409);  // 분석 시작 뒤 업로드 막음
  assert.equal((await call('GET', `/api/weddings/${wid}`, { token: A })).body.wedding.stage, 'analyzing');
  finishJob(prep, { photos: 1 });                                                                      // 워커가 끝냈다고 흉내
  // 엔진 중계: 키를 붙이고, 렌더에는 작가 id를 넣음
  engineCalls = [];
  r = await call('GET', `/api/weddings/${wid}/zones`, { token: A });
  assert.equal(r.status, 200); assert.equal(r.body.path, `/v1/weddings/${wid}/zones`);
  r = await call('GET', `/api/weddings/${wid}/photos/7/render?mode=learn&edge=400`, { token: A });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
  const meId = (await call('GET', '/api/me', { token: A })).body.user.id;
  assert.ok(engineCalls.every((c) => c.key === 'k123'));
  assert.match(engineCalls[1].url, new RegExp(`user=${meId}`));
  r = await call('PUT', `/api/weddings/${wid}/zones/0/reference`, { token: A, json: { settings: { exposure: 0.2, sharpen: 20, contrast: 5 } } });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(engineCalls.at(-1).body).settings, { exposure: 0.2, sharpen: 20, contrast: 5 });
  // 작가별 스타일 이어 쓰기(C2): 기준 컷 스타일 값이 계정에 남고, 다른 작가에게는 없음. 화면에서 직접 바꿀 수는 없음
  let pr = (await call('GET', '/api/me/prefs', { token: A })).body.prefs.refStyle;
  assert.deepEqual(pr.values, { contrast: 5, saturation: 0, sharpen: 20, vignette: 0 }); assert.equal(pr.wedding, wid);
  assert.equal((await call('GET', '/api/me/prefs', { token: B })).body.prefs.refStyle, undefined);
  await call('PUT', '/api/me/prefs', { token: A, json: { refStyle: { wedding: 'x', title: 'x', values: {} } } });
  assert.equal((await call('GET', '/api/me/prefs', { token: A })).body.prefs.refStyle.wedding, wid);
  assert.equal((await call('GET', `/api/weddings/${wid}/zones`, { token: B })).status, 404);           // 남의 결혼식 중계 안 됨
  r = await call('POST', `/api/weddings/${wid}/learn`, { token: A });
  assert.equal(r.status, 202);
  // 옮기기는 엔진 API에서 바로 끝남(2026-11-24): 작업 기록은 곧바로 '끝남', 엔진에 learn 요청이 감
  assert.equal((await call('GET', `/api/weddings/${wid}/jobs/${r.body.job}`, { token: A })).body.job.state, 'done');
  assert.ok(engineCalls.some((c) => c.method === 'POST' && c.url === `/v1/weddings/${wid}/learn`));
  // 내보내기: 체험 1건 사용
  r = await call('POST', `/api/weddings/${wid}/export`, { token: A, json: { look: 'spring_film' } });
  assert.equal(r.status, 202); const ex = r.body.job;
  assert.equal(JSON.parse(app.ctx.db.jobs.get('SELECT params FROM jobs WHERE id=?', ex).params).user, meId);
  assert.equal((await call('GET', '/api/me', { token: A })).body.user.free_weddings_left, 0);
  const key = `results/${wid}/${ex}.zip`;
  fs.mkdirSync(path.join(tmp, 'storage/results', wid), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'storage', key), 'PK-zip');
  finishJob(ex, { key, bytes: 6, photos: 1 });
  r = await call('GET', `/api/weddings/${wid}/download/${ex}`, { token: A });
  assert.equal(r.status, 200); assert.equal(r.body.toString(), 'PK-zip');
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.equal((await call('GET', `/api/weddings/${wid}/download/${ex}`, { token: B })).status, 404);
  // 필터를 바꿔 다시 만들다 멈춰도 먼저 만든 ZIP은 그대로(7차), ZIP 이름에 필터 이름
  r = await call('POST', `/api/weddings/${wid}/export`, { token: A, json: { look: 'clear_morning', look_name: '맑은 아침' } });
  assert.equal(r.status, 202);
  assert.equal((await call('POST', `/api/weddings/${wid}/jobs/${r.body.job}/cancel`, { token: A })).status < 300, true);
  r = await call('GET', `/api/weddings/${wid}`, { token: A });
  assert.equal(r.body.wedding.stage, 'exported');
  assert.equal(r.body.wedding.job.id, ex);
  assert.equal(r.body.jobs.find((j) => j.kind === 'export').look_name, '맑은 아침');
  assert.equal((await call('GET', `/api/weddings/${wid}/download/${ex}`, { token: A })).status, 200);
});

test('두 번째 결혼식은 결제 필요(402) → 개발용 결제 → 내보내기 → 취소', async () => {
  let r = await call('POST', '/api/weddings', { token: A, json: { title: '두 번째' } });
  const w2 = r.body.wedding.id;
  await call('PUT', `/api/weddings/${w2}/files/a.jpg`, { token: A, raw: jpg });
  const p = (await call('POST', `/api/weddings/${w2}/analyze`, { token: A })).body.job;
  finishJob(p, {});
  r = await call('POST', `/api/weddings/${w2}/export`, { token: A, json: {} });
  assert.equal(r.status, 409);                                    // 학습 전: 결제·체험 쓰기 전에 거절
  assert.equal((await call('POST', `/api/weddings/${w2}/learn`, { token: A })).status, 202);
  r = await call('POST', `/api/weddings/${w2}/export`, { token: A, json: {} });
  assert.equal(r.status, 402); assert.equal(r.body.price_krw, 14900);
  assert.equal((await call('POST', `/api/weddings/${w2}/pay/dev`, { token: A })).status, 200);
  r = await call('POST', `/api/weddings/${w2}/export`, { token: A, json: {} });
  assert.equal(r.status, 202);
  assert.equal((await call('POST', `/api/weddings/${w2}/jobs/${r.body.job}/cancel`, { token: A })).status, 200);
  assert.equal((await call('GET', `/api/weddings/${w2}/jobs/${r.body.job}`, { token: A })).body.job.state, 'canceled');
});

test('삭제·14일 자동 삭제', async () => {
  let r = await call('POST', '/api/weddings', { token: B, json: { title: '오래된' } });
  const old = r.body.wedding.id;
  app.ctx.db.app.run("UPDATE weddings SET delete_at='2000-01-01T00:00:00+00:00' WHERE id=?", old);
  const { sweepExpired } = await import('../src/weddings.js');
  assert.equal(sweepExpired(app.ctx), 1);
  assert.equal(app.ctx.db.jobs.get("SELECT kind FROM jobs WHERE wedding_id=?", old).kind, 'delete');
  assert.equal((await call('GET', `/api/weddings/${old}`, { token: B })).status, 404);
  r = await call('DELETE', `/api/weddings/${wid}`, { token: A });
  assert.equal(r.status, 202);
  assert.equal((await call('GET', '/api/weddings', { token: A })).body.weddings.some((w) => w.id === wid), false);
});

test('구글 로그인 흐름(가짜 구글): state 확인 → 계정 만들기 → 다시 로그인하면 같은 계정', async () => {
  let r = await call('GET', '/api/auth/google/start', { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  const state = loc.searchParams.get('state');
  assert.equal(loc.searchParams.get('redirect_uri'), 'http://api.test/api/auth/google/callback');
  const stateCookie = r.headers.get('set-cookie').split(';')[0];
  r = await call('GET', `/api/auth/google/callback?code=good&state=WRONG`, { redirect: 'manual', headers: { Cookie: stateCookie } });
  assert.match(r.headers.get('location'), /^http:\/\/web\.test\/login\?error=/);
  r = await call('GET', `/api/auth/google/callback?code=good&state=${state}`, { redirect: 'manual', headers: { Cookie: stateCookie } });
  assert.equal(r.headers.get('location'), 'http://web.test/');
  const sess = r.headers.getSetCookie().find((c) => c.startsWith('ws_session='));
  assert.ok(sess);
  const me1 = await call('GET', '/api/me', { headers: { Cookie: sess.split(';')[0] } });
  assert.equal(me1.body.user.email, 'oauth@example.com');
  // 두 번째 로그인 → 같은 사용자
  r = await call('GET', '/api/auth/google/start', { redirect: 'manual' });
  const st2 = new URL(r.headers.get('location')).searchParams.get('state');
  r = await call('GET', `/api/auth/google/callback?code=good&state=${st2}`, { redirect: 'manual', headers: { Cookie: r.headers.get('set-cookie').split(';')[0] } });
  const me2 = await call('GET', '/api/me', { headers: { Cookie: r.headers.getSetCookie().find((c) => c.startsWith('ws_session=')).split(';')[0] } });
  assert.equal(me2.body.user.id, me1.body.user.id);
  assert.equal((await call('GET', '/api/auth/kakao/start', { redirect: 'manual' })).status, 503);    // 카카오 키 없음
});

test('작가 설정(필터 조정값)은 계정마다 따로 저장', async () => {
  let r = await call('GET', '/api/me/prefs', { token: A });
  assert.equal(r.status, 200); assert.deepEqual({ look: r.body.prefs.look, lookAdj: r.body.prefs.lookAdj }, { look: null, lookAdj: {} });
  r = await call('PUT', '/api/me/prefs', { token: A, json: { look: 'clear_morning', lookAdj: { clear_morning: { strength: 0.8, adjust: { fade: 12, glow: 15 } } } } });
  assert.equal(r.status, 200);
  r = await call('PUT', '/api/me/prefs', { token: A, json: { look: 'spring_film' } });                 // 일부만 바꿔도 나머지는 그대로
  assert.equal(r.body.prefs.look, 'spring_film'); assert.equal(r.body.prefs.lookAdj.clear_morning.adjust.fade, 12);
  r = await call('GET', '/api/me/prefs', { token: B });
  assert.deepEqual(r.body.prefs, { look: null, lookAdj: {} });                                          // 다른 작가에게는 안 보임
  assert.equal((await call('PUT', '/api/me/prefs', { token: A, json: { lookAdj: { x: { strength: 9, adjust: {} } } } })).status, 400);
  assert.equal((await call('PUT', '/api/me/prefs', { token: A, json: { look: '<script>' } })).status, 400);
  assert.equal((await call('GET', '/api/me/prefs')).status, 401);
});

test('계정 탈퇴: 비밀번호 확인 → 결혼식 삭제 작업 → 로그인 불가 → 같은 이메일로 다시 가입 가능', async () => {
  let r = await call('POST', '/api/auth/signup', { json: { email: 'bye@example.com', password: 'password789', agree: true } });
  const T = r.body.token;
  r = await call('POST', '/api/weddings', { token: T, json: { title: '지울 결혼식' } });
  const w = r.body.wedding.id;
  assert.equal((await call('DELETE', '/api/me', { token: T, json: { password: 'wrong-pass' } })).status, 401);
  r = await call('DELETE', '/api/me', { token: T, json: { password: 'password789' } });
  assert.equal(r.status, 200); assert.equal(r.body.weddings_deleted, 1);
  assert.ok(app.ctx.db.jobs.get("SELECT 1 FROM jobs WHERE wedding_id=? AND kind='delete'", w));
  assert.equal((await call('GET', '/api/me', { token: T })).status, 401);                       // 세션 끊김
  assert.equal((await call('POST', '/api/auth/login', { json: { email: 'bye@example.com', password: 'password789' } })).status, 401);
  const row = app.ctx.db.app.get("SELECT email, password_hash, deleted_at FROM users WHERE id=(SELECT user_id FROM weddings WHERE id=?)", w);
  assert.equal(row.email, null); assert.equal(row.password_hash, null); assert.ok(row.deleted_at);
  assert.equal((await call('POST', '/api/auth/signup', { json: { email: 'bye@example.com', password: 'password789', agree: true } })).status, 201);
});

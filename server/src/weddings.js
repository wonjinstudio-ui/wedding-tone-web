// 결혼식: 만들기·목록·업로드·작업(분석·학습·내보내기)·다운로드·삭제, 엔진 API 중계, 체험/결제 확인, 14일 자동 삭제.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { HttpError, send, readJson, readBody, cookie } from './http.js';
import { requireUser, checkPassword, readPrefs } from './auth.js';
import { newId, now, isoAfter, submitJob, jobView, activeJob, lastJob } from './db.js';

const NAME = /^[A-Za-z0-9가-힣._ ()\-]{1,120}\.(jpe?g)$/i;

function wedding(ctx, user, id) {
  const w = ctx.db.app.get('SELECT * FROM weddings WHERE id=? AND user_id=? AND deleted_at IS NULL', id, user.id);
  if (!w) throw new HttpError(404, '결혼식을 찾을 수 없어요');
  return w;
}

function stage(ctx, w) {
  const act = activeJob(ctx.db, w.id);
  if (act) return { stage: { prepare: 'analyzing', learn: 'learning', export: 'exporting', delete: 'deleting' }[act.kind] || act.kind,
    job: jobView(act) };
  const prep = lastJob(ctx.db, w.id, 'prepare');
  if (!prep) return { stage: 'uploading' };
  if (prep.state === 'failed') return { stage: 'analyze_failed', job: jobView(prep) };
  if (prep.state !== 'done') return { stage: 'uploading' };
  // 마지막으로 '끝난' 내보내기: 필터를 바꿔 다시 만들다 멈추거나 실패해도 이미 만든 ZIP은 그대로 받을 수 있게(7차)
  const ex = ctx.db.jobs.get("SELECT * FROM jobs WHERE wedding_id=? AND kind='export' AND state='done' ORDER BY created_at DESC LIMIT 1", w.id);
  if (ex) return { stage: 'exported', job: jobView(ex) };
  return { stage: 'editing' };
}

function view(ctx, w) {
  return { id: w.id, title: w.title, paid: !!w.paid, paid_via: w.paid_via, created_at: w.created_at, delete_at: w.delete_at,
    uploaded: ctx.storage.kind === 'local' ? ctx.storage.count(`uploads/${w.id}`) : null, planned: w.planned ?? null, ...stage(ctx, w) };
}

// ---------- 결혼식 ----------
function list(ctx, req, res) {
  const u = requireUser(ctx, req);
  const rows = ctx.db.app.all('SELECT * FROM weddings WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC', u.id);
  send(res, 200, { weddings: rows.map((w) => view(ctx, w)) });
}

async function create(ctx, req, res) {
  const u = requireUser(ctx, req);
  const b = await readJson(req);
  const title = String(b.title || '').trim().slice(0, 80) || '이름 없는 결혼식';
  const id = newId('w');
  ctx.db.app.run('INSERT INTO weddings (id, user_id, title, created_at, delete_at) VALUES (?,?,?,?,?)',
    id, u.id, title, now(), isoAfter(ctx.cfg.retentionDays));
  send(res, 201, { wedding: view(ctx, wedding(ctx, u, id)) });
}

async function detail(ctx, req, res, { id }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  const out = view(ctx, w);
  // 학습·내보내는 중에도 장수 등을 보여 줌(2026-11-23: 내보내는 동안 '사진 -'로 보이던 것)
  if (['editing', 'learning', 'exporting', 'exported'].includes(out.stage)) {
    const r = await engine(ctx, 'GET', `/v1/weddings/${w.id}/status`);
    if (r.ok) out.progress = await r.json();
  }
  const jobs = ctx.db.jobs.all('SELECT * FROM jobs WHERE wedding_id=? ORDER BY created_at DESC LIMIT 20', w.id).map(jobView);
  send(res, 200, { wedding: out, jobs, can_download: !!w.paid || u.free_weddings_left > 0,
    price_krw: ctx.cfg.pricePerWeddingKrw });
}

function remove(ctx, req, res, { id }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  ctx.db.app.run('UPDATE weddings SET deleted_at=? WHERE id=?', now(), w.id);
  const job = submitJob(ctx.db, w.id, 'delete');
  send(res, 202, { ok: true, job });
}

// ---------- 계정 탈퇴 (2026-11-24) ----------
// 결혼식마다 delete 작업(올린 사진·결과·작업 폴더)을 넣고, 작가 필터를 지우고, 로그인 정보를 지움.
// 결제 기록 보관 의무 때문에 users 행은 남기되 이메일·이름·비밀번호를 비우고 deleted_at을 남김.
async function deleteAccount(ctx, req, res) {
  const u = requireUser(ctx, req);
  const b = await readJson(req);
  if (u.password_hash) {
    if (!checkPassword(String(b.password || ''), u.password_hash)) throw new HttpError(401, '비밀번호가 맞지 않아요');
  } else if (String(b.confirm || '') !== '탈퇴') {
    throw new HttpError(400, "확인을 위해 '탈퇴'라고 입력해 주세요");
  }
  const ws = ctx.db.app.all('SELECT id FROM weddings WHERE user_id=? AND deleted_at IS NULL', u.id);
  for (const w of ws) {
    ctx.db.app.run('UPDATE weddings SET deleted_at=? WHERE id=?', now(), w.id);
    submitJob(ctx.db, w.id, 'delete');
  }
  // 작가 필터(엔진 폴더). 엔진이 꺼져 있어도 탈퇴는 진행하고, 남은 필터는 다음 정리 때 지움
  await engine(ctx, 'DELETE', `/v1/users/${u.id}`).catch(() => null);
  ctx.db.app.tx(() => {
    ctx.db.app.run('DELETE FROM sessions WHERE user_id=?', u.id);
    ctx.db.app.run('DELETE FROM oauth_accounts WHERE user_id=?', u.id);
    ctx.db.app.run('DELETE FROM user_prefs WHERE user_id=?', u.id);
    ctx.db.app.run('UPDATE users SET email=NULL, name=NULL, password_hash=NULL, deleted_at=? WHERE id=?', now(), u.id);
  });
  res.setHeader('Set-Cookie', cookie('ws_session', '', { maxAge: 0, secure: ctx.cfg.prod }));
  send(res, 200, { ok: true, weddings_deleted: ws.length });
}

// ---------- 업로드 ----------
async function uploadPlan(ctx, req, res, { id }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  if (lastJob(ctx.db, w.id, 'prepare')) throw new HttpError(409, '이미 분석을 시작한 결혼식에는 사진을 더 올릴 수 없어요');
  const b = await readJson(req, 1024 * 1024);
  const files = Array.isArray(b.files) ? b.files : [];
  if (!files.length) throw new HttpError(400, '올릴 파일 목록이 비었어요');
  // 이미 올린 이름을 다시 올리는 것(멈춘 뒤 같은 폴더 다시 올리기)은 장수에 두 번 세지 않음
  const asked = new Set(files.map((f) => String(f?.name || '')));
  const stored = ctx.storage.kind === 'local' ? ctx.storage.names(`uploads/${w.id}`) : [];
  const have = stored.filter((n) => !asked.has(n)).length;
  if (have + asked.size > ctx.cfg.maxPhotos) throw new HttpError(400, `결혼식 1건은 ${ctx.cfg.maxPhotos}장까지예요`);
  // 이미 다 올라간 이름은 다시 올리지 않음(6차: 같은 폴더를 다시 넣으면 1,342장을 전부 다시 올렸음)
  const skip = stored.filter((n) => asked.has(n));
  const skipSet = new Set(skip);
  // 올리려던 장수 = 이번 목록 + 이전에 올린 다른 이름. 새로고침 뒤 "몇 장 빠졌는지" 보여 주는 데 씀
  const planned = asked.size + have;
  ctx.db.app.run('UPDATE weddings SET planned=? WHERE id=?', Math.max(planned, Number(w.planned) || 0), w.id);
  const targets = files.filter((f) => !skipSet.has(String(f?.name || ''))).map((f) => {
    const name = String(f.name || '');
    if (!NAME.test(name)) throw new HttpError(400, `JPG 파일 이름이 아니에요: ${name.slice(0, 60)}`);
    if (!(Number(f.size) > 0 && Number(f.size) <= ctx.cfg.maxUploadBytes)) throw new HttpError(400, `파일 크기가 맞지 않아요: ${name}`);
    return { name, ...ctx.storage.uploadUrl(`uploads/${w.id}/${name}`, w.id, name) };
  });
  send(res, 200, { targets, skip, note: '브라우저에서 긴 변 2400px로 줄이고, 원본 EXIF(메이커노트 포함)를 그대로 붙이고 회전 태그는 1로' });
}

// 개발용(로컬 저장소)만: 운영은 R2 미리 서명 주소로 바로 올림
async function uploadFile(ctx, req, res, { id, name }) {
  if (ctx.storage.kind !== 'local') throw new HttpError(404, '없는 주소예요');
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  if (!NAME.test(name)) throw new HttpError(400, 'JPG 파일 이름이 아니에요');
  if (lastJob(ctx.db, w.id, 'prepare')) throw new HttpError(409, '이미 분석을 시작했어요');
  const len = Number(req.headers['content-length'] || 0);
  if (!(len > 0 && len <= ctx.cfg.maxUploadBytes)) throw new HttpError(413, '파일이 비었거나 너무 커요');
  const dest = ctx.storage.path(`uploads/${w.id}/${name}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part-${crypto.randomBytes(4).toString('hex')}`;
  // 올리다 끊기면 임시 파일을 남기지 않음
  try { await pipeline(req, fs.createWriteStream(tmp)); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  const head = fs.readFileSync(tmp).subarray(0, 3);
  if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) { fs.rmSync(tmp); throw new HttpError(400, 'JPG 파일이 아니에요'); }
  fs.renameSync(tmp, dest);
  send(res, 200, { ok: true, name });
}

// ---------- 작업 ----------
function needIdle(ctx, w) {
  const a = activeJob(ctx.db, w.id);
  if (a) throw new HttpError(409, `지금 ${{ prepare: '분석', learn: '학습', export: '내보내기', delete: '삭제' }[a.kind] || a.kind} 중이에요`, { job: jobView(a) });
}

function needPrepared(ctx, w) {
  const p = lastJob(ctx.db, w.id, 'prepare');
  if (!p || p.state !== 'done') throw new HttpError(409, '사진 분석이 끝난 뒤에 할 수 있어요');
}

function analyze(ctx, req, res, { id }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  needIdle(ctx, w);
  const p = lastJob(ctx.db, w.id, 'prepare');
  if (p && p.state === 'done') throw new HttpError(409, '이미 분석했어요');
  if (ctx.storage.kind === 'local' && ctx.storage.count(`uploads/${w.id}`) === 0) throw new HttpError(400, '올린 사진이 없어요');
  send(res, 202, { job: submitJob(ctx.db, w.id, 'prepare', { source: 'jpg' }) });
}

// 옮기기는 1초 안팎이라 엔진 API에서 바로 하고, 기록만 jobs 표에 '끝남'으로 남김(단계 계산·화면은 예전과 같음).
// 2026-11-24(페르소나 5차): 워커 대기열로 보내면 다른 결혼식 내보내기(6분)가 끝날 때까지 3분 넘게 기다렸음.
async function learn(ctx, req, res, { id }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  needIdle(ctx, w);
  needPrepared(ctx, w);
  const r = await engine(ctx, 'POST', `/v1/weddings/${w.id}/learn`, '{}');
  const body = await r.json().catch(() => ({}));
  const jid = submitJob(ctx.db, w.id, 'learn');
  if (!r.ok) {
    ctx.db.jobs.run("UPDATE jobs SET state='failed', message='실패', error=?, finished_at=? WHERE id=?", body.error || '옮기지 못했어요', now(), jid);
    throw new HttpError(r.status === 409 ? 409 : 502, body.error || '옮기지 못했어요');
  }
  ctx.db.jobs.run("UPDATE jobs SET state='done', progress=1, message='완료', result=?, started_at=?, finished_at=?, worker='engine-api' WHERE id=?",
    JSON.stringify(body), now(), now(), jid);
  send(res, 202, { job: jid });
}

async function exportJob(ctx, req, res, { id }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  const b = await readJson(req);
  needIdle(ctx, w);
  needPrepared(ctx, w);
  // 학습 전에는 엔진이 내보내기를 거절함 → 체험·결제를 쓰기 전에 먼저 막음(2026-11-23: 실패한 작업에 체험이 소진되던 문제)
  const learned = lastJob(ctx.db, w.id, 'learn');
  if (!learned || learned.state !== 'done') throw new HttpError(409, '손보정 학습이 끝난 뒤에 내보낼 수 있어요');
  // 학습 뒤에 기준 컷을 다시 고치면 엔진이 옮긴 값을 지움 → 작업 기록만 보면 '학습 완료'라 내보내기가 실패하던 문제(2026-11-23)
  const st = await engine(ctx, 'GET', `/v1/weddings/${w.id}/status`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (st && st.learned === false) throw new HttpError(409, "기준 컷을 고친 뒤에는 다시 옮겨야 해요. 손보정 화면에서 '나머지 사진에 옮기기'를 눌러 주세요", { need: 'learn' });
  const look = b.look ?? null;
  if (look !== null && typeof look !== 'string' && typeof look !== 'object') throw new HttpError(400, 'look은 필터 이름이나 필터 JSON');
  // 다운로드 권한: 이미 결제/체험 사용 → 통과, 체험이 남았으면 이 결혼식에 사용, 아니면 결제 필요(402)
  if (!w.paid) {
    const used = ctx.db.app.tx(() => {
      const r = ctx.db.app.run('UPDATE users SET free_weddings_left=free_weddings_left-1 WHERE id=? AND free_weddings_left>0', u.id);
      if (r.changes) ctx.db.app.run("UPDATE weddings SET paid=1, paid_via='free' WHERE id=?", w.id);
      return r.changes > 0;
    });
    if (!used) throw new HttpError(402, '결제가 필요해요', { price_krw: ctx.cfg.pricePerWeddingKrw });
  }
  const edge = Math.min(2400, Math.max(800, Number(b.edge) || 2400));
  // 화면에 보이는 필터 이름(ZIP 이름·'이전 ZIP' 표시용, 7차: 필터를 바꿔 두 번 받으면 이름이 같았음)
  const lookName = typeof b.look_name === 'string' ? b.look_name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 40) : '';
  send(res, 202, { job: submitJob(ctx.db, w.id, 'export', { look, look_name: lookName || null, user: u.id, edge, quality: 92 }) });
}

function jobGet(ctx, req, res, { id, jobId }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  const j = ctx.db.jobs.get('SELECT * FROM jobs WHERE id=? AND wedding_id=?', jobId, w.id);
  if (!j) throw new HttpError(404, '작업을 찾을 수 없어요');
  send(res, 200, { job: jobView(j) });
}

function jobCancel(ctx, req, res, { id, jobId }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  const r = ctx.db.jobs.run(`UPDATE jobs SET state='canceled', message='취소됨', finished_at=? WHERE id=? AND wedding_id=?
                             AND state IN ('queued','running') AND kind != 'delete'`, now(), jobId, w.id);
  if (!r.changes) throw new HttpError(409, '취소할 수 없는 작업이에요');
  send(res, 200, { ok: true });
}

function download(ctx, req, res, { id, jobId }) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  if (!w.paid) throw new HttpError(402, '결제가 필요해요', { price_krw: ctx.cfg.pricePerWeddingKrw });
  const j = ctx.db.jobs.get("SELECT * FROM jobs WHERE id=? AND wedding_id=? AND kind='export' AND state='done'", jobId, w.id);
  if (!j) throw new HttpError(404, '다운로드할 결과가 없어요');
  const key = JSON.parse(j.result).key;
  // 파일 이름에 못 쓰는 글자만 뺌(예전엔 괄호·쉼표·점까지 빠졌음 — 페르소나 4차)
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  const ln = clean(JSON.parse(j.params || '{}').look_name);
  const fname = `${clean(w.title) || 'wedding'}${ln ? ` · ${ln}` : ''}.zip`;
  if (ctx.storage.kind !== 'local') {
    res.writeHead(302, { Location: ctx.storage.downloadUrl(key), 'Cache-Control': 'no-store' });
    return res.end();
  }
  const file = ctx.storage.path(key);
  if (!fs.existsSync(file)) throw new HttpError(404, '결과 파일이 지워졌어요');
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fs.statSync(file).size,
    'Content-Disposition': `attachment; filename="wedding.zip"; filename*=UTF-8''${encodeURIComponent(fname)}` });
  fs.createReadStream(file).pipe(res);
}

// 개발용 결제(운영에서는 토스페이먼츠 웹훅이 이 자리를 대신함 — 아직 없음)
function devPay(ctx, req, res, { id }) {
  if (!ctx.cfg.devPayments) throw new HttpError(404, '없는 주소예요');
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, id);
  ctx.db.app.run(`INSERT INTO payments (id, user_id, wedding_id, amount, currency, provider, status, created_at, updated_at)
                  VALUES (?,?,?,?,'KRW','dev','paid',?,?)`, newId('p'), u.id, w.id, ctx.cfg.pricePerWeddingKrw, now(), now());
  ctx.db.app.run("UPDATE weddings SET paid=1, paid_via='payment' WHERE id=?", w.id);
  send(res, 200, { ok: true });
}

// ---------- 엔진 API 중계 ----------
export function engine(ctx, method, p, body, contentType = 'application/json') {
  return fetch(ctx.cfg.engineUrl + p, {
    method, headers: { 'X-Engine-Key': ctx.cfg.engineKey, ...(body ? { 'Content-Type': contentType } : {}) },
    body: body ?? undefined, signal: AbortSignal.timeout(30_000),
  }).catch(() => { throw new HttpError(503, '보정 엔진에 연결하지 못했어요'); });
}

async function relay(res, r) {
  const buf = Buffer.from(await r.arrayBuffer());
  send(res, r.status, r.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(buf.toString('utf8')) : buf,
    { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream' });
}

function proxy({ write = false, withUser = false } = {}) {
  return async (ctx, req, res, params) => {
    const u = requireUser(ctx, req);
    const w = wedding(ctx, u, params.id);
    needPrepared(ctx, w);
    if (write) needIdle(ctx, w);
    const url = new URL(req.url, 'http://x');
    const rest = url.pathname.replace(`/api/weddings/${w.id}`, '');
    if (withUser) url.searchParams.set('user', u.id);
    let body = null;
    if (req.method === 'PUT' || req.method === 'POST') {
      const j = await readJson(req);
      if (withUser) j.user = u.id;
      body = JSON.stringify(j);
    }
    const qs = url.searchParams.toString();
    await relay(res, await engine(ctx, req.method, `/v1/weddings/${w.id}${rest}${qs ? '?' + qs : ''}`, body));
  };
}

// 작가별 스타일 이어 쓰기(2026-11-25, 톤 보정 C2): 기준 컷을 저장하면 스타일 값(대비·채도·샤프닝·비네팅)을 계정에 기억해
// 다음 결혼식의 첫 기준 컷에서 '지난 결혼식 스타일 값 가져오기'로 씀. 노출·색온도·틴트·하이라이트·섀도는 장면마다 달라서 뺌
// (페르소나 시험 결혼식 3쌍: 같은 작가의 다음 결혼식 기준 컷과 스타일 값 차이 합 15~20 → 0~5).
const STYLE_KEYS = ['contrast', 'saturation', 'sharpen', 'vignette'];
async function putReference(ctx, req, res, params) {
  const u = requireUser(ctx, req);
  const w = wedding(ctx, u, params.id);
  needPrepared(ctx, w);
  needIdle(ctx, w);
  const j = await readJson(req);
  const r = await engine(ctx, 'PUT', `/v1/weddings/${w.id}/zones/${encodeURIComponent(params.z)}/reference`, JSON.stringify(j));
  const s = j?.settings;
  if (r.ok && s && typeof s === 'object') {
    const values = Object.fromEntries(STYLE_KEYS.map((k) => [k, Number(s[k] ?? 0)]));
    if (Object.values(values).every(Number.isFinite)) {
      const next = { ...readPrefs(ctx, u.id), refStyle: { wedding: w.id, title: w.title, values } };
      ctx.db.app.run('INSERT INTO user_prefs (user_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
        u.id, JSON.stringify(next), now());
    }
  }
  await relay(res, r);
}

async function looks(ctx, req, res, params) {
  const u = requireUser(ctx, req);
  const url = new URL(req.url, 'http://x');
  const name = params.name ? `/${encodeURIComponent(params.name)}` : '';
  const q = new URLSearchParams({ user: u.id });
  if (url.searchParams.get('name')) q.set('name', url.searchParams.get('name'));
  let body = null; let ct = 'application/json';
  if (req.method === 'PUT') body = JSON.stringify(await readJson(req));
  if (req.method === 'POST') { body = await readBody(req, 1024 * 1024); ct = 'application/octet-stream'; }
  const p = req.method === 'POST' ? '/v1/looks/import-xmp' : `/v1/looks${name}`;
  await relay(res, await engine(ctx, req.method, `${p}?${q}`, body, ct));
}

// ---------- 14일 자동 삭제 ----------
export function sweepExpired(ctx) {
  const rows = ctx.db.app.all('SELECT id FROM weddings WHERE deleted_at IS NULL AND delete_at < ?', now());
  for (const r of rows) {
    ctx.db.app.run('UPDATE weddings SET deleted_at=? WHERE id=?', now(), r.id);
    submitJob(ctx.db, r.id, 'delete');
  }
  return rows.length;
}

export function weddingRoutes(router) {
  const W = '/api/weddings/:id';
  router.add('GET', '/api/weddings', list)
    .add('POST', '/api/weddings', create)
    .add('GET', W, detail)
    .add('DELETE', W, remove)
    .add('DELETE', '/api/me', deleteAccount)
    .add('POST', `${W}/uploads`, uploadPlan)
    .add('PUT', `${W}/files/:name`, uploadFile)
    .add('POST', `${W}/analyze`, analyze)
    .add('POST', `${W}/learn`, learn)
    .add('POST', `${W}/export`, exportJob)
    .add('GET', `${W}/jobs/:jobId`, jobGet)
    .add('POST', `${W}/jobs/:jobId/cancel`, jobCancel)
    .add('GET', `${W}/download/:jobId`, download)
    .add('POST', `${W}/pay/dev`, devPay)
    // 엔진 API 중계(보정 화면)
    .add('GET', `${W}/zones`, proxy())
    .add('GET', `${W}/zones/:z/candidates`, proxy())
    .add('PUT', `${W}/zones/:z/reference`, putReference)
    .add('GET', `${W}/fixes`, proxy())
    .add('PUT', `${W}/fixes/:pid`, proxy({ write: true }))
    .add('GET', `${W}/photos`, proxy())
    .add('GET', `${W}/suspects`, proxy())
    .add('PUT', `${W}/decisions/:pid`, proxy({ write: true }))
    .add('POST', `${W}/select-done`, proxy({ write: true }))
    .add('GET', `${W}/photos/:pid/render`, proxy({ withUser: true }))
    .add('POST', `${W}/photos/:pid/render`, proxy({ withUser: true }))
    .add('POST', `${W}/photos/:pid/white`, proxy())          // 흰색 찍기(값만 계산, 저장 안 함)
    .add('GET', '/api/looks', looks)
    .add('PUT', '/api/looks/:name', looks)
    .add('DELETE', '/api/looks/:name', looks)
    .add('POST', '/api/looks/import-xmp', looks);
}

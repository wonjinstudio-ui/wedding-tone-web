// 처음부터 끝까지 시험: API 서버(+워커+엔진 API가 떠 있어야 함)에 실제 사진 폴더를 올려 ZIP까지 받는다.
// node scripts/e2e.mjs <API 주소> <JPG 폴더(2400px·EXIF 포함)>
import fs from 'node:fs';
import path from 'node:path';

const [base, folder] = process.argv.slice(2);
let token;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}초]`, ...a);

async function api(method, p, body, raw) {
  const h = { Authorization: `Bearer ${token}` };
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: body ? JSON.stringify(body) : raw });
  const ct = r.headers.get('content-type') || '';
  const out = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(out)}`);
  return out;
}

async function wait(wid, job, label) {
  let last = '';
  for (;;) {
    const { job: j } = await api('GET', `/api/weddings/${wid}/jobs/${job}`);
    const line = `${label}: ${j.state} ${(j.progress * 100).toFixed(0)}% ${j.message || ''}`;
    if (line !== last) { log(line); last = line; }
    if (['done', 'failed', 'canceled'].includes(j.state)) {
      if (j.state !== 'done') throw new Error(`${label} 실패: ${j.error}`);
      return j.result;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const email = `e2e-${Date.now()}@example.com`;
token = (await (await fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'e2e-password-1' }) })).json()).token;
log('가입', email);
const { wedding } = await api('POST', '/api/weddings', { title: '끝까지 시험' });
const wid = wedding.id;
const files = fs.readdirSync(folder).filter((f) => /\.jpe?g$/i.test(f)).sort();
const { targets } = await api('POST', `/api/weddings/${wid}/uploads`, { files: files.map((f) => ({ name: f, size: fs.statSync(path.join(folder, f)).size })) });
for (const t of targets) {
  const r = await fetch(t.url, { method: t.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(path.join(folder, t.name)) });
  if (!r.ok) throw new Error(`업로드 실패 ${t.name} ${r.status}`);
}
log(`업로드 ${targets.length}장`);
const prep = await wait(wid, (await api('POST', `/api/weddings/${wid}/analyze`)).job, '분석');
log(`구역 ${prep.zones.length}개, 손보정 ${prep.fix_queue.length}장, 경고 ${JSON.stringify(prep.warnings)}`);
const zones = await api('GET', `/api/weddings/${wid}/zones`);
for (const z of zones) await api('PUT', `/api/weddings/${wid}/zones/${z.zone}/reference`, { settings: { exposure: 0.15, contrast: 8 } });
const cand = await api('GET', `/api/weddings/${wid}/zones/0/candidates?n=4`);
await api('PUT', `/api/weddings/${wid}/zones/0/reference`, { settings: { exposure: 0.2 }, ref_id: cand.candidates[1] });
log(`기준 컷 ${zones.length}개 저장(구역 1은 다른 사진으로 바꿈)`);
const fx = await api('GET', `/api/weddings/${wid}/fixes`);
for (const [i, it] of fx.items.entries()) await api('PUT', `/api/weddings/${wid}/fixes/${it.id}`, { dx: [0, 1 / 6, -1 / 6, 0][i % 4], dm: 0, dg: 0 });
log(`손보정 ${fx.items.length}장 저장`);
let t = Date.now();
const img = await api('POST', `/api/weddings/${wid}/photos/${fx.items[0].id}/render`, { settings: { exposure: 0.3 }, edge: 1600 });
log(`미리보기 ${img.length >> 10}KB (${Date.now() - t}ms, API 서버 거쳐서)`);
const lr = await wait(wid, (await api('POST', `/api/weddings/${wid}/learn`)).job, '학습');
log('학습 결과', JSON.stringify(lr));
const exJob = (await api('POST', `/api/weddings/${wid}/export`, { look: 'clear_morning' })).job;
const ex = await wait(wid, exJob, '내보내기');
const zip = await api('GET', `/api/weddings/${wid}/download/${exJob}`);
log(`다운로드 ZIP ${(zip.length / 1e6).toFixed(1)}MB, ${ex.photos}장 (첫 바이트 ${zip.subarray(0, 2).toString()})`);
const del = (await api('DELETE', `/api/weddings/${wid}`)).job;
log('삭제 요청', del);
console.log(JSON.stringify({ wid, photos: ex.photos, zipBytes: zip.length, uploaded: targets.length }));

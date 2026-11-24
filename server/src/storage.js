// 저장소: 개발은 로컬 폴더(워커의 wsnap/storage.py LocalStorage와 같은 폴더), 운영은 Cloudflare R2.
// 경로 규칙(워커와 같음): uploads/{결혼식}/{파일}, results/{결혼식}/{작업 id}.zip
//
// 운영(R2)에서는 브라우저가 서버를 거치지 않고 R2에 바로 올리고 받도록 '미리 서명된 주소'를 만들어 준다(AWS 서명 v4).
// 개발(로컬)에서는 이 서버의 /api/weddings/:id/files/:name 으로 올리고 /download 로 받는다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** AWS 서명 v4 미리 서명 주소(S3·R2 공통). host 예: '<계정>.r2.cloudflarestorage.com' */
export function presign({ method, host, bucket, key, accessKeyId, secretAccessKey, region = 'auto', expires = 3600, date = new Date() }) {
  const amz = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');       // 20130524T000000Z
  const day = amz.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const canonUri = '/' + (bucket ? enc(bucket) + '/' : '') + key.split('/').map(enc).join('/');
  const q = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': amz,
    'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const canonQuery = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const canon = [method, canonUri, canonQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, hex(canon)].join('\n');
  let k = hmac('AWS4' + secretAccessKey, day);
  for (const part of [region, 's3', 'aws4_request']) k = hmac(k, part);
  const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  return `https://${host}${canonUri}?${canonQuery}&X-Amz-Signature=${sig}`;
}

export function makeStorage(cfg) {
  if (cfg.r2) {
    const host = `${cfg.r2.accountId}.r2.cloudflarestorage.com`;
    const sign = (method, key, expires) => presign({ method, host, bucket: cfg.r2.bucket, key, accessKeyId: cfg.r2.accessKeyId,
      secretAccessKey: cfg.r2.secretAccessKey, expires });
    return {
      kind: 'r2',
      uploadUrl: (key) => ({ method: 'PUT', url: sign('PUT', key, 3600) }),
      downloadUrl: (key) => sign('GET', key, 600),
      // R2에서 장수 세기·지우기는 워커(delete 작업)가 함
    };
  }
  const root = path.resolve(cfg.storageDir);
  const p = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('저장소 밖 경로');
    return full;
  };
  return {
    kind: 'local',
    root,
    path: p,
    uploadUrl: (key, weddingId, name) => ({ method: 'PUT', url: `${cfg.publicUrl}/api/weddings/${weddingId}/files/${encodeURIComponent(name)}` }),
    // 올리다 끊긴 임시 파일(.part-…)은 세지 않음
    names: (prefix) => { try { return fs.readdirSync(p(prefix)).filter((n) => !/\.part-[0-9a-f]+$/.test(n)); } catch { return []; } },
    count(prefix) { return this.names(prefix).length; },
    exists: (key) => fs.existsSync(p(key)),
  };
}

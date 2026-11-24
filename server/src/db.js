// 데이터베이스: 지금은 Node 내장 SQLite(개발). 운영 PostgreSQL로 갈 때 이 파일만 바꾸도록 SQL을 여기에 모음.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                 -- 'u' + 12자 (엔진의 작가 id로도 씀: 필터 폴더)
  email TEXT UNIQUE,
  password_hash TEXT,                  -- 구글·카카오만 쓰면 비어 있음
  name TEXT,
  free_weddings_left INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT, created_at TEXT NOT NULL, PRIMARY KEY (provider, subject)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS weddings (
  id TEXT PRIMARY KEY,                 -- 'w' + 12자 (워커·엔진의 결혼식 id)
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,     -- 다운로드 권한(체험 사용 또는 결제)
  paid_via TEXT,                       -- 'free' | 'payment' | 'subscription'
  created_at TEXT NOT NULL,
  delete_at TEXT NOT NULL,             -- 이 시각이 지나면 사진·결과 자동 삭제
  deleted_at TEXT,
  planned INTEGER                      -- 올리려던 장수(폴더의 JPG 수). 새로고침 뒤에도 '몇 장 빠졌는지' 알려 주려고
);
CREATE INDEX IF NOT EXISTS weddings_user ON weddings(user_id, created_at);
CREATE TABLE IF NOT EXISTS user_prefs (   -- 작가 설정(계정에 저장 — 다른 컴퓨터에서도 같게): 고른 필터·필터별 조정값
  user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, wedding_id TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL,
  provider TEXT NOT NULL, status TEXT NOT NULL, provider_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

// wsnap/jobs.py 의 SCHEMA_SQLITE 와 같은 표(워커가 먼저 만들 수도, 이쪽이 먼저 만들 수도 있음)
const JOBS_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, wedding_id TEXT NOT NULL, kind TEXT NOT NULL, params TEXT DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'queued', progress REAL DEFAULT 0, message TEXT, result TEXT, error TEXT,
  attempts INTEGER DEFAULT 0, worker TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, heartbeat_at TEXT);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state, created_at);
CREATE INDEX IF NOT EXISTS jobs_wedding ON jobs(wedding_id, state);
`;

export const now = () => new Date().toISOString().replace(/\.\d+Z$/, '+00:00');
export const isoAfter = (days) => new Date(Date.now() + days * 86400e3).toISOString().replace(/\.\d+Z$/, '+00:00');
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function newId(prefix) {
  const b = crypto.randomBytes(12);
  return prefix + Array.from(b, (x) => B32[x & 31]).join('');
}

function open(file, schema) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  db.exec(schema);
  return db;
}

export function openDbs(cfg) {
  const app = open(cfg.appDb, APP_SCHEMA);
  // 2026-11-24 페르소나 6차: 업로드 도중 새로고침하면 몇 장을 올리려던 건지 몰라 일부만으로 처리를 시작할 수 있었음 → 올리려던 장수를 기억
  if (!app.prepare('PRAGMA table_info(weddings)').all().some((c) => c.name === 'planned')) {
    app.exec('ALTER TABLE weddings ADD COLUMN planned INTEGER');
  }
  const jobs = open(cfg.jobsDb, JOBS_SCHEMA);
  const q = (db) => ({
    get: (sql, ...a) => db.prepare(sql).get(...a),
    all: (sql, ...a) => db.prepare(sql).all(...a),
    run: (sql, ...a) => db.prepare(sql).run(...a),
    tx: (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  });
  return { app: q(app), jobs: q(jobs), close: () => { app.close(); jobs.close(); } };
}

// ---------- 작업 대기열(워커가 가져감) ----------
export function submitJob(db, weddingId, kind, params = {}) {
  const id = crypto.randomUUID();
  db.jobs.run(`INSERT INTO jobs (id, wedding_id, kind, params, created_at, message) VALUES (?,?,?,?,?, '대기 중')`,
    id, weddingId, kind, JSON.stringify(params), now());
  return id;
}

export function jobView(r) {
  if (!r) return null;
  return {
    id: r.id, kind: r.kind, state: r.state, progress: r.progress, message: r.message,
    look_name: r.kind === 'export' ? (JSON.parse(r.params || '{}').look_name ?? null) : undefined,
    result: r.result ? JSON.parse(r.result) : null,
    // 워커의 자세한 오류(파이썬 추적 정보)는 작가에게 보이지 않게 첫 줄만
    error: r.error ? String(r.error).split('\n')[0] : null,
    created_at: r.created_at, finished_at: r.finished_at,
  };
}

export function activeJob(db, weddingId) {
  return db.jobs.get(`SELECT * FROM jobs WHERE wedding_id=? AND state IN ('queued','running') ORDER BY created_at LIMIT 1`, weddingId);
}

export function lastJob(db, weddingId, kind) {
  return db.jobs.get(`SELECT * FROM jobs WHERE wedding_id=? AND kind=? ORDER BY created_at DESC LIMIT 1`, weddingId, kind);
}

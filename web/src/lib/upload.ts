// 업로드 큐: 줄이기(Web Worker 여러 개) → 올리기(동시 4개), 파일마다 3번까지 다시 시도. 실패해도 전체는 멈추지 않음.
import { api } from "./api";
import type { ResizeIn, ResizeOut } from "@/workers/resize.worker";

export type UploadState = {
  total: number; done: number; skipped: number; failed: { name: string; reason: string }[]; bytesDone: number; bytesTotal: number;
  noExif: number; startedAt: number; finished: boolean;
};

const EDGE = 2400, QUALITY = 0.9, UP_CONCURRENCY = 4, RETRIES = 3;
const NAME = /^[A-Za-z0-9가-힣._ ()\-]{1,120}\.(jpe?g)$/i;

export function pickJpegs(files: File[]) {
  const ok = files.filter((f) => /\.jpe?g$/i.test(f.name) && !f.name.startsWith("._"));
  const seen = new Set<string>();
  return ok.filter((f) => { const k = f.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 폴더가 달라도 이름이 같아 한 장만 올라가는 사진 수(카메라 두 대가 같은 번호를 쓸 때) */
export function sameNameCount(files: File[]) {
  const ok = files.filter((f) => /\.jpe?g$/i.test(f.name) && !f.name.startsWith("._"));
  return ok.length - new Set(ok.map((f) => f.name.toLowerCase())).size;
}

export async function uploadAll(weddingId: string, files: File[], onChange: (s: UploadState) => void, signal: AbortSignal) {
  const s: UploadState = { total: files.length, done: 0, skipped: 0, failed: [], bytesDone: 0, bytesTotal: 0, noExif: 0, startedAt: Date.now(), finished: false };
  const bad = files.filter((f) => !NAME.test(f.name));
  for (const f of bad) s.failed.push({ name: f.name, reason: "파일 이름에 쓸 수 없는 글자가 있어요" });
  const named = files.filter((f) => NAME.test(f.name));
  // 올릴 주소: 크기는 줄인 뒤라 아직 모름 → 상한(15MB)보다 작은 값으로 미리 신청
  const { targets, skip = [] } = await api.uploadPlan(weddingId, named.map((f) => ({ name: f.name, size: Math.min(f.size, 14 * 1024 * 1024) })));
  const url = new Map(targets.map((t) => [t.name, t]));
  // 이미 올라간 사진은 건너뜀(같은 폴더를 다시 넣었을 때 이어 올리기). 진행 표시에는 '끝난 것'으로 셈
  const skipSet = new Set(skip);
  const good = named.filter((f) => !skipSet.has(f.name));
  s.skipped = named.length - good.length;
  s.done = s.skipped;
  onChange({ ...s });

  const nWorkers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const workers = Array.from({ length: nWorkers }, () => new Worker(new URL("../workers/resize.worker.ts", import.meta.url), { type: "module" }));
  let seq = 0;
  const resize = (w: Worker, file: File) => new Promise<ResizeOut>((resolve) => {
    const id = ++seq;
    const onMsg = (e: MessageEvent<ResizeOut>) => { if (e.data.id === id) { w.removeEventListener("message", onMsg); resolve(e.data); } };
    w.addEventListener("message", onMsg);
    w.postMessage({ id, file, edge: EDGE, quality: QUALITY } satisfies ResizeIn);
  });

  let next = 0;
  const lane = async (w: Worker) => {
    while (!signal.aborted) {
      const i = next++;
      if (i >= good.length) return;
      const f = good[i];
      const r = await resize(w, f);
      if (!r.blob) { s.failed.push({ name: f.name, reason: "사진을 읽지 못했어요(파일이 손상됐을 수 있어요)" }); onChange({ ...s }); continue; }
      if (!r.hadExif) s.noExif++;
      s.bytesTotal += r.blob.size;
      const t = url.get(f.name)!;
      let ok = false, reason = "";
      for (let a = 0; a < RETRIES && !ok && !signal.aborted; a++) {
        try {
          const res = await fetch(t.url, { method: t.method, body: r.blob, credentials: "include", headers: { "Content-Type": "image/jpeg" }, signal });
          ok = res.ok;
          if (!ok) reason = res.status === 413 ? "파일이 너무 커요" : `올리지 못했어요(${res.status})`;
        } catch { reason = "인터넷 연결을 확인해 주세요"; await new Promise((z) => setTimeout(z, 800 * (a + 1))); }
      }
      if (ok) { s.done++; s.bytesDone += r.blob.size; } else if (!signal.aborted) s.failed.push({ name: f.name, reason });
      onChange({ ...s });
    }
  };
  try {
    // 줄이기 일꾼 수만큼 줄, 올리기는 줄마다 1개씩 → 동시 올리기 ≤ UP_CONCURRENCY
    await Promise.all(workers.slice(0, UP_CONCURRENCY).map(lane));
  } finally {
    workers.forEach((w) => w.terminate());
  }
  s.finished = true;
  onChange({ ...s });
  return s;
}

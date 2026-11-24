"use client";
// 미리보기 요청 큐 (DESIGN.md 8절): 진행 중 1개 + 대기 1개(최신 값). 늦게 온 옛 응답은 버린다.
// 새 그림이 올 때까지 이전 그림을 그대로 두고(스피너 없음), 도착하면 바꾼다.
import { useEffect, useRef, useState } from "react";
import { renderWith, type LookSpec, type Settings } from "./api";

type Body = { settings?: Partial<Settings>; look?: LookSpec; mode?: string; edge?: number; delta?: [number, number, number] };

export function usePreview(weddingId: string, pid: number | null, body: Body) {
  // 그림과 함께 '어느 사진의 그림인지'를 들고 있음: 사진이 바뀌면 이전 사진의 그림은 보여 주지 않는다
  // (2026-11-23: Enter 뒤 번호·값은 다음 사진인데 그림은 이전 사진이라 안 본 사진이 저장되던 문제)
  const [shown, setShown] = useState<{ url: string; pid: number } | null>(null);
  const [pending, setPending] = useState(false);
  const st = useRef({ inFlight: false, queued: null as null | { pid: number; body: Body; seq: number }, seq: 0, shown: 0 });
  const key = pid === null ? "" : JSON.stringify([pid, body]);

  useEffect(() => {
    if (pid === null) return;
    const s = st.current;
    const job = { pid, body, seq: ++s.seq };
    const run = async (j: typeof job) => {
      s.inFlight = true; setPending(true);
      try {
        const blob = await renderWith(weddingId, j.pid, j.body as Parameters<typeof renderWith>[2]);
        if (j.seq > s.shown) {                       // 더 새 그림이 이미 나왔으면 버림
          s.shown = j.seq;
          const u = URL.createObjectURL(blob);
          setShown((old) => { if (old) setTimeout(() => URL.revokeObjectURL(old.url), 1000); return { url: u, pid: j.pid }; });
        }
      } catch { /* 다음 요청이 다시 시도 */ }
      s.inFlight = false;
      const q = s.queued; s.queued = null;
      if (q) run(q); else setPending(false);
    };
    if (s.inFlight) s.queued = job; else run(job);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, weddingId]);

  return { url: shown && shown.pid === pid ? shown.url : null, pending };
}

/** 다음 사진 미리 받아 두기(브라우저 캐시) */
export function prefetchImage(src: string) {
  const i = new Image();
  i.decoding = "async";
  i.src = src;
}

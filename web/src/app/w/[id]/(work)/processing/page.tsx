"use client";
// ④ 처리 중: 단계별 진행 · 남은 시간 · "창을 닫아도 계속돼요" · 탭 제목 진행률 · 끝나면 알림. DESIGN.md 12절
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Bar } from "@/components/app/bits";
import { ToneTiles } from "@/components/app/art";
import { api, COPY } from "@/lib/api";
import { useWedding } from "@/lib/hooks";

const STEPS: [string, string][] = [
  ["사진 받는 중", "사진 받기"], ["미리보기", "미리보기 만들기"], ["조명(JPG)", "카메라 조명 정보 읽기"],
  ["얼굴 위치·선명도", "얼굴 위치 찾기"], ["구역", "조명 구역 나누기"], ["밝기 특징", "사진별 밝기 재기"],
];

export default function ProcessingPage() {
  const { id } = useParams<{ id: string }>();
  const q = useWedding(id);
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const w = q.data?.wedding;
  const job = w?.job ?? q.data?.jobs.find((j) => j.kind === "prepare");
  const done = w && (w.stage === "editing" || w.stage === "exported");
  const failed = w?.stage === "analyze_failed";
  const p = done ? 1 : job?.progress ?? 0;
  const stepIdx = done ? STEPS.length : Math.max(0, STEPS.findIndex(([k]) => (job?.message || "").startsWith(k)));

  // 남은 시간: 지켜본 진행 속도로 넉넉하게
  const seen = useRef<{ t: number; p: number } | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  useEffect(() => {
    if (!job || job.state !== "running") return;
    const now = Date.now();
    if (!seen.current || p < seen.current.p) { seen.current = { t: now, p }; return; }
    const dp = p - seen.current.p, dt = (now - seen.current.t) / 1000;
    if (dp > 0.02 && dt > 3) setEta(((1 - p) / (dp / dt)) * 1.15);
  }, [p, job]);

  useEffect(() => { document.title = failed ? "처리 실패 · 웨딩 톤" : done ? "처리 끝 · 웨딩 톤" : `(${Math.round(p * 100)}%) 처리 중`; }, [p, done, failed]);
  const notified = useRef(false);
  useEffect(() => {
    if (done && !notified.current && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      notified.current = true;
      new Notification("처리가 끝났어요", { body: `${w?.title} — 기준 컷 보정을 시작할 수 있어요` });
    }
  }, [done, w?.title]);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");

  const result = q.data?.jobs.find((j) => j.kind === "prepare" && j.state === "done")?.result as
    { photos?: number; zones?: { zone: number }[]; fix_queue?: number[]; warnings?: string[] } | undefined;

  return (
    <div className="relative flex h-full items-center px-[12%] py-8">
      <div className="grid w-full max-w-[920px] gap-16 md:grid-cols-[1fr_300px]">
        <div>
          <p className="text-sm text-text-3">2 · 처리</p>
          <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.02em]">
            {failed ? "처리하지 못했어요" : done ? "준비됐어요" : job?.state === "queued" ? "차례를 기다리는 중" : "사진을 살펴보는 중"}
          </h1>
          {!failed && (
            <>
              <div className="mt-8 flex items-baseline justify-between tnum">
                <span className="text-[40px] font-semibold leading-none">{Math.round(p * 100)}<span className="text-xl text-text-3">%</span></span>
                <span className="text-sm text-text-2">{done ? "" : eta !== null ? (eta < 60 ? "1분 안에 끝나요" : `약 ${Math.ceil(eta / 60)}분 남음`) : "남은 시간 계산 중"}</span>
              </div>
              <Bar value={p} className="mt-4" />
            </>
          )}
          {failed && <p role="alert" className="mt-4 text-md text-danger-fg">{job?.error ?? "알 수 없는 문제가 생겼어요"}</p>}
          {/* 2026-11-24(페르소나 5차): 다른 결혼식 작업 뒤에 줄 서 있을 때 '0%'로 멈춘 것처럼 보였음 */}
          {job?.state === "queued" && <p className="mt-4 text-sm text-text-2">먼저 맡긴 다른 결혼식 작업이 끝나면 바로 시작해요.</p>}
          {!done && !failed && <p className="mt-4 text-sm text-text-2">{COPY.leave}</p>}

          {done && result && (
            <dl className="mt-8 grid grid-cols-3 border-t border-line">
              {[["사진", result.photos], ["조명 구역", result.zones?.length], ["손볼 사진", result.fix_queue?.length]].map(([k, v]) => (
                <div key={k as string} className="border-b border-line py-4 pr-4">
                  <dt className="text-xs text-text-3">{k}</dt>
                  <dd className="mt-1 text-[28px] font-semibold leading-none tnum">{(v as number)?.toLocaleString("ko-KR") ?? "-"}</dd>
                </div>
              ))}
            </dl>
          )}
          {done && !!result?.warnings?.length && <ul className="mt-4 space-y-1 text-sm text-warn-fg">{result.warnings.map((x) => <li key={x}>{x}</li>)}</ul>}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {done ? (
              <Button className="h-11 rounded-xl px-5 text-[15px]" render={<Link href={`/w/${id}/reference`} />} nativeButton={false}>기준 컷 보정 시작 →</Button>
            ) : failed ? (
              <>
                <Button className="h-10 px-5" disabled={retrying}
                  onClick={async () => { setRetrying(true); try { await api.analyze(id); await qc.invalidateQueries({ queryKey: ["wedding", id] }); } finally { setRetrying(false); } }}>
                  다시 시도
                </Button>
                <Button variant="ghost" className="h-10 px-4 text-text-2" render={<Link href={`/w/${id}/upload`} />} nativeButton={false}>업로드 화면으로</Button>
              </>
            ) : perm === "default" ? (
              <Button variant="ghost" className="h-10 px-4 text-text-2" onClick={async () => setPerm(await Notification.requestPermission())}>
                끝나면 알림 받기
              </Button>
            ) : null}
          </div>
        </div>

        {!failed && (
          <div className="self-center">
          <ToneTiles cols={4} rows={3} progress={p} className="mb-8 rounded-xl" label="사진들이 같은 톤으로 맞춰지는 모습" />
          <ol className="border-t border-line text-sm">
            {STEPS.map(([, label], i) => (
              <li key={label} className={cn("flex items-center justify-between border-b border-line py-2.5",
                i < stepIdx ? "text-text-2" : i === stepIdx ? "text-text" : "text-text-3")}>
                <span><span className="mr-3 tnum text-text-3">{i + 1}</span>{label}</span>
                <span className="text-xs tnum">
                  {i < stepIdx ? "끝" : i === stepIdx ? (job?.message?.startsWith("사진 받는 중") ? job.message.replace("사진 받는 중", "").trim() : "진행 중") : ""}
                </span>
              </li>
            ))}
          </ol>
          </div>
        )}
      </div>
      {!done && !failed && <p className="absolute bottom-5 left-6 right-6 text-xs text-text-3">{COPY.edge}</p>}
    </div>
  );
}

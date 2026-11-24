"use client";
// 흔들림 의심 보기(전체 확인에서 여는 화면): 흔들림·초점 의심 사진을 같은 연사의 비교 컷과 나란히(+같은 사람 얼굴 확대). X 빼기 · Enter 남기기.
// 2026-11-23: 예전 '1차 셀렉' 단계였으나 판정 정확도(약 25%)가 낮아 단계에서 빼고 선택 화면으로.
// 자동으로 빼지 않는다(엔진 정확도 약 25%, README 2026-11-23) — 작가가 빠르게 판단하도록 돕기만.
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DesktopOnly } from "@/components/app/work-shell";
import { PhotoStage, isTyping } from "@/components/app/photo-stage";
import { FaceZoom } from "@/components/app/face-zoom";
import { Kbd, LoadError, PanelLabel } from "@/components/app/bits";
import { api, ApiError, FEATURES, renderUrl, type Decision, type Suspect } from "@/lib/api";
import { prefetchImage } from "@/lib/preview";

export default function SelectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const sq = useQuery({ queryKey: ["suspects", id], queryFn: () => api.suspects(id), enabled: FEATURES.blurSuspects });
  useEffect(() => { if (!FEATURES.blurSuspects) router.replace(`/w/${id}/review`); }, [id, router]);   // 숨긴 동안 주소로 들어오면 전체 확인으로
  const [local, setLocal] = useState<Suspect[] | null>(null);
  const items = useMemo(() => local ?? sq.data?.items ?? [], [local, sq.data]);
  const [iRaw, setI] = useState<number | null>(null);
  const firstOpen = items.findIndex((x) => !x.decision);
  const i = Math.min(iRaw ?? (firstOpen < 0 ? 0 : firstOpen), Math.max(items.length - 1, 0));
  const it = items[i];
  const busy = useRef(false);
  const strip = useRef<HTMLDivElement>(null);
  const dropped = items.filter((x) => x.decision === "drop").length;
  const kept = items.filter((x) => x.decision === "keep").length;
  const allDone = items.length > 0 && items.every((x) => x.decision);

  const decide = useCallback(async (d: Decision, advance = true) => {
    if (!it || busy.current) return;
    busy.current = true;
    try {
      await api.decide(id, it.id, d);
      const xs = items.map((x, j) => (j === i ? { ...x, decision: d } : x));
      setLocal(xs);
      if (advance) {
        const n = xs.findIndex((x, j) => j > i && !x.decision);
        setI(n >= 0 ? n : Math.min(i + 1, xs.length - 1));
      }
    } catch (x) { toast.error(x instanceof ApiError ? x.message : "저장하지 못했어요"); }
    finally { busy.current = false; }
  }, [it, items, i, id]);

  async function finish() {
    await qc.invalidateQueries({ queryKey: ["wedding", id] });
    router.push(`/w/${id}/review`);
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || !it) return;
      if (e.code === "KeyX") { e.preventDefault(); if (e.repeat) return; decide(it.decision === "drop" ? "keep" : "drop"); }
      else if (e.code === "Enter") { e.preventDefault(); if (!e.repeat) decide("keep"); }
      else if (e.code === "Backspace" || e.code === "ArrowLeft") { e.preventDefault(); setI(Math.max(0, i - 1)); }
      else if (e.code === "ArrowRight") { e.preventDefault(); setI(Math.min(items.length - 1, i + 1)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [decide, it, i, items.length]);

  useEffect(() => {
    strip.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    const n = items[i + 1];
    if (n) { prefetchImage(renderUrl(id, n.id, { mode: "before", edge: 2400 })); if (n.best) prefetchImage(renderUrl(id, n.best, { mode: "before", edge: 2400 })); }
  }, [i, items, id]);

  if (sq.isSuccess && items.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md">
          <p className="text-sm text-text-3">흔들림 의심 보기</p>
          <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.02em]">흔들린 사진을 찾지 못했어요</h1>
          <p className="mt-3 text-md text-text-2">작업하다 흐린 사진이 보이면 언제든 <Kbd>X</Kbd> 로 뺄 수 있어요.</p>
          <Button className="mt-8 h-11 rounded-xl px-5 text-[15px]" onClick={finish}>← 전체 확인으로</Button>
        </div>
      </div>
    );
  }

  const big = (pid: number) => renderUrl(id, pid, { mode: "before", edge: 2400 });
  if (sq.isError) return <LoadError message={sq.error instanceof ApiError ? sq.error.message : undefined} onRetry={() => sq.refetch()} />;
  return (
    <DesktopOnly>
      <div className="grid h-full" style={{ gridTemplateColumns: "1fr 300px", gridTemplateRows: "1fr 96px" }}>
        <section className="grid min-h-0 grid-cols-2 gap-px bg-line" aria-label="비교">
          {it && [
            { pid: it.id, face: it.face, title: "흔들림·초점 의심", tone: it.decision === "drop" ? "text-danger-fg" : "text-text",
              zoom: "얼굴 확대", hint: "눈·머리카락 선이 또렷한지 보세요" },
            ...(it.best ? [{ pid: it.best, face: it.best_face, title: "같은 연사에서 비교할 컷", tone: "text-text-2",
              zoom: it.same_person ? "같은 사람 얼굴" : null,
              hint: it.same_person ? "왼쪽과 같은 사람이에요" : "같은 사람을 찾지 못했어요. 위 사진 두 장으로 비교해 주세요" }] : []),
          ].map((p) => (
            <div key={p.pid} className="relative flex min-h-0 flex-col bg-bg">
              <div className="flex h-9 shrink-0 items-center justify-between px-4 text-xs">
                <span className={cn("font-medium", p.tone)}>{p.title}{p.pid === it.id && it.decision === "drop" ? " · 뺌" : ""}</span>
              </div>
              <div className={cn("min-h-0 flex-1", p.pid === it.id && it.decision === "drop" && "opacity-40")}>
                <PhotoStage src={big(p.pid)} />
              </div>
              <div className="flex min-h-[137px] shrink-0 items-center gap-3 border-t border-line px-4 py-3">
                {p.zoom ? (
                  <>
                    <div className="w-28"><FaceZoom src={big(p.pid)} box={p.face} label={p.zoom} /></div>
                    <p className="text-xs leading-relaxed text-text-3">{p.zoom}<br />{p.hint}</p>
                  </>
                ) : (
                  // 다른 사람 얼굴끼리 비교하지 않게 확대를 숨김
                  <p className="py-2 text-xs leading-relaxed text-text-3">{p.hint}</p>
                )}
              </div>
            </div>
          ))}
          {it && !it.best && (
            <div className="grid place-items-center bg-bg p-8 text-center text-sm text-text-3">같은 연사의 다른 컷이 없어요.<br />이 사진만 보고 판단해 주세요.</div>
          )}
        </section>

        <aside className="row-span-2 flex flex-col border-l border-line bg-panel" aria-label="판단">
          <div className="p-4">
            <div className="flex items-baseline justify-between">
              <PanelLabel>흔들림 의심 보기</PanelLabel>
              <span className="text-sm tnum text-text-2">{items.length ? i + 1 : 0} / {items.length}</span>
            </div>
            <p className="mt-2 text-sm text-text-2">흔들리거나 초점이 나간 것 같은 사진을 모았어요. 판정이 틀릴 때가 많으니 직접 보고 골라 주세요. 뺀 사진은 다운로드에서 빠지고, 언제든 되살릴 수 있어요.</p>
            {it?.reason && <p className="mt-4 rounded-lg bg-raised px-3 py-2.5 text-xs leading-relaxed text-text-2">{it.reason}</p>}
          </div>
          <div className="space-y-2 px-4">
            <Button variant="outline" className={cn("h-11 w-full justify-between rounded-xl px-4 text-[15px]", it?.decision === "drop" && "border-danger-fg/60 text-danger-fg")}
              onClick={() => decide(it?.decision === "drop" ? "keep" : "drop")}>
              <span>{it?.decision === "drop" ? "되살리기" : "빼기"}</span><Kbd>X</Kbd>
            </Button>
            <Button className="h-11 w-full justify-between rounded-xl px-4 text-[15px]" onClick={() => decide("keep")}>
              <span>남기기</span><span className="text-xs opacity-70">Enter</span>
            </Button>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-2 px-4 text-center">
            <div className="rounded-lg bg-raised py-2"><dt className="text-xs text-text-3">뺀 사진</dt><dd className="text-lg font-semibold tnum">{dropped}</dd></div>
            <div className="rounded-lg bg-raised py-2"><dt className="text-xs text-text-3">남긴 사진</dt><dd className="text-lg font-semibold tnum">{kept}</dd></div>
          </dl>
          <div className="mt-auto space-y-2 border-t border-line p-4">
            <Button className={cn("h-11 w-full rounded-xl text-[15px]", !allDone && "bg-raised text-text hover:bg-hover")} onClick={finish}>
              ← 전체 확인으로
            </Button>
            <p className="text-xs text-text-3"><Kbd>←</Kbd><Kbd>→</Kbd> 사진 이동 · <Kbd>Backspace</Kbd> 이전</p>
          </div>
        </aside>

        <div ref={strip} className="flex items-center gap-1.5 overflow-x-auto border-t border-line bg-panel px-3" aria-label="의심 사진">
          {items.map((x, j) => (
            <button key={x.id} data-i={j} onClick={() => setI(j)} aria-label={`${j + 1}번째${x.decision === "drop" ? " (뺌)" : x.decision === "keep" ? " (남김)" : ""}`}
              className={cn("relative h-[68px] w-[102px] shrink-0 overflow-hidden rounded-md bg-canvas outline-offset-2",
                j === i ? "outline outline-2 outline-text" : "opacity-80 hover:opacity-100")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img loading="lazy" src={renderUrl(id, x.id, { mode: "before", edge: 240 })} alt="" className={cn("h-full w-full object-cover", x.decision === "drop" && "opacity-30")} />
              {x.decision && (
                <span className={cn("absolute right-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  x.decision === "drop" ? "bg-danger text-white" : "bg-black/70 text-white")}>{x.decision === "drop" ? "뺌" : "남김"}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </DesktopOnly>
  );
}

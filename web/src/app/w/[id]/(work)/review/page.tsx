"use client";
// ⑦ 전체 확인: 조명 구역별 격자(2,000장도 가볍게 — 보이는 줄만 그림), 전체 원본 토글, 손본 사진 자물쇠. DESIGN.md 12절
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useHotkeys } from "react-hotkeys-hook";
import { Lock, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DesktopOnly } from "@/components/app/work-shell";
import { PhotoStage, useHoldSpace } from "@/components/app/photo-stage";
import { Kbd, LoadError } from "@/components/app/bits";
import { api, ApiError, FEATURES, renderUrl, type Photo } from "@/lib/api";
import { useWedding, zoneColor } from "@/lib/hooks";

const THUMB = 196, GAP = 6, HEADER = 44;
type Row = { kind: "head"; zone: number; n: number } | { kind: "photos"; items: Photo[] };

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const w = useWedding(id);
  const pq = useQuery({
    queryKey: ["photos", id],
    queryFn: async () => {
      const out: Photo[] = [];
      for (let off = 0; ; off += 1000) {
        const r = await api.photos(id, { offset: off, limit: 1000 });
        out.push(...r.items);
        if (out.length >= r.total || !r.items.length) return out;
      }
    },
  });
  // 이 화면에서 뺀/되살린 사진(서버 저장 후 즉시 반영)
  const [ex, setEx] = useState<Record<number, boolean>>({});
  const photos = useMemo(() => (pq.data ?? []).map((p) => (p.id in ex ? { ...p, excluded: ex[p.id] } : p)), [pq.data, ex]);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [allBefore, setAllBefore] = useState(false);
  const [sel, setSel] = useState(0);
  const [big, setBig] = useState<number | null>(null);
  const held = useHoldSpace();
  useHotkeys("o", () => setAllBefore((v) => !v));

  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const cols = Math.max(2, Math.floor((width + GAP) / (THUMB + GAP)));
  const cell = (width - GAP * (cols - 1)) / cols;

  const { rows, flat } = useMemo(() => {
    const byZone = new Map<number, Photo[]>();
    for (const p of photos) byZone.set(p.zone, [...(byZone.get(p.zone) ?? []), p]);
    const rows: Row[] = []; const flat: Photo[] = [];
    for (const [zone, ps] of [...byZone.entries()].sort((a, b) => a[0] - b[0])) {
      rows.push({ kind: "head", zone, n: ps.length });
      for (let k = 0; k < ps.length; k += cols) rows.push({ kind: "photos", items: ps.slice(k, k + cols) });
      flat.push(...ps);
    }
    return { rows, flat };
  }, [photos, cols]);
  const indexOf = useMemo(() => new Map(flat.map((p, k) => [p.id, k])), [flat]);

  const v = useVirtualizer({
    count: rows.length, getScrollElement: () => scroller.current, overscan: 4,
    estimateSize: (k) => (rows[k].kind === "head" ? HEADER : cell * (2 / 3) + GAP),
  });
  useEffect(() => { v.measure(); }, [cell]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 화살표로 이동, Enter 크게, Esc 닫기
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!flat.length || e.metaKey || e.ctrlKey) return;
      const mv: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: big === null ? cols : 1, ArrowUp: big === null ? -cols : -1 };
      if (e.code in mv) {
        e.preventDefault();
        const n = Math.max(0, Math.min(flat.length - 1, (big ?? sel) + mv[e.code]));
        if (big !== null) setBig(n); setSel(n);
        const rowIdx = rows.findIndex((r) => r.kind === "photos" && r.items.some((p) => p.id === flat[n].id));
        if (big === null && rowIdx >= 0) v.scrollToIndex(rowIdx, { align: "auto" });
      } else if (e.code === "Enter") { e.preventDefault(); setBig(sel); }
      else if (e.code === "Escape") setBig(null);
      else if (e.code === "KeyX") {
        e.preventDefault();
        if (e.repeat) return;   // 누르고 있어도 한 장만
        const p = flat[big ?? sel];
        if (!p) return;
        const next = !p.excluded;
        setEx((m) => ({ ...m, [p.id]: next }));
        api.decide(id, p.id, next ? "drop" : null).catch(() => { setEx((m) => ({ ...m, [p.id]: !next })); toast.error("저장하지 못했어요"); });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [flat, sel, big, cols, rows, v]);

  const learned = w.data?.wedding.progress?.learned;
  const fixedN = photos.filter((p) => p.fixed).length;
  const exN = photos.filter((p) => p.excluded).length;
  const susN = w.data?.wedding.progress?.suspects ?? 0;

  if (pq.isError) return <LoadError message={pq.error instanceof ApiError ? pq.error.message : undefined} onRetry={() => pq.refetch()} />;
  return (
    <DesktopOnly>
      <div className="flex h-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
          <h1 className="text-sm font-medium">전체 확인</h1>
          <span className="text-xs text-text-3 tnum">{photos.length.toLocaleString("ko-KR")}장 · 손본 {fixedN}장은 다시 옮겨도 그대로 둬요{exN ? ` · 뺀 사진 ${exN}장(다운로드에서 빠짐)` : ""} · <Kbd>X</Kbd> 빼기·되살리기</span>
          <div className="ml-auto flex items-center gap-2">
            {FEATURES.blurSuspects && susN > 0 && (   // 2026-11-23: 1차 셀렉 단계 대신 원하는 작가만 여는 확인 화면
              <Button variant="ghost" size="sm" className="h-8" render={<Link href={`/w/${id}/select`} />} nativeButton={false}
                title="흔들리거나 초점이 나간 것 같은 사진만 모아 보기. 판정이 틀릴 때가 많아 자동으로 빼지는 않아요.">
                흔들림 의심 {susN.toLocaleString("ko-KR")}장 보기
              </Button>
            )}
            <Button variant={allBefore ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setAllBefore((x) => !x)} aria-pressed={allBefore}>
              전체 원본 보기 <Kbd>O</Kbd>
            </Button>
            <Button size="sm" className="h-8 px-3" render={<Link href={`/w/${id}/filter`} />} nativeButton={false}>필터 고르기 →</Button>
          </div>
        </div>
        {learned === false && (
          <div className="border-b border-line bg-raised px-4 py-2 text-sm text-warn-fg">
            아직 나머지 사진에 옮기지 않았어요. <Link className="font-medium underline" href={`/w/${id}/fixes`}>손보정 화면</Link>에서 옮겨 주세요.
          </div>
        )}
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4" tabIndex={-1}>
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((vi) => {
              const r = rows[vi.index];
              return (
                <div key={vi.key} className="absolute left-0 w-full" style={{ top: vi.start, height: vi.size }}>
                  {r.kind === "head" ? (
                    <div className="flex h-full items-end gap-2 pb-2 text-sm font-semibold text-text">
                      <span className="size-2.5 rounded-full" style={{ background: zoneColor(r.zone) }} />구역 {r.zone + 1}
                      <span className="font-normal text-text-3 tnum">{r.n.toLocaleString("ko-KR")}장</span>
                    </div>
                  ) : (
                    <div className="flex" style={{ gap: GAP }}>
                      {r.items.map((p) => {
                        const k = indexOf.get(p.id)!;
                        const before = allBefore || (held && k === sel);
                        return (
                          <button key={p.id} onClick={() => { setSel(k); setBig(k); }} onMouseEnter={() => setSel(k)}
                            className={cn("relative shrink-0 overflow-hidden rounded-[2px] bg-[color-mix(in_oklch,var(--canvas),white_5%)] outline-offset-2",
                              k === sel && "outline outline-2 outline-text", p.is_ref && "ring-1 ring-text-2 ring-offset-2 ring-offset-[var(--canvas)]")}
                            style={{ width: cell, height: cell * (2 / 3) }} aria-label={`${p.name}${p.is_ref ? " · 기준 컷" : ""}${p.fixed ? " · 손봄" : ""}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img loading="lazy" decoding="async" src={renderUrl(id, p.id, { mode: before ? "before" : "learn", edge: 400 })} alt=""
                              className={cn("h-full w-full object-cover", p.excluded && "opacity-25")} />
                            {p.excluded && <span className="absolute inset-0 grid place-items-center text-xs font-semibold text-white">뺌 · X로 되살리기</span>}
                            {p.is_ref && <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">기준</span>}
                            {p.fixed && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-sm bg-black/70"><Lock className="size-3 text-white" /></span>}
                            {before && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">원본</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {big !== null && flat[big] && (
        <div className="theme-work fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-label="크게 보기">
          <div className="flex h-12 items-center gap-3 border-b border-line bg-panel px-4 text-sm">
            <span className="font-medium">{flat[big].name}</span>
            <span className="text-text-3 tnum">{big + 1} / {flat.length} · 구역 {flat[big].zone + 1}</span>
            <span className="ml-auto text-xs text-text-3"><Kbd>←</Kbd><Kbd>→</Kbd> 이동 · <Kbd>Space</Kbd> 원본 · <Kbd>Esc</Kbd> 닫기</span>
            <button onClick={() => setBig(null)} aria-label="닫기" className="grid size-8 place-items-center rounded-md hover:bg-raised"><X className="size-4" /></button>
          </div>
          <div className="min-h-0 flex-1">
            <PhotoStage key={flat[big].id} src={renderUrl(id, flat[big].id, { mode: "learn", edge: 1600 })} beforeSrc={renderUrl(id, flat[big].id, { mode: "before", edge: 1600 })} showBefore={held} />
          </div>
        </div>
      )}
    </DesktopOnly>
  );
}

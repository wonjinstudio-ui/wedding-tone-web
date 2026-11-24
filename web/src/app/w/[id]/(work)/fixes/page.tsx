"use client";
// ⑥ 손보정 40~50장(조명 구역이 많을수록 늘고 최대 50장, tonefix.MAX_PER_WEDDING): 키보드로 밝기·색온도·틴트만. 프로토타입(tonefix.py)과 같은 키. DESIGN.md 9절
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DesktopOnly } from "@/components/app/work-shell";
import { PhotoStage, isTyping, useHoldSpace } from "@/components/app/photo-stage";
import { sign } from "@/components/app/slider-row";
import { Kbd, LoadError, PanelLabel } from "@/components/app/bits";
import Link from "next/link";
import { api, ApiError, renderUrl, type FixItem } from "@/lib/api";
import { prefetchImage, usePreview } from "@/lib/preview";
import { usePrefs, zoneColor } from "@/lib/hooks";

export default function FixesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const fq = useQuery({ queryKey: ["fixes", id], queryFn: () => api.fixes(id) });
  // 서버 목록에서 시작해 이 화면에서 고친 값을 들고 있음
  const [local, setLocal] = useState<FixItem[] | null>(null);
  const items = useMemo(() => local ?? fq.data?.items ?? [], [local, fq.data]);
  // 목록이 오기 전에 누른 키는 버림(빈 목록이 서버 목록을 가려 "0 / 0"으로 굳던 문제, 2026-11-23)
  const setItems = useCallback((fn: (xs: FixItem[]) => FixItem[]) => setLocal((prev) => {
    const base = prev ?? fq.data?.items;
    return base ? fn(base) : prev;
  }), [fq.data]);
  const [iRaw, setI] = useState<number | null>(null);
  const firstOpen = items.findIndex((x) => !x.done && !x.excluded);
  const i = iRaw ?? (firstOpen < 0 ? items.length : firstOpen);
  const [learning, setLearning] = useState(false);
  const held = useHoldSpace();
  const { hintSeen, set: setPrefs } = usePrefs();
  const strip = useRef<HTMLDivElement>(null);
  const saving = useRef(false);   // 저장 중에 Enter를 또 누르면 무시(같은 사진 두 번 저장 방지)
  // 키(프로토타입과 같음, 2026-11-23 틴트만 G/M → , . 로): ↑↓ 밝기 · ←→ 색온도 · , . 틴트 초록/마젠타
  const ROWS = [
    { key: "dx" as const, label: "밝기", keys: ["↑", "↓"], fmt: (v: number) => (v ? `${sign(v, 2)} 스톱` : "0") },
    { key: "dm" as const, label: "색온도", keys: ["←", "→"], fmt: (v: number) => (v ? `${v > 0 ? "따뜻하게" : "차갑게"} ${Math.abs(v)}` : "0") },
    { key: "dg" as const, label: "틴트", keys: [",", "."], fmt: (v: number) => (v ? `${v > 0 ? "마젠타" : "초록"} ${Math.abs(v)}` : "0") },
  ];


  const it = items[i];
  const finished = items.length > 0 && i >= items.length;
  const doneN = items.filter((x) => x.done).length;
  const delta: [number, number, number] = it ? [it.dx, it.dm, it.dg] : [0, 0, 0];
  const { url } = usePreview(id, it?.id ?? null, { mode: "zone0", delta, edge: 1600 });

  // 다음 사진 두 장을 미리 그려 둠(서버 현상 캐시를 데움)
  useEffect(() => {
    for (const k of [1, 2]) { const n = items[i + k]; if (n) prefetchImage(renderUrl(id, n.id, { mode: "zone0", edge: 1600, dx: n.dx, dm: n.dm, dg: n.dg })); }
  }, [i, items, id]);
  useEffect(() => { strip.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }, [i]);

  const bump = useCallback((k: "dx" | "dm" | "dg", v: number) => {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: Math.round((x[k] + v) * 1000) / 1000 } : x)));
  }, [i, setItems]);

  const save = useCallback(async () => {
    const cur = items[i];
    if (!cur || saving.current || !url) return;   // 이 사진의 그림이 아직 안 떴으면 저장하지 않음(안 본 사진 저장 방지)
    saving.current = true;
    try {
      await api.saveFix(id, cur.id, { dx: cur.dx, dm: cur.dm, dg: cur.dg });
      const xs = items.map((x, j) => (j === i ? { ...x, done: true } : x));
      setLocal(xs);
      const open = (x: FixItem) => !x.done && !x.excluded;
      const n = xs.findIndex((x, j) => j > i && open(x));
      setI(n >= 0 ? n : (xs.findIndex(open) >= 0 ? xs.findIndex(open) : xs.length));
      if (hintSeen < 3) setPrefs({ hintSeen: hintSeen + 1 });
    } catch (x) { toast.error(x instanceof ApiError ? x.message : "저장하지 못했어요"); }
    finally { saving.current = false; }
  }, [items, i, id, hintSeen, setPrefs, url]);

  // X: 이 사진 빼기(다운로드에서 제외) → 다음 사진으로. 한 번 더 누르면 되살리기
  const toggleExclude = useCallback(async () => {
    const cur = items[i];
    if (!cur || saving.current) return;
    saving.current = true;
    const next = !cur.excluded;
    try {
      await api.decide(id, cur.id, next ? "drop" : null);
      const xs = items.map((x, j) => (j === i ? { ...x, excluded: next } : x));
      setLocal(xs);
      if (next) {
        toast(`이 사진을 뺐어요`, { action: { label: "되돌리기", onClick: () => { api.decide(id, cur.id, null); setLocal((p) => (p ?? xs).map((x) => (x.id === cur.id ? { ...x, excluded: false } : x))); } } });
        const n = xs.findIndex((x, j) => j > i && !x.done && !x.excluded);
        setI(n >= 0 ? n : xs.length);
      }
    } catch (x) { toast.error(x instanceof ApiError ? x.message : "빼지 못했어요"); }
    finally { saving.current = false; }
  }, [items, i, id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!items.length) return;   // 목록이 오기 전
      const big = e.shiftKey ? 3 : 1;
      const m: Record<string, () => void> = {
        ArrowUp: () => bump("dx", big / 6), ArrowDown: () => bump("dx", -big / 6),
        ArrowRight: () => bump("dm", 10 * big), ArrowLeft: () => bump("dm", -10 * big),
        Comma: () => bump("dg", -5 * big), Period: () => bump("dg", 5 * big),     // 쉼표 = 초록, 마침표 = 마젠타
        KeyG: () => bump("dg", -5 * big), KeyM: () => bump("dg", 5 * big),       // 예전 키도 그대로 동작
        KeyX: () => { if (!e.repeat) toggleExclude(); },   // 누르고 있어도 한 장만
        Digit0: () => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, dx: 0, dm: 0, dg: 0 } : x))),
        Numpad0: () => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, dx: 0, dm: 0, dg: 0 } : x))),
        Enter: () => { if (!e.repeat) save(); },
        Backspace: () => setI(Math.max(0, Math.min(i, items.length) - 1)),
      };
      const f = m[e.code];
      if (f && !finished) { e.preventDefault(); f(); }
      else if (e.code === "Backspace" && finished) { e.preventDefault(); setI(items.length - 1); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [bump, save, i, items.length, finished, setItems, toggleExclude]);

  async function learn() {
    setLearning(true);
    try {
      const { job } = await api.learn(id);
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const j = (await api.job(id, job)).job;
        if (j.state === "done") break;
        if (j.state === "failed" || j.state === "canceled") throw new ApiError(500, j.error || "옮기지 못했어요");
      }
      await qc.invalidateQueries({ queryKey: ["wedding", id] });
      router.push(`/w/${id}/review`);
    } catch (x) { toast.error(x instanceof ApiError ? x.message : "옮기지 못했어요"); setLearning(false); }
  }

  const colors = fq.data?.colors ?? {};
  const changed = useMemo(() => items.filter((x) => x.done && (x.dx || x.dm || x.dg)).length, [items]);

  if (fq.isError) return (
    <LoadError message={fq.error instanceof ApiError ? fq.error.message : undefined} onRetry={() => fq.refetch()}>
      <Link className="text-sm text-text-2 underline underline-offset-4" href={`/w/${id}/reference`}>기준 컷 화면으로</Link>
    </LoadError>
  );
  return (
    <DesktopOnly>
      <div className="grid h-full" style={{ gridTemplateColumns: "1fr 280px", gridTemplateRows: "1fr 104px" }}>
        <section className="relative min-h-0" aria-label="손볼 사진">
          {finished ? (
            <div className="grid h-full place-items-center bg-canvas p-8">
              <div className="w-full max-w-md">
                <h1 className="text-[28px] font-semibold tracking-[-0.02em]">손보정을 마쳤어요</h1>
                <p className="mt-3 text-md text-text-2 tnum">{items.length}장 중 {changed}장을 손봤고, {items.length - changed}장은 그대로 좋다고 했어요.</p>
                <Button className="mt-8 h-11 px-6 text-[15px]" onClick={learn} disabled={learning}>
                  {learning ? <><Loader2 className="animate-spin" /> 나머지에 옮기는 중…</> : "나머지 사진에 옮기기"}
                </Button>
                <p className="mt-4 text-sm text-text-3"><Kbd>Backspace</Kbd> 로 돌아가 고칠 수 있어요</p>
              </div>
            </div>
          ) : (
            <>
              <PhotoStage src={url} beforeSrc={it ? renderUrl(id, it.id, { mode: "before" }) : null} showBefore={held} />
              {/* 그림이 뜨기 전의 Enter는 저장하지 않음(안 본 사진 저장 방지) → 왜 안 넘어가는지 한 줄로 알려 줌 */}
              {it && !url && <p role="status" className="pointer-events-none absolute left-0 right-0 top-1/2 text-center text-sm text-text-3">사진을 불러오는 중… 뜨면 Enter로 저장해요</p>}
              {hintSeen < 3 && (
                <p className="pointer-events-none absolute bottom-1.5 left-0 right-0 text-center text-xs text-text-3">
                  <Kbd>↑</Kbd><Kbd>↓</Kbd> 밝기 · <Kbd>←</Kbd><Kbd>→</Kbd> 색온도 · <Kbd>,</Kbd><Kbd>.</Kbd> 틴트 · <Kbd>Enter</Kbd> 저장하고 다음 · <Kbd>X</Kbd> 빼기
                </p>
              )}
            </>
          )}
        </section>

        <aside className="row-span-2 flex flex-col border-l border-line bg-panel" aria-label="값">
          <div className="p-4">
            <div className="flex items-baseline justify-between">
              <PanelLabel>손보정</PanelLabel>
              <span className="text-sm tnum text-text-2">{Math.min(i + 1, items.length)} / {items.length}</span>
            </div>
            <p className="mt-1 text-xs text-text-3">기준 컷과 같은 톤·밝기로 보이게 맞춰 주세요. 그대로 좋으면 <Kbd>Enter</Kbd></p>
          </div>
          {it && (
            <div className="px-4">
              <div className="text-xs text-text-3">이 구역 기준 컷</div>
              <div className="mt-1.5 overflow-hidden rounded-[2px] bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={renderUrl(id, it.ref, { mode: "ref", edge: 560 })} alt="기준 컷" className="aspect-[3/2] w-full object-contain" />
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-text-2">
                <span className="size-2 rounded-full" style={{ background: colors[it.zone] ?? zoneColor(it.zone) }} />구역 {it.zone + 1}
              </div>
              <dl className="mt-5 space-y-3">
                {ROWS.map((r) => {
                  const v = r.fmt(it[r.key]);
                  return (
                    <div key={r.key} className="flex items-center justify-between">
                      <dt className="flex items-center gap-2 text-sm text-text-2">{r.label} <span className="flex gap-0.5">{r.keys.map((x) => <Kbd key={x}>{x}</Kbd>)}</span></dt>
                      <dd className={cn("text-md font-semibold tnum", v === "0" ? "text-text-3" : "text-text")}>{v}</dd>
                    </div>
                  );
                })}
              </dl>
              <button onClick={toggleExclude} className="mt-4 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-text-2 hover:bg-raised hover:text-text">
                <span>{it.excluded ? "뺀 사진이에요 · 되살리기" : "흔들렸거나 못 쓰는 사진이면 빼기"}</span><Kbd>X</Kbd>
              </button>
            </div>
          )}
          <div className="mt-auto space-y-2 border-t border-line p-4">
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 flex-1" disabled={i === 0} onClick={() => setI(Math.max(0, i - 1))}><ChevronLeft /> 이전</Button>
              <Button className="h-10 flex-[2]" disabled={finished} onClick={save}>저장하고 다음 <ChevronRight /></Button>
            </div>
            <p className="text-xs text-text-3 tnum">{doneN} / {items.length}장 끝 · Shift를 누르면 3배</p>
          </div>
        </aside>

        <div ref={strip} className="flex items-center gap-1.5 overflow-x-auto border-t border-line bg-panel px-3" aria-label="손볼 사진">
          {items.map((x, j) => (
            <button key={x.id} data-i={j} onClick={() => setI(j)} aria-label={`${j + 1}번째 사진${x.done ? " (끝)" : ""}`}
              className={cn("relative h-[72px] w-[108px] shrink-0 overflow-hidden rounded-[2px] bg-canvas outline-offset-2",
                j === i ? "outline outline-2 outline-text" : "opacity-70 hover:opacity-100")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img loading="lazy" src={renderUrl(id, x.id, { mode: "zone0", edge: 240, dx: x.dx, dm: x.dm, dg: x.dg })} alt="" className="h-full w-full object-cover" />
              <span className="absolute bottom-0 left-0 h-0.5 w-full" style={{ background: colors[x.zone] ?? zoneColor(x.zone) }} />
              {x.excluded ? <span className="absolute inset-0 grid place-items-center bg-black/60 text-[11px] font-semibold text-white">뺌</span>
                : x.done && <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-sm bg-black/70"><Check className="size-3 text-white" /></span>}
            </button>
          ))}
        </div>
      </div>
    </DesktopOnly>
  );
}

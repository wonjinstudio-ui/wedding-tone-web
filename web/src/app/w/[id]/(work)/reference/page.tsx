"use client";
// ⑤ 기준 컷 보정: 왼쪽 조명 구역 · 가운데 사진 · 오른쪽 슬라이더 9개 · 아래 같은 구역 미리보기. DESIGN.md 12절
// 키보드: ↑↓ 조정할 항목 고르기(테두리) · ←→ 값 바꾸기(Shift ×5)
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHotkeys } from "react-hotkeys-hook";
import { Check, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DesktopOnly } from "@/components/app/work-shell";
import { PendingBadge, PhotoStage, isTyping, useHoldSpace } from "@/components/app/photo-stage";
import { REF_SLIDERS, SliderRow } from "@/components/app/slider-row";
import { Kbd, LoadError, PanelLabel } from "@/components/app/bits";
import { api, ApiError, renderUrl, type Settings, type Zone } from "@/lib/api";
import { usePreview } from "@/lib/preview";
import { zoneColor } from "@/lib/hooks";

// 구역마다 다른 빛 값(노출·색온도·틴트)은 빼고, 작가 스타일 값만 다른 구역에서 가져옴 (2026-11-23 페르소나 피드백)
// 2026-11-24(페르소나 4차): 하이라이트·섀도는 장면마다 다른 값이라 빼고 진짜 스타일 값만(역광 구역의 섀도 +15가 밤 장면에 따라가던 문제)
const STYLE_KEYS = ["contrast", "saturation", "sharpen", "vignette"] as const;
const STYLE_TEXT = "대비·채도·샤프닝·비네팅";

const base = (z: Zone): Settings => ({ exposure: 0, temp: Math.round(z.ref_cct || z.cct || 5000), tint: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, sharpen: 0, vignette: 0 });

export default function ReferencePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const zq = useQuery({ queryKey: ["zones", id], queryFn: () => api.zones(id) });
  const zones = useMemo(() => zq.data ?? [], [zq.data]);
  const [curRaw, setCur] = useState(0);
  const [edits, setEdits] = useState<Record<number, Settings>>({});
  const [left, setLeft] = useState(true), [right, setRight] = useState(true);
  const [pick, setPick] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);     // 화이트 밸런스 스포이트 모드(W)
  const held = useHoldSpace();
  useHotkeys("bracketleft", () => setLeft((v) => !v));
  useHotkeys("bracketright", () => setRight((v) => !v));
  useHotkeys("w", () => setPicking((v) => !v));
  useHotkeys("escape", () => setPicking(false));

  const cur = curRaw < zones.length ? curRaw : 0;
  const z = zones[cur];
  const S: Settings | null = z ? edits[z.zone] ?? { ...base(z), ...(z.settings ?? {}) } : null;
  const dirty = z && S && JSON.stringify(S) !== JSON.stringify({ ...base(z), ...(z.settings ?? {}) });
  // 색온도가 비어 있으면(찍은 그대로) 그 구역의 찍힌 색온도로 보여 줌
  const val = (k: keyof Settings) => (S?.[k] as number | null | undefined) ?? (z ? (base(z)[k] as number) : 0) ?? 0;
  const set = (k: keyof Settings, v: number) => z && S && setEdits((e) => ({ ...e, [z.zone]: { ...S, [k]: v } }));
  const { url, pending } = usePreview(id, z?.ref ?? null, { settings: S ?? undefined, edge: 1600 });

  // 같은 구역 사진(아래 줄): 슬라이더를 놓았을 때만 다시 그림
  const strip = useQuery({
    queryKey: ["strip", id, z?.zone], enabled: !!z,
    queryFn: async () => {
      const r = await api.photos(id, { zone: z!.zone, limit: 1000 });
      const others = r.items.filter((p) => !p.is_ref);
      return Array.from({ length: Math.min(7, others.length) }, (_, i) => others[Math.floor((i * others.length) / Math.min(7, others.length))].id);
    },
  });
  // 슬라이더를 놓았을 때의 값으로만 아래 줄을 다시 그림(움직이는 동안은 그대로)
  const [snap, setSnap] = useState<{ zone: number; s: Settings } | null>(null);
  const stripS: Settings | null = z ? (snap && snap.zone === z.zone ? snap.s : { ...base(z), ...(z.settings ?? {}) }) : null;

  // 키보드: ↑↓로 항목 고르기, ←→로 값 바꾸기. 슬라이더에 포커스가 있어도 두 번 움직이지 않게 capture 단계에서 먼저 받음
  // 고른 슬라이더는 구역마다 기억(새 구역은 노출부터)
  const [actMap, setActMap] = useState<Record<number, number>>({});
  const act = z ? actMap[z.zone] ?? 0 : 0;
  const setAct = (f: (a: number) => number) => z && setActMap((m) => ({ ...m, [z.zone]: f(m[z.zone] ?? 0) }));
  // 스타일 값 가져올 구역: 목록에서 이 구역 앞쪽으로 가장 가까운 저장된 구역, 없으면 뒤쪽
  const src = z ? [...zones.slice(0, cur).reverse(), ...zones.slice(cur + 1)].find((x) => x.settings) : undefined;
  const srcDiffers = !!(src && S && STYLE_KEYS.some((k) => ((src.settings?.[k] as number) ?? 0) !== ((S[k] as number) ?? 0)));
  function copyStyle() {
    if (!z || !S || !src?.settings) return;
    const next = { ...S };
    for (const k of STYLE_KEYS) next[k] = (src.settings[k] as number) ?? 0;
    setEdits((e) => ({ ...e, [z.zone]: next }));
    setSnap({ zone: z.zone, s: next });
  }
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || !z || !S || pick) return;
      if (e.code === "ArrowUp" || e.code === "ArrowDown") {
        e.preventDefault(); e.stopPropagation();
        // 맨 위·맨 아래에서 멈춤(예전엔 한 바퀴 돌아 '↑ 여러 번 = 노출'이 안 통했음, 페르소나 4차)
        setAct((a) => Math.max(0, Math.min(REF_SLIDERS.length - 1, a + (e.code === "ArrowDown" ? 1 : -1))));
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault(); e.stopPropagation();
        const d = REF_SLIDERS[act], k = d.key as keyof Settings;
        const step = d.step * (e.shiftKey ? 5 : 1) * (e.code === "ArrowRight" ? 1 : -1);
        const v = Math.min(d.max, Math.max(d.min, Math.round((val(k) + step) / d.step) * d.step));
        const next = { ...S, [k]: v };
        setEdits((x) => ({ ...x, [z.zone]: next }));
        if (snapTimer.current) clearTimeout(snapTimer.current);
        snapTimer.current = setTimeout(() => setSnap({ zone: z.zone, s: next }), 450);   // 손을 떼면 아래 줄 다시 그림
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- val은 z·S로만 정해짐
  }, [z, S, act, pick]);
  useEffect(() => () => { if (snapTimer.current) clearTimeout(snapTimer.current); }, []);

  // 화이트 밸런스 스포이트: 누른 자리가 흰색이 되는 색온도·틴트를 엔진에서 받아 슬라이더에 넣음(저장은 '기준으로 저장'에서)
  async function pickWhite(x: number, y: number, pure = false) {
    if (!z || !S) return;
    setPicking(false);
    try {
      const r = await api.pickWhite(id, z.ref, x, y, pure);
      const sign = (n: number) => (n > 0 ? "+" : "") + n;
      // 이미 날아간 곳은 색 정보가 없어 값을 바꾸지 않음(6차: 경고를 띄우면서 값은 3723K → 3700K로 바뀌어 헷갈렸음)
      if (r.clipped) { toast.warning("찍은 곳이 이미 하얗게 날아간 부분이라 색을 알 수 없어요. 값은 그대로 두었어요 — 결이 보이는 흰 부분을 찍어 주세요"); return; }
      const next = { ...S, temp: r.temp, tint: r.tint };
      setEdits((e) => ({ ...e, [z.zone]: next }));
      setSnap({ zone: z.zone, s: next });
      const what = pure ? "순백으로" : "드레스(아이보리) 기준으로";
      if (r.shaded) toast.warning(`이 사진의 다른 흰 부분보다 어두운 곳이에요(그늘·다른 빛일 수 있어요). 차갑게 잡혔으면 빛을 정면으로 받은 흰 부분을 다시 찍어 주세요 · 색온도 ${r.temp}K · 틴트 ${sign(r.tint)}`);
      else if (r.limited) toast.warning(`슬라이더 끝까지 맞췄어요(정확히는 ${r.exact.temp}K · 틴트 ${r.exact.tint}). 찍은 곳이 흰색이 맞는지 확인해 주세요`);
      else toast(`찍은 곳을 ${what} 맞췄어요 · 색온도 ${r.temp}K · 틴트 ${sign(r.tint)}${pure ? "" : " · 흰 벽·종이처럼 순백이면 Shift를 누르고 누르기"}`);
    } catch (x) { toast.error(x instanceof ApiError ? x.message : "화이트 밸런스를 맞추지 못했어요"); }
  }

  async function save() {
    if (!z || !S) return;
    setSaving(true);
    try {
      await api.saveReference(id, z.zone, S);
      await qc.invalidateQueries({ queryKey: ["zones", id] });
      setEdits((e) => { const n = { ...e }; delete n[z.zone]; return n; });
      // 다음 구역은 0에서 시작(2026-11-25 직접 시험: 구역 1 값이 구역 2로 따라와 헷갈림 — 예전엔 스타일 값을 자동으로 넣었음).
      // 같은 스타일을 쓰고 싶으면 '구역 N 스타일 값 가져오기' 버튼으로 직접 가져옴
      const nextIdx = zones.findIndex((x, i) => i !== cur && !x.settings);
      if (nextIdx >= 0) setCur(nextIdx);
    } catch (x) { toast.error(x instanceof ApiError ? x.message : "저장하지 못했어요"); }
    setSaving(false);
  }

  async function changeRef(pid: number) {
    if (!z || !S) return;
    try {
      await api.saveReference(id, z.zone, S, pid);
      await qc.invalidateQueries({ queryKey: ["zones", id] });
      setPick(false);
    } catch (x) { toast.error(x instanceof ApiError ? x.message : "바꾸지 못했어요"); }
  }

  const allSaved = zones.length > 0 && zones.every((x) => x.settings);

  if (zq.isError) return <LoadError message={zq.error instanceof ApiError ? zq.error.message : undefined} onRetry={() => zq.refetch()} />;
  return (
    <DesktopOnly>
      <div className="grid h-full" style={{ gridTemplateColumns: `${left ? 240 : 0}px 1fr ${right ? 300 : 0}px`, gridTemplateRows: "1fr 112px" }}>
        {/* 왼쪽: 조명 구역 */}
        <aside className={cn("row-span-2 overflow-y-auto border-r border-line bg-panel", !left && "hidden")} aria-label="조명 구역">
          <div className="px-4 pb-2 pt-4">
            <PanelLabel>조명 구역</PanelLabel>
            <p className="mt-1 text-xs text-text-3">구역마다 기준 컷 한 장을 보정해요</p>
          </div>
          <ul className="px-2 pb-4">
            {zones.map((x, i) => (
              <li key={x.zone}>
                <button onClick={() => setCur(i)} aria-current={i === cur}
                  className={cn("flex w-full items-center gap-3 rounded-sm p-2 text-left hover:bg-hover", i === cur && "bg-raised")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={renderUrl(id, x.ref, { mode: "ref", edge: 160, v: JSON.stringify(x.settings) })} alt="" className="h-10 w-14 shrink-0 rounded-[2px] bg-canvas object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <span aria-hidden className="size-2 rounded-full" style={{ background: zoneColor(x.zone) }} />구역 {x.zone + 1}
                    </span>
                    <span className="block text-xs text-text-3 tnum">{x.n.toLocaleString("ko-KR")}장 · 약 {Math.round(x.cct / 100) * 100}K</span>
                  </span>
                  {x.settings ? <Check aria-label="저장됨" className="size-3.5 text-text-2" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* 가운데: 사진 */}
        <section className="relative min-h-0" aria-label="기준 컷">
          <PhotoStage src={url} beforeSrc={z ? renderUrl(id, z.ref, { mode: "before" }) : null} showBefore={held}
            onPick={picking ? pickWhite : undefined}
            badge={z && <span className="flex items-center gap-2 text-xs text-text-3">{url && pending && <PendingBadge />}구역 {z.zone + 1} · 기준 컷</span>} />
          {picking && <p role="status" className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-black/75 px-3 py-1.5 text-sm text-white">스포이트: 흰 드레스·흰 벽처럼 원래 흰 곳을 누르세요 · <Kbd>Shift</Kbd>+누르기 순백 · <Kbd>Esc</Kbd> 취소</p>}
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-text-3">
            <Kbd>Space</Kbd> 누르는 동안 원본 · <Kbd>Z</Kbd> 확대 · <Kbd>W</Kbd> 스포이트
          </div>
        </section>

        {/* 오른쪽: 슬라이더 */}
        <aside className={cn("row-span-2 flex flex-col border-l border-line bg-panel", !right && "hidden")} aria-label="보정값">
          <div className="flex-1 overflow-y-auto px-4 pt-4">
            <div className="flex items-center justify-between">
              <PanelLabel>기준 컷 보정</PanelLabel>
              {dirty && <span className="text-xs text-warn-fg">저장 안 함</span>}
            </div>
            <p className="mt-1 text-xs text-text-3">이 값이 같은 구역 사진의 출발점이 돼요.</p>
            <p className="mt-1 text-xs text-text-3"><Kbd>↑</Kbd><Kbd>↓</Kbd> 항목 고르기 · <Kbd>←</Kbd><Kbd>→</Kbd> 값 · <Kbd>Shift</Kbd> 크게</p>
            <div className="mt-3 divide-y divide-line/60">
              {z && S && REF_SLIDERS.map((d, i) => (
                <SliderRow key={d.key} active={i === act} onSelect={() => setAct(() => i)} def={d.key === "temp" ? { ...d, center: base(z).temp ?? 5000 } : d}
                  value={val(d.key as keyof Settings)} reset={(base(z)[d.key as keyof Settings] as number) ?? 0}
                  onChange={(v) => set(d.key as keyof Settings, v)} onCommit={() => z && S && setSnap({ zone: z.zone, s: { ...S } })} />
              ))}
            </div>
            {src && srcDiffers && (
              <button onClick={copyStyle} className="mt-4 block w-full rounded-lg border border-line px-3 py-2 text-left text-sm text-text-2 hover:bg-hover hover:text-text">
                구역 {src.zone + 1} 스타일 값 가져오기
                <span className="mt-0.5 block text-xs text-text-3">{STYLE_TEXT} (노출·색온도·하이라이트·섀도는 그대로)</span>
              </button>
            )}
            <button onClick={() => setPicking((v) => !v)} aria-pressed={picking}
              className={cn("mt-4 block w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-hover", picking ? "border-text text-text" : "border-line text-text-2")}>
              화이트 밸런스 스포이트 <Kbd>W</Kbd>
              <span className="mt-0.5 block text-xs text-text-3">사진에서 원래 흰 곳(드레스·벽)을 누르면 그곳이 흰색이 되게 색온도·틴트를 맞춰요. 드레스는 아이보리로 보고 아주 살짝 따뜻하게, Shift를 누르고 누르면 순백</span>
            </button>
          </div>
          <div className="space-y-2 border-t border-line p-4">
            <Button className="h-10 w-full text-[15px]" variant={z?.settings && !dirty ? "secondary" : "default"} onClick={save} disabled={saving || !z || (!!z.settings && !dirty)}>
              {z?.settings && !dirty ? "✓ 저장됨" : `구역 ${z ? z.zone + 1 : ""} 기준으로 저장`}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" className="h-9 flex-1 text-text-2" disabled={!dirty}
                onClick={() => z && setEdits((e) => { const n = { ...e }; delete n[z.zone]; return n; })}>되돌리기</Button>
              {allSaved && (
                <Button variant="outline" className="h-9 flex-1" onClick={() => router.push(`/w/${id}/fixes`)}>손보정으로 →</Button>
              )}
            </div>
            <p className="text-xs text-text-3 tnum">{zones.filter((x) => x.settings).length} / {zones.length} 구역 저장됨</p>
          </div>
        </aside>

        {/* 아래: 같은 구역 사진에 옮겨질 모습 */}
        <section className="flex min-w-0 items-center gap-2 overflow-x-auto border-t border-line bg-panel px-3" aria-label="같은 구역 미리보기">
          {/* 2026-11-25 직접 시험: 기준 컷 바꾸기는 오른쪽 조정 메뉴가 아니라 사진 줄에서(줄 맨 앞 — 끝에 두면 좁은 화면에서 가려짐) */}
          <button onClick={() => setPick(true)} disabled={!z}
            className="flex h-[84px] w-[104px] shrink-0 flex-col items-center justify-center gap-1 rounded-[2px] border border-dashed border-line text-xs text-text-2 hover:border-text-2 hover:bg-hover hover:text-text">
            <ImageIcon className="size-4" />기준 컷 바꾸기
          </button>
          <span className="w-16 shrink-0 text-xs leading-tight text-text-3">같은 구역에<br />옮기면</span>
          {z && stripS && strip.data?.map((pid) => <StripThumb key={pid} id={id} pid={pid} settings={stripS} />)}
        </section>
      </div>

      <Dialog open={pick} onOpenChange={setPick}>
        <DialogContent className="theme-work rounded-md bg-popover text-text sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>구역 {z ? z.zone + 1 : ""}의 다른 사진을 기준으로</DialogTitle>
            <DialogDescription className="text-text-2">빛이 가장 대표적인 사진을 고르세요. 보정값은 그대로 가져가요.</DialogDescription>
          </DialogHeader>
          {z && <Candidates id={id} zone={z.zone} current={z.ref} onPick={changeRef} />}
        </DialogContent>
      </Dialog>
    </DesktopOnly>
  );
}

function StripThumb({ id, pid, settings }: { id: string; pid: number; settings: Settings }) {
  const { url } = usePreview(id, pid, { settings, edge: 320 });
  return (
    <div className="h-[84px] w-[126px] shrink-0 overflow-hidden rounded-[2px] bg-canvas">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </div>
  );
}

function Candidates({ id, zone, current, onPick }: { id: string; zone: number; current: number; onPick: (pid: number) => void }) {
  const q = useQuery({ queryKey: ["cand", id, zone], queryFn: () => api.candidates(id, zone, 12) });
  return (
    <div className="mt-2 grid grid-cols-4 gap-3">
      {q.data?.candidates.map((pid) => (
        <button key={pid} onClick={() => pid !== current && onPick(pid)} disabled={pid === current}
          className={cn("relative aspect-[3/2] overflow-hidden rounded-[2px] bg-canvas outline-offset-2 hover:outline hover:outline-2 hover:outline-text-2",
            pid === current && "outline outline-2 outline-text")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={renderUrl(id, pid, { mode: "before", edge: 360 })} alt="" className="h-full w-full object-cover" />
          {pid === current && <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">지금 기준</span>}
        </button>
      ))}
    </div>
  );
}

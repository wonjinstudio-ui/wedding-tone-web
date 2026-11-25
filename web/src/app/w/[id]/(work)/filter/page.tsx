"use client";
// ⑧ 필터: 왼쪽 목록 · 가운데 크게 · 오른쪽 '필터 조정'(강도 + 세부 9개). DESIGN.md 12절
// 2026-11-23: 기본 필터가 너무 세다는 작가 의견 → 엔진 기본값을 낮추고, 필터마다 수치를 조정해 저장(계정, /api/me/prefs).
// 2026-11-25: 오른쪽 위 '피부 톤'(뽀얀·생기·따뜻한) — 필터와 따로 고르고 겹쳐 씀. 사람 분리의 피부 부분만 바뀜.
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHotkeys } from "react-hotkeys-hook";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DesktopOnly } from "@/components/app/work-shell";
import { PhotoStage, useHoldSpace } from "@/components/app/photo-stage";
import { SliderRow, sign, type SliderDef } from "@/components/app/slider-row";
import { Kbd, PanelLabel } from "@/components/app/bits";
import { api, renderUrl } from "@/lib/api";
import { lookSpec, SKIN_TONES, useAccountPrefs, type LookAdj } from "@/lib/hooks";
import { usePreview } from "@/lib/preview";

const n0 = (v: number) => String(Math.round(v));
// 엔진 looks.ADJUST 와 같은 이름·범위
const ADJ: SliderDef[] = [
  { key: "warmth", label: "따뜻함", min: -100, max: 100, step: 1, fmt: (v) => sign(v) },
  { key: "contrast", label: "대비", min: -50, max: 50, step: 1, fmt: (v) => sign(v) },
  { key: "saturation", label: "채도", min: -50, max: 50, step: 1, fmt: (v) => sign(v) },
  { key: "fade", label: "페이드 (뿌연 정도)", min: 0, max: 100, step: 1, fmt: n0 },
  { key: "glow", label: "뽀샤시 (글로우)", min: 0, max: 100, step: 1, fmt: n0 },
  { key: "halation", label: "빛 번짐 (할레이션)", min: 0, max: 100, step: 1, fmt: n0 },
  { key: "vignette", label: "비네팅", min: 0, max: 100, step: 1, fmt: n0 },
  { key: "clarity", label: "선명도", min: 0, max: 100, step: 1, fmt: n0 },
  { key: "sharpen", label: "샤프닝", min: 0, max: 100, step: 1, fmt: n0 },
];
const STRENGTH: SliderDef = { key: "strength", label: "강도", min: 0, max: 150, step: 5, fmt: n0, unit: "%", center: 0 };
const SKIN_STRENGTH: SliderDef = { ...STRENGTH, key: "skin", label: "피부 톤 강도" };

export default function FilterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const lq = useQuery({ queryKey: ["looks"], queryFn: api.looks });
  const zq = useQuery({ queryKey: ["zones", id], queryFn: () => api.zones(id) });
  const { look, lookAdj, skin, set } = useAccountPrefs();
  const held = useHoldSpace();
  const options = useMemo(() => [{ key: "", name: "필터 없음", desc: "보정만, 색감은 그대로", adjust: undefined }, ...(lq.data ?? [])], [lq.data]);
  const [sample, setSample] = useState(0);
  const refs = zq.data?.map((z) => z.ref) ?? [];
  const pid = refs[sample % Math.max(refs.length, 1)];
  const cur = Math.max(0, options.findIndex((o) => o.key === (look ?? "")));
  const move = (d: number) => set({ look: options[Math.max(0, Math.min(options.length - 1, cur + d))].key || null });
  useHotkeys("up", () => move(-1), [cur, options]);
  useHotkeys("down", () => move(1), [cur, options]);
  useHotkeys("enter", () => router.push(`/w/${id}/download`), [id]);

  const item = look ? options.find((o) => o.key === look) : undefined;
  const defaults: LookAdj | null = item?.adjust ? { strength: 1, adjust: item.adjust } : null;
  const adj: LookAdj | null = look && defaults ? lookAdj?.[look] ?? defaults : null;
  const adjusted = !!(look && lookAdj?.[look]);
  const change = (k: string, v: number) => {
    if (!look || !defaults) return;
    set((cur) => {      // 화면에 그려진 값이 아니라 지금 저장소 값에서 계산(빠른 키 입력에서 다른 항목 값이 옛 값으로 돌아가지 않게)
      const a = cur.lookAdj?.[look] ?? defaults;
      const next = k === "strength" ? { ...a, strength: v / 100 } : { ...a, adjust: { ...a.adjust, [k]: v } };
      return { lookAdj: { ...cur.lookAdj, [look]: next } };
    });
  };
  const resetAll = () => { if (!look) return; const n = { ...lookAdj }; delete n[look]; set({ lookAdj: n }); };
  const spec = lookSpec(look, lookAdj, skin);
  const { url } = usePreview(id, pid ?? null, { mode: "learn", edge: 1600, look: spec });

  return (
    <DesktopOnly>
      <div className="grid h-full" style={{ gridTemplateColumns: "280px 1fr 300px" }}>
        <aside className="flex flex-col border-r border-line bg-panel" aria-label="필터">
          <div className="p-4">
            <h1 className="text-xs font-semibold tracking-[0.02em] text-text-3">필터</h1>
            <p className="mt-1 text-xs text-text-3">고객에게 보낼 셀렉본의 색감이에요. <Kbd>↑</Kbd><Kbd>↓</Kbd> 고르기</p>
          </div>
          <ul className="flex-1 space-y-1 overflow-y-auto px-2" role="listbox" aria-label="필터 목록">
            {options.map((o) => {
              const on = (look ?? "") === o.key;
              return (
                <li key={o.key || "none"}>
                  <button role="option" aria-selected={on} onClick={() => set({ look: o.key || null })}
                    className={cn("flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-hover", on && "bg-raised")}>
                    <span className="h-12 w-[72px] shrink-0 overflow-hidden rounded-md bg-canvas">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {pid !== undefined && <img loading="lazy" src={renderUrl(id, pid, { mode: "learn", edge: 200, look: o.key || null })} alt="" className="h-full w-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{o.name}{o.key && lookAdj?.[o.key] ? <span className="ml-1.5 text-xs font-normal text-text-3">조정함</span> : null}</span>
                      <span className="block truncate text-xs text-text-3">{o.desc}</span>
                    </span>
                    {on && <Check className="size-3.5 text-text" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line p-4">
            <Button className="h-10 w-full rounded-xl text-[15px]" onClick={() => router.push(`/w/${id}/download`)}>이 필터로 다운로드 →</Button>
            <p className="mt-3 text-xs text-text-3">내 필터 만들기(완성본 몇 장으로 내 색감 배우기)는 곧 열려요.</p>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col" aria-label="미리보기">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 text-xs text-text-2">
            미리보기 사진:
            {refs.map((r, k) => (
              <button key={r} onClick={() => setSample(k)} className={cn("rounded-md px-2 py-1 hover:bg-hover", k === sample && "bg-raised text-text")}>구역 {k + 1}</button>
            ))}
            <span className="ml-auto"><Kbd>Space</Kbd> 필터 전 · <Kbd>Z</Kbd> 100% 확대</span>
          </div>
          <div className="min-h-0 flex-1">
            {pid !== undefined && (
              <PhotoStage src={url ?? renderUrl(id, pid, { mode: "learn", edge: 1600 })} beforeSrc={renderUrl(id, pid, { mode: "learn", edge: 1600 })}
                showBefore={held} />
            )}
          </div>
        </section>

        <aside className="flex flex-col border-l border-line bg-panel" aria-label="필터 조정">
          <div className="flex-1 overflow-y-auto px-4 pt-4">
            <PanelLabel>피부 톤</PanelLabel>
            <p className="mt-1 text-xs text-text-3">필터와 함께 써요. 사람 피부만 바뀌고 드레스·배경은 그대로예요.</p>
            <div className="mt-3 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="피부 톤">
              {[{ key: null, name: "그대로", desc: "피부 톤 바꾸지 않음" }, ...SKIN_TONES].map((t) => {
                const on = (skin?.key ?? null) === t.key;
                return (
                  <button key={t.key ?? "none"} role="radio" aria-checked={on} title={t.desc}
                    onClick={() => set({ skin: t.key ? { key: t.key, s: skin?.s ?? 1 } : null })}
                    className={cn("h-9 rounded-lg border border-line text-sm hover:bg-hover", on && "border-text bg-raised font-medium")}>
                    {t.name}
                  </button>
                );
              })}
            </div>
            {skin && (
              <div className="mt-2">
                <SliderRow def={SKIN_STRENGTH} value={Math.round(skin.s * 100)} reset={100}
                  onChange={(v) => set((cur) => (cur.skin ? { skin: { ...cur.skin, s: v / 100 } } : {}))} />
                <p className="text-xs text-text-3">{SKIN_TONES.find((t) => t.key === skin.key)?.desc}</p>
              </div>
            )}
            <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
              <PanelLabel>필터 조정</PanelLabel>
              {adjusted && <button onClick={resetAll} className="text-xs text-text-2 underline underline-offset-4 hover:text-text">처음 값으로</button>}
            </div>
            {!look || !adj || !defaults ? (
              <p className="mt-3 pb-4 text-sm text-text-3">필터를 고르면 세기와 세부 값을 바꿀 수 있어요.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-text-3">바꾼 값은 이 필터에 기억돼요. 이름을 더블클릭하면 그 항목만 처음 값으로.</p>
                <div className="mt-3 border-b border-line pb-2">
                  <SliderRow def={STRENGTH} value={Math.round(adj.strength * 100)} reset={100} onChange={(v) => change("strength", v)} />
                </div>
                <div className="mt-1 divide-y divide-line/60">
                  {ADJ.map((d) => (
                    <SliderRow key={d.key} def={d} value={adj.adjust[d.key] ?? 0} reset={defaults.adjust[d.key] ?? 0} onChange={(v) => change(d.key, v)} />
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </DesktopOnly>
  );
}

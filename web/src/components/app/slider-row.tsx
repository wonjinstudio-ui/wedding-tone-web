"use client";
// 슬라이더 한 줄: 이름 · 값(직접 입력 가능) · 트랙. 더블클릭 = 초기화. 가운데 0 기준 값은 0에서 양쪽으로 채움. DESIGN.md 7절
import { useRef, useState } from "react";
import { Slider as S } from "@base-ui/react/slider";
import { cn } from "cn";

export type SliderDef = { key: string; label: string; min: number; max: number; step: number; fmt: (v: number) => string; unit?: string; center?: number };

export function SliderRow({ def, value, onChange, onCommit, reset, active, onSelect }: {
  def: SliderDef; value: number; onChange: (v: number) => void; onCommit?: () => void; reset: number;
  active?: boolean; onSelect?: () => void;   // 키보드 ↑↓로 고른 줄이면 테두리
}) {
  const [edit, setEdit] = useState<string | null>(null);
  // 화살표 키는 직접 받음: 화면이 다시 그려지기 전에 다음 키가 오면(키를 누르고 있을 때) 옛 값에서 계산돼 절반쯤 빠졌음(2026-11-24).
  // 방금 키로 정한 값을 0.4초 동안 기억해 그 값에서 이어 계산.
  const lastKey = useRef<{ v: number; t: number } | null>(null);
  const onArrow = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    const now = Date.now();
    const from = lastKey.current && now - lastKey.current.t < 400 ? lastKey.current.v : value;
    const raw = from + dir * def.step * (e.shiftKey ? 10 : 1);
    const v = Math.min(def.max, Math.max(def.min, Math.round(raw / def.step) * def.step));
    lastKey.current = { v, t: now };
    if (v !== value) onChange(v);
  };
  const c = def.center ?? 0;
  const pct = (v: number) => ((v - def.min) / (def.max - def.min)) * 100;
  const lo = Math.min(pct(c), pct(value)), hi = Math.max(pct(c), pct(value));
  const changed = Math.abs(value - reset) > 1e-9;
  return (
    <div onPointerDown={onSelect} data-active={active || undefined}
      className={cn("-mx-2 rounded-lg px-2 py-1.5 ring-inset transition-shadow", active && "bg-raised/60 ring-2 ring-brand-fg/70")}>
      <div className="flex h-6 items-center justify-between">
        <label className={cn("text-sm", changed ? "text-text" : "text-text-2")} onDoubleClick={() => { onChange(reset); onCommit?.(); }}
          title="더블클릭하면 처음 값으로">{def.label}</label>
        {edit === null ? (
          <button className="rounded px-1 text-sm tnum text-text hover:bg-raised" onClick={() => setEdit(String(value))} aria-label={`${def.label} 값 직접 입력`}>
            {def.fmt(value)}{def.unit && <span className="ml-0.5 text-xs text-text-3">{def.unit}</span>}
          </button>
        ) : (
          <input autoFocus className="h-6 w-20 rounded border border-line-strong bg-raised px-1.5 text-right text-sm tnum outline-none focus:border-brand-fg"
            value={edit} onChange={(e) => setEdit(e.target.value)}
            onBlur={() => { const v = parseFloat(edit.replace("−", "-")); if (!isNaN(v)) { onChange(Math.min(def.max, Math.max(def.min, v))); onCommit?.(); } setEdit(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(null); }} />
        )}
      </div>
      <S.Root value={value} min={def.min} max={def.max} step={def.step} onValueChange={(v) => onChange(v as number)}
        onValueCommitted={() => onCommit?.()} onKeyDownCapture={onArrow} onKeyUp={() => onCommit?.()} className="w-full">
        <S.Control className="relative flex h-6 w-full touch-none items-center select-none" onDoubleClick={() => { onChange(reset); onCommit?.(); }}>
          <S.Track className="relative h-1 w-full rounded-full bg-raised">
            <span aria-hidden className="absolute top-0 h-full rounded-full bg-text-3" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
            <span aria-hidden className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-line-strong" style={{ left: `${pct(c)}%` }} />
            <S.Thumb aria-label={def.label} getAriaValueText={() => `${def.fmt(value)}${def.unit ?? ""}`}
              className="block size-3.5 rounded-full border border-line-strong bg-text shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-fg focus-visible:ring-offset-2 focus-visible:ring-offset-panel" />
          </S.Track>
        </S.Control>
      </S.Root>
    </div>
  );
}

export const sign = (v: number, d = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);

export const REF_SLIDERS: SliderDef[] = [
  { key: "exposure", label: "노출", min: -3, max: 3, step: 0.05, fmt: (v) => sign(v, 2), unit: "EV" },
  { key: "temp", label: "색온도", min: 2500, max: 8000, step: 50, fmt: (v) => String(Math.round(v)), unit: "K" },
  { key: "tint", label: "틴트", min: -50, max: 50, step: 1, fmt: (v) => sign(v) },
  { key: "contrast", label: "대비", min: -50, max: 50, step: 1, fmt: (v) => sign(v) },
  { key: "highlights", label: "하이라이트", min: -100, max: 100, step: 1, fmt: (v) => sign(v) },
  { key: "shadows", label: "섀도", min: -100, max: 100, step: 1, fmt: (v) => sign(v) },
  { key: "saturation", label: "채도", min: -50, max: 50, step: 1, fmt: (v) => sign(v) },
  { key: "sharpen", label: "샤프닝", min: 0, max: 100, step: 1, fmt: (v) => String(Math.round(v)) },
  { key: "vignette", label: "비네팅", min: -100, max: 100, step: 1, fmt: (v) => sign(v) },   // 라이트룸처럼 − = 가장자리 어둡게
];

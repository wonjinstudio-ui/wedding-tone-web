// 직접 그린 그래픽(외부 이미지 없음). 2026-11-23 — "딱딱하다"는 피드백으로 로고·설명 그림 추가.
// 사진 대신 '사진처럼 보이는 색 타일'로 "찍은 그대로 → 같은 톤으로"를 보여 준다.
import { useId } from "react";
import { cn } from "cn";

/** 로고 표시: 겹친 두 반지, 겹친 자리에 하나로 맞춰진 톤 */
export function LogoMark({ size = 26, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(86% 0.06 60)" />
          <stop offset="1" stopColor="oklch(72% 0.08 20)" />
        </linearGradient>
        <clipPath id={`c${id}`}><circle cx="12" cy="16" r="8.2" /></clipPath>
      </defs>
      <circle cx="20" cy="16" r="8.2" fill={`url(#g${id})`} clipPath={`url(#c${id})`} />
      <circle cx="12" cy="16" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="20" cy="16" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

// 타일마다 '찍은 그대로'의 어긋난 빛(색상각·밝기 차이)과, 맞춘 뒤의 같은 톤
const SHIFT: [number, number][] = [   // [색상각 이동, 밝기 이동(%p)]
  [-38, 6], [22, -10], [0, 2], [48, -4], [-18, -14], [30, 9], [-50, -2], [12, -8], [36, 4], [-28, 10], [8, -12], [-8, 5],
];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function Tile({ x, y, w, h, t, i, r = 6 }: { x: number; y: number; w: number; h: number; t: number; i: number; r?: number }) {
  const id = `t${i}${useId().replace(/:/g, "")}`;
  const [dh, dl] = SHIFT[i % SHIFT.length];
  const hue = lerp(65 + dh, 65, t), L = lerp(dl, 0, t), C = lerp(0.07, 0.035, t);
  const top = `oklch(${84 + L}% ${C} ${hue})`, bottom = `oklch(${60 + L}% ${C} ${hue - 8})`;
  const dress = `oklch(${96 + L * 0.2}% ${lerp(0.03, 0.01, t)} ${hue})`;
  // 두 사람 실루엣(얼굴 없음): 왼쪽 드레스, 오른쪽 정장
  const cx = x + w * (0.45 + ((i * 37) % 10) / 100), base = y + h;
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={top} /><stop offset="1" stopColor={bottom} /></linearGradient>
        <clipPath id={`${id}c`}><rect x={x} y={y} width={w} height={h} rx={r} /></clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect x={x} y={y} width={w} height={h} fill={`url(#${id})`} style={{ transition: "fill 600ms" }} />
        <circle cx={x + w * 0.8} cy={y + h * 0.25} r={h * 0.14} fill={`oklch(${92 + L * 0.3}% ${C * 0.6} ${hue + 10})`} opacity="0.55" />
        <circle cx={cx - w * 0.07} cy={base - h * 0.52} r={h * 0.065} fill={dress} />
        <path d={`M${cx - w * 0.12} ${base} L${cx - w * 0.07 - w * 0.03} ${base - h * 0.45} L${cx - w * 0.07 + w * 0.03} ${base - h * 0.45} L${cx - w * 0.01} ${base} Z`} fill={dress} />
        <circle cx={cx + w * 0.07} cy={base - h * 0.56} r={h * 0.06} fill={`oklch(${32 + L * 0.3}% 0.01 50)`} />
        <path d={`M${cx + w * 0.02} ${base} L${cx + w * 0.045} ${base - h * 0.49} L${cx + w * 0.095} ${base - h * 0.49} L${cx + w * 0.12} ${base} Z`} fill={`oklch(${30 + L * 0.3}% 0.01 50)`} />
      </g>
    </g>
  );
}

/** 사진처럼 보이는 타일 묶음. t=0 찍은 그대로(제각각), t=1 같은 톤. progress로 차례대로 맞춰짐 */
export function ToneTiles({ cols = 4, rows = 3, t, progress, className, label }: {
  cols?: number; rows?: number; t?: number; progress?: number; className?: string; label?: string;
}) {
  const w = 60, h = 40, gap = 6;
  const W = cols * w + (cols - 1) * gap, H = rows * h + (rows - 1) * gap;
  const n = cols * rows;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-auto w-full", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: n }, (_, i) => {
        const tt = t ?? Math.max(0, Math.min(1, (progress ?? 0) * (n + 3) - i));   // 진행률에 따라 한 장씩
        return <Tile key={i} i={i} t={tt} x={(i % cols) * (w + gap)} y={Math.floor(i / cols) * (h + gap)} w={w} h={h} />;
      })}
    </svg>
  );
}

/** 빈 화면 그림: 겹쳐 놓인 사진 액자 세 장과 반지 */
export function FrameStack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 160" className={cn("h-auto w-full", className)} aria-hidden>
      <g transform="rotate(-8 110 90)"><rect x="34" y="34" width="120" height="86" rx="10" fill="var(--panel)" className="drop-shadow-sm" /><g transform="translate(42 42)"><ToneTilesInner t={0} i={2} /></g></g>
      <g transform="rotate(5 110 90)"><rect x="62" y="30" width="120" height="86" rx="10" fill="var(--panel)" className="drop-shadow-sm" /><g transform="translate(70 38)"><ToneTilesInner t={0.4} i={5} /></g></g>
      <g><rect x="48" y="52" width="120" height="86" rx="10" fill="var(--panel)" className="drop-shadow" /><g transform="translate(56 60)"><ToneTilesInner t={1} i={0} /></g></g>
      <g transform="translate(150 18)" color="var(--text)"><LogoMarkInner /></g>
    </svg>
  );
}

function ToneTilesInner({ t, i }: { t: number; i: number }) {
  return <Tile x={0} y={0} w={104} h={70} t={t} i={i} r={6} />;
}

function LogoMarkInner() {
  const id = useId().replace(/:/g, "");
  return (
    <g>
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="oklch(86% 0.06 60)" /><stop offset="1" stopColor="oklch(72% 0.08 20)" /></linearGradient>
        <clipPath id={`lc${id}`}><circle cx="16" cy="20" r="11" /></clipPath>
      </defs>
      <circle cx="16" cy="20" r="17" fill="var(--panel)" />
      <circle cx="26" cy="20" r="11" fill={`url(#lg${id})`} clipPath={`url(#lc${id})`} />
      <circle cx="16" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="26" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
    </g>
  );
}

// 여러 화면에서 쓰는 작은 부품. DESIGN.md 7절 · 2026-11-23 개편: 장식 빼기(알약 배지·깜빡이는 점·네모 로고 없음)
import { cn } from "cn";
import type { Stage } from "@/lib/api";
import { LogoMark } from "./art";

/** 로고: 겹친 두 반지(겹친 자리 = 맞춰진 톤) + 이름(임시). 이름은 바탕체 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={26} />
      <span className="font-display text-[19px] tracking-[-0.01em]">웨딩 톤</span>
    </span>
  );
}

/** 진행 막대: 둥근 6px */
export function Bar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-raised", className)}>
      <div className="h-full rounded-full bg-text transition-[width] duration-300 ease-out" style={{ width: `${v * 100}%` }} />
    </div>
  );
}

const STAGE_TEXT: Record<Stage, string> = {
  uploading: "업로드 전", analyzing: "처리 중", analyze_failed: "처리 실패", editing: "보정할 차례", learning: "옮기는 중",
  exporting: "내보내는 중", exported: "다운로드 가능", deleting: "삭제 중",
};

/** 단계: 옅은 바탕의 둥근 표시. 할 일이 있는 단계(보정할 차례·다운로드 가능)만 장밋빛 */
export function StageText({ stage, progress, className }: { stage: Stage; progress?: number; className?: string }) {
  const tone = stage === "analyze_failed" ? "bg-danger/10 text-danger-fg" : stage === "editing" || stage === "exported" ? "bg-accent-soft text-accent-deep" : "bg-raised text-text-2";
  const pct = progress !== undefined && (stage === "analyzing" || stage === "exporting") ? ` ${Math.round(progress * 100)}%` : "";
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium tnum", tone, className)}>{STAGE_TEXT[stage]}{pct}</span>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-raised px-1 font-sans text-[11px] font-medium text-text-2">{children}</kbd>;
}

/** 목록을 못 불러왔을 때: 이유 한 줄 + 다시 시도(빈 화면으로 두지 않음, 2026-11-23) */
export function LoadError({ message, onRetry, children }: { message?: string; onRetry: () => void; children?: React.ReactNode }) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-md text-text">{message || "불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."}</p>
      <div className="flex items-center gap-4">
        <button className="h-10 rounded-xl bg-raised px-4 text-sm font-medium text-text hover:bg-line" onClick={onRetry}>다시 시도</button>
        {children}
      </div>
    </div>
  );
}

/** 패널 안 작은 제목(작업 화면) */
export function PanelLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("text-xs font-semibold tracking-[0.02em] text-text-3", className)}>{children}</h2>;
}

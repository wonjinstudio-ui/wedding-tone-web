"use client";
// 작업 화면 공통 틀(작업 테마): 상단바 48px — 목록으로 · 결혼식 이름 · 단계 · 사진 뒤 회색 · 단축키(?). DESIGN.md 6절
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ChevronLeft } from "lucide-react";
import { cn } from "cn";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "./bits";
import { usePrefs, useWedding } from "@/lib/hooks";

const STEPS = [
  { key: "upload", label: "업로드" }, { key: "processing", label: "처리" }, { key: "reference", label: "기준 컷" },
  { key: "fixes", label: "손보정" }, { key: "review", label: "전체 확인" }, { key: "filter", label: "필터" },
] as const;

const CANVAS = [
  { key: "dark", label: "어두운 회색", swatch: "oklch(27% 0 0)" },
  { key: "mid", label: "중간 회색 (색 판단에 권장)", swatch: "oklch(56.5% 0 0)" },
  { key: "light", label: "밝은 회색", swatch: "oklch(96% 0 0)" },
] as const;

export const SHORTCUTS: { group: string; items: [string[], string][] }[] = [
  { group: "어디서나", items: [[["?"], "단축키 표"], [["Space"], "누르는 동안 원본 보기"], [["Z"], "100% 확대"], [["["], "왼쪽 패널 접기"], [["]"], "오른쪽 패널 접기"]] },
  { group: "흔들림 의심 보기 (전체 확인에서)", items: [[["X"], "빼기"], [["Enter"], "남기기"], [["Backspace"], "이전 사진"]] },
  { group: "기준 컷", items: [[["↑", "↓"], "조정할 슬라이더 고르기"], [["←", "→"], "고른 슬라이더 값 바꾸기"], [["Shift"], "+ ←→ = 5배"], [["W"], "화이트 밸런스 스포이트(누른 곳을 흰색으로)"]] },
  { group: "손보정", items: [[["↑", "↓"], "밝기 ±1/6스톱"], [["←", "→"], "색온도 (→ 따뜻하게)"], [[",", "."], "틴트 초록 / 마젠타"],
    [["Shift"], "+ 위 키 = 3배"], [["0"], "이 사진 초기화"], [["Enter"], "저장하고 다음"], [["Backspace"], "이전 사진"], [["X"], "이 사진 빼기"]] },
  { group: "전체 확인", items: [[["←", "→", "↑", "↓"], "사진 이동"], [["X"], "빼기 / 되살리기"], [["O"], "전체 원본 보기 켜고 끄기"]] },
];

export function WorkShell({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = usePathname();
  const w = useWedding(id);
  const { canvas, set } = usePrefs();
  const [help, setHelp] = useState(false);
  useHotkeys("shift+slash", () => setHelp((v) => !v));
  // 흔들림 의심 보기(/select)는 단계가 아니라 전체 확인에서 여는 화면 → 전체 확인에 불을 켬
  const current = STEPS.findIndex((s) => path.endsWith(`/${s.key}`) || (s.key === "review" && path.endsWith("/select")));
  // 이동할 수 있는 단계: 분석 전에는 업로드·처리만, 분석이 끝나면 모든 단계(앞뒤로 자유롭게)
  const stage = w.data?.wedding.stage;
  const prepared = !!stage && !["uploading", "analyzing", "analyze_failed"].includes(stage);
  const reachable = (i: number) => i <= 1 || prepared;

  return (
    <div className="theme-work flex h-screen flex-col bg-bg text-text" data-canvas={canvas}>
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-panel px-3">
        <Link href="/" aria-label="결혼식 목록으로" className="flex h-8 items-center gap-1 rounded-sm px-1.5 text-text-2 hover:text-text">
          <ChevronLeft className="size-4" /><span className="text-sm">목록</span>
        </Link>
        <span aria-hidden className="h-4 w-px bg-line" />
        <span className="max-w-[240px] truncate text-sm font-medium">{w.data?.wedding.title ?? ""}</span>
        <nav aria-label="단계" className="mx-auto hidden items-center gap-5 lg:flex">
          {STEPS.map((s, i) => {
            const cls = cn("relative text-sm", i === current ? "font-medium text-text" : reachable(i) ? "text-text-2 hover:text-text" : "text-text-3");
            const inner = (<><span className="mr-1.5 tnum text-text-3">{i + 1}</span>{s.label}
              {i === current && <span aria-hidden className="absolute -bottom-[13px] left-0 right-0 h-px bg-text" />}</>);
            return reachable(i) && i !== current
              ? <Link key={s.key} href={`/w/${id}/${s.key}`} className={cls} title={`${s.label}(으)로 이동`}>{inner}</Link>
              : <span key={s.key} aria-current={i === current ? "step" : undefined} className={cls}>{inner}</span>;
          })}
        </nav>
        <div className="ml-auto flex items-center gap-0.5" role="radiogroup" aria-label="사진 뒤 배경">
          <span className="mr-1.5 text-xs text-text-3">배경</span>
          {CANVAS.map((c) => (
            <Tooltip key={c.key}>
              <TooltipTrigger render={
                <button role="radio" aria-checked={canvas === c.key} aria-label={c.label} onClick={() => set({ canvas: c.key })}
                  className="grid size-7 place-items-center rounded-sm hover:bg-raised">
                  <span className={cn("size-3.5 rounded-[2px]", canvas === c.key ? "ring-1 ring-text ring-offset-2 ring-offset-panel" : "ring-1 ring-line-strong")} style={{ background: c.swatch }} />
                </button>
              } />
              <TooltipContent>사진 뒤: {c.label}</TooltipContent>
            </Tooltip>
          ))}
          <span aria-hidden className="mx-2 h-4 w-px bg-line" />
          <button onClick={() => setHelp(true)} aria-label="단축키 표 (?)" className="flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-xs text-text-2 hover:text-text">
            단축키 <Kbd>?</Kbd>
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">{current >= 2 && stage && !prepared ? <NotReady id={id} stage={stage} /> : current >= 2 && !stage ? null : children}</div>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="theme-work rounded-md bg-popover text-text sm:max-w-lg">
          <DialogHeader><DialogTitle>단축키</DialogTitle></DialogHeader>
          <div className="mt-2 grid gap-5 sm:grid-cols-2">
            {SHORTCUTS.map((g) => (
              <section key={g.group}>
                <h3 className="mb-2 border-b border-line pb-1.5 text-xs font-semibold text-text-3">{g.group}</h3>
                <ul className="space-y-1.5">
                  {g.items.map(([keys, label]) => (
                    <li key={label} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-text-2">{label}</span>
                      <span className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="mt-4 text-xs text-text-3">한글 입력 상태에서도 동작해요.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 처리가 끝나기 전에 기준 컷~필터 주소로 들어왔을 때(2026-11-24 페르소나 4차: '0 / 0' 빈 화면) */
function NotReady({ id, stage }: { id: string; stage: string }) {
  const where = stage === "uploading" ? { href: `/w/${id}/upload`, label: "업로드 화면으로", text: "사진을 다 올리고 처리를 시작하면 열려요." }
    : { href: `/w/${id}/processing`, label: "처리 화면으로", text: stage === "analyze_failed" ? "사진 처리에 실패했어요. 처리 화면에서 다시 시도해 주세요." : "사진을 처리하는 중이에요. 끝나면 열려요." };
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="text-lg font-semibold">아직 열 수 없는 단계예요</p>
        <p className="mt-2 text-sm text-text-2">{where.text}</p>
        <Link href={where.href} className="mt-5 inline-flex h-10 items-center rounded-xl bg-raised px-4 text-sm font-medium hover:bg-line">{where.label} →</Link>
      </div>
    </div>
  );
}

/** 보정 화면은 데스크톱 전용(색 판단). 좁은 화면에서는 안내 */
export function DesktopOnly({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="grid h-full place-items-center p-8 text-center lg:hidden">
        <div><p className="text-lg font-semibold">보정은 컴퓨터 화면에서 해 주세요</p>
          <p className="mt-2 text-sm text-text-2">색을 정확히 보려면 큰 화면이 필요해요. 진행 상황은 휴대폰에서도 볼 수 있어요.</p></div>
      </div>
      <div className="hidden h-full lg:block">{children}</div>
    </>
  );
}

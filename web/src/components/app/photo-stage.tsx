"use client";
// 사진 무대: 캔버스(작가가 고른 회색) 위에 사진. Space 누르는 동안 원본, Z로 100% 확대. 사진 위에 색을 덮지 않는다(DESIGN.md 2절).
import { useEffect, useState } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import { cn } from "cn";

export function useHoldSpace() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e)) return;
      e.preventDefault(); setHeld(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setHeld(false); };
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  return held;
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) && (t as HTMLInputElement).type !== "range";
}

function ZoomKeys() {
  const { resetTransform, zoomIn } = useControls();
  const [z, setZ] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code !== "KeyZ" || e.metaKey || e.ctrlKey || isTyping(e)) return;
      if (z) resetTransform(150); else zoomIn(1.5, 150);
      setZ(!z);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [z, resetTransform, zoomIn]);
  return null;
}

export function PhotoStage({ src, beforeSrc, showBefore, label, badge, className, onPick }: {
  src: string | null; beforeSrc?: string | null; showBefore?: boolean; label?: string; badge?: React.ReactNode; className?: string;
  onPick?: (x: number, y: number, shift: boolean) => void;   // 있으면 '찍기' 모드: 사진을 누른 자리(0~1)를 알려 줌(흰색 찍기, Shift면 순백)
}) {
  const cur = showBefore && beforeSrc ? beforeSrc : src;
  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-canvas", className)}>
      <TransformWrapper minScale={1} maxScale={4} doubleClick={{ mode: "toggle", step: 1.5 }} wheel={{ step: 0.15 }}>
        <ZoomKeys />
        <TransformComponent wrapperClass="!h-full !w-full" contentClass="!h-full !w-full">
          {/* 찍기: 확대 라이브러리가 img에 클릭이 닿지 않게 막아 두어서, 감싼 상자에서 받고 사진 안 위치로 바꿈 */}
          <div className={cn("flex h-full w-full items-center justify-center p-6", onPick && "cursor-crosshair")}
            onClick={onPick ? (e) => {
              const im = e.currentTarget.querySelector("img"); if (!im) return;
              const r = im.getBoundingClientRect();
              const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
              if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPick(x, y, e.shiftKey);
            } : undefined}>
          {cur ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cur} alt={label ?? "사진"} draggable={false}
              className="max-h-full max-w-full select-none rounded-[2px] object-contain transition-opacity duration-150" />
          ) : (
            <div className="aspect-[3/2] w-[60%] rounded-[2px] bg-[color-mix(in_oklch,var(--canvas),white_6%)]" />
          )}
          </div>
        </TransformComponent>
      </TransformWrapper>
      {showBefore && <span className="pointer-events-none absolute left-4 top-4 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">원본</span>}
      {badge && <div className="pointer-events-none absolute right-4 top-4">{badge}</div>}
    </div>
  );
}

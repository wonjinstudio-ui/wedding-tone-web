"use client";
// 얼굴 확대: 사진의 주인공 얼굴 둘레만 크게(흔들림·초점 판단용). 서버가 준 얼굴 상자(0~1 비율)로 잘라 보여 줌.
import { useState } from "react";
import type { Box } from "@/lib/api";

export function FaceZoom({ src, box, label }: { src: string; box: Box | null; label?: string }) {
  const [aspect, setAspect] = useState<number | null>(null);   // 가로/세로
  if (!box) return <div className="grid aspect-square w-full place-items-center rounded-md bg-raised text-xs text-text-3">얼굴 없음</div>;
  const [x0, y0, x1, y1] = box;
  const ar = aspect ?? 1.5;
  // 얼굴 둘레 60% 여유를 둔 정사각형(그림 비율 고려)
  const fw = x1 - x0, fh = (y1 - y0) / ar;                 // 세로를 가로 단위로
  const side = Math.max(fw, fh) * 1.6;                      // 가로 비율 단위
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const left = cx - side / 2, top = cy - (side * ar) / 2;   // top은 세로 비율 단위
  const scale = 1 / side;                                   // 보이는 칸 = 그림 폭 × side
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-md bg-raised" aria-label={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" draggable={false} onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        className="absolute max-w-none select-none"
        style={{ width: `${scale * 100}%`, left: `${-left * scale * 100}%`, top: `${-top * scale * 100 / ar}%` }} />
    </div>
  );
}

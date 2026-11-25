"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api, ApiError, type AccountPrefs, type LookAdj, type LookSpec, type SkinTone, type Wedding } from "./api";
export type { LookAdj } from "./api";

export const ZONE_COLORS = ["#f2a541", "#e86f5c", "#5b9bd5", "#7cc4a4", "#b38fdc", "#d9c45a"];
export const zoneColor = (z: number) => ZONE_COLORS[z % ZONE_COLORS.length];

/** 로그인 안 했으면 /login 으로 */
export function useMe() {
  const router = useRouter();
  const q = useQuery({ queryKey: ["me"], queryFn: api.me });
  useEffect(() => { if (q.error instanceof ApiError && q.error.status === 401) router.replace("/login"); }, [q.error, router]);
  return q;
}

/** 결혼식 상세. 작업이 돌고 있으면 1.5초마다 다시 읽음 */
export function useWedding(id: string) {
  const router = useRouter();
  const q = useQuery({
    queryKey: ["wedding", id],
    queryFn: () => api.wedding(id),
    refetchInterval: (query) => (query.state.data?.wedding.job && ["queued", "running"].includes(query.state.data.wedding.job.state) ? 1500 : false),
  });
  useEffect(() => {
    if (q.error instanceof ApiError && q.error.status === 401) router.replace("/login");
    if (q.error instanceof ApiError && q.error.status === 404) router.replace("/");
  }, [q.error, router]);
  return q;
}

/** 단계에 맞는 화면 주소 */
export function stagePath(w: Wedding): string {
  const base = `/w/${w.id}`;
  switch (w.stage) {
    case "uploading": return `${base}/upload`;
    case "analyzing": case "analyze_failed": return `${base}/processing`;
    case "exporting": case "exported": return `${base}/download`;
    case "learning": return `${base}/review`;
    default: {
      const next = w.progress?.next;
      if (next === "기준 컷 보정") return `${base}/reference`;
      if (next === "손보정" || next === "학습(learn)") return `${base}/fixes`;
      return `${base}/review`;
    }
  }
}

// 작업 화면 설정(이 브라우저에만 저장 — 화면 배경·힌트처럼 기기마다 달라도 되는 것만)
type Prefs = { canvas: "dark" | "mid" | "light"; hintSeen: number;
  set: (p: Partial<Omit<Prefs, "set">>) => void };
export const usePrefs = create<Prefs>()(persist((set) => ({
  canvas: "dark", hintSeen: 0, set: (p) => set(p),
}), { name: "wt-prefs" }));

// 작가 설정(계정에 저장 — 2026-11-23: 예전엔 브라우저에 저장돼 다른 컴퓨터에선 사라지고 같은 컴퓨터의 다른 작가에게 보였음)
// 화면은 바로 바뀌고(캐시), 서버 저장은 손을 뗀 뒤 0.4초에 한 번.
let pending: Partial<AccountPrefs> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const EMPTY: AccountPrefs = { look: null, lookAdj: {} };
export function useAccountPrefs() {
  const qc = useQueryClient();
  // 창을 다시 볼 때 자동으로 다시 불러오지 않음: 아직 저장 전인 화면 값을 서버의 옛 값이 덮어 한 칸 되돌아가던 문제(2026-11-24)
  const q = useQuery({ queryKey: ["prefs"], queryFn: api.prefs, staleTime: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const prefs = q.data?.prefs ?? EMPTY;
  // p를 함수로 주면 '지금 값'에서 계산(키를 빠르게 여러 번 눌러도 한 번도 빠지지 않게)
  const set = (pOrFn: Partial<AccountPrefs> | ((cur: AccountPrefs) => Partial<AccountPrefs>)) => {
    const cur = qc.getQueryData<{ prefs: AccountPrefs }>(["prefs"])?.prefs ?? EMPTY;
    const p = typeof pOrFn === "function" ? pOrFn(cur) : pOrFn;
    void qc.cancelQueries({ queryKey: ["prefs"] });
    qc.setQueryData(["prefs"], { prefs: { ...cur, ...p } });
    pending = { ...pending, ...p };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const body = pending; pending = {}; saveTimer = null;
      api.savePrefs(body).catch(() => toast.error("설정을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요"));
    }, 400);
  };
  return { look: prefs.look, lookAdj: prefs.lookAdj, skin: prefs.skin ?? null, refStyle: prefs.refStyle ?? null, set, ready: q.isSuccess };
}

/** 고른 필터 + 조정값 + 피부 톤 → 엔진에 보낼 필터. 조정·피부 톤 없으면 이름 그대로. 필터 없이 피부 톤만이면 base: null */
export function lookSpec(look: string | null, lookAdj: Record<string, LookAdj> | undefined, skin?: SkinTone | null): LookSpec {
  const a = look ? lookAdj?.[look] : undefined;
  if (!skin) return !look ? null : a ? { base: look, strength: a.strength, adjust: a.adjust } : look;
  return { base: look, strength: a?.strength ?? 1, adjust: a?.adjust ?? {}, skin };
}

/** 화면에 보이는 피부 톤(엔진 looks.SKIN_TONES와 같은 키) */
export const SKIN_TONES: { key: SkinTone["key"]; name: string; desc: string }[] = [
  { key: "milky", name: "뽀얀 피부", desc: "피부만 살짝 밝고 맑게, 노란기를 덜어 냄" },
  { key: "lively", name: "생기 피부", desc: "복숭아빛 혈색을 살짝(이미 붉으면 덜)" },
  { key: "warm", name: "따뜻한 피부", desc: "창백하거나 푸르게 뜬 피부만 따뜻하게" },
];

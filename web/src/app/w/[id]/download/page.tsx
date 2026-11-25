"use client";
// ⑨ 결제 + ⑩ 다운로드 (밝은 테마). 금액·결과물·보관 기간을 한 화면에 숨김없이. 결제 버튼 위에 전후 비교. DESIGN.md 12절
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Bar, Logo } from "@/components/app/bits";
import { api, ApiError, COPY, fmt, renderUrl, type LookSpec } from "@/lib/api";
import { lookSpec, SKIN_TONES, useAccountPrefs, useMe, useWedding } from "@/lib/hooks";
import { usePreview } from "@/lib/preview";

export default function DownloadPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const me = useMe();
  const wq = useWedding(id);
  const zq = useQuery({ queryKey: ["zones", id], queryFn: () => api.zones(id) });
  const lq = useQuery({ queryKey: ["looks"], queryFn: api.looks });
  const { look, lookAdj, skin } = useAccountPrefs();
  const spec = lookSpec(look, lookAdj, skin);
  const [busy, setBusy] = useState(false);
  const [needPay, setNeedPay] = useState(false);

  const w = wq.data?.wedding;
  // 7차: 마지막 내보내기(진행 중·멈춤·실패일 수 있음)와 마지막으로 '끝난' 내보내기를 따로 봄 → 다시 만들다 멈춰도 이미 만든 ZIP은 그대로
  const exportJob = wq.data?.jobs.find((j) => j.kind === "export");
  const doneJob = wq.data?.jobs.find((j) => j.kind === "export" && j.state === "done");
  const running = exportJob && ["queued", "running"].includes(exportJob.state);
  const done = !!doneJob;
  const stopped = exportJob?.state === "canceled";
  const skinName = skin ? SKIN_TONES.find((t) => t.key === skin.key)?.name : undefined;
  const filterName = look ? (lq.data?.find((l) => l.key === look)?.name ?? look) + (lookAdj?.[look] ? " (조정함)" : "") : skinName ? "" : "필터 없음";
  const lookName = [filterName, skinName].filter(Boolean).join(" + ");
  const freeLeft = me.data?.user.free_weddings_left ?? 0;
  const willUseFree = !w?.paid && freeLeft > 0;
  const refs = zq.data?.slice(0, 2).map((z) => z.ref) ?? [];
  const ready = !!w && !!me.data;   // 계정·결혼식 정보가 오기 전에는 결제 패널을 그리지 않음(체험 작가에게 결제 버튼이 잠깐 보이던 문제)

  // 알림을 허용한 작가에게는 다른 창을 보는 동안 끝났을 때 알려 줌(처리 화면과 같은 방식)
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (done && wasRunning.current) {
      wasRunning.current = false;
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden)
        new Notification("사진을 다 만들었어요", { body: `${w?.title ?? ""} — ZIP을 받을 수 있어요` });
    }
  }, [running, done, w?.title]);

  async function start() {
    setBusy(true);
    try {
      await api.exportZip(id, spec, lookName);
      await qc.invalidateQueries({ queryKey: ["wedding", id] });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (x) {
      if (x instanceof ApiError && x.status === 402) setNeedPay(true);
      else toast.error(x instanceof ApiError ? x.message : "시작하지 못했어요");
    }
    setBusy(false);
  }

  async function pay() {
    setBusy(true);
    try { await api.devPay(id); setNeedPay(false); await qc.invalidateQueries({ queryKey: ["wedding", id] }); await start(); }
    catch (x) { toast.error(x instanceof ApiError && x.status === 404 ? "결제 연결을 준비하고 있어요" : "결제하지 못했어요"); }
    setBusy(false);
  }

  return (
    <div className="theme-light min-h-screen bg-bg">
      <header className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-6">
        <Logo />
        <Link href={`/w/${id}/filter`} className="text-sm text-text-2 hover:text-text">← 필터로 돌아가기</Link>
      </header>
      <main className="mx-auto grid max-w-[1120px] gap-12 px-6 pb-20 pt-6 lg:grid-cols-[1fr_360px]">
        <section>
          <p className="text-sm text-text-3">{w?.title}</p>
          <h1 className="mt-2 font-display text-[34px] leading-tight tracking-[-0.02em]">
            {running ? "사진을 만드는 중이에요" : done ? "다운로드할 수 있어요" : "이대로 내보낼까요"}
          </h1>
          {refs.length > 0 && (
            <div className="mt-8 space-y-8">
              {refs.map((pid) => (
                <figure key={pid}>
                  <ReactCompareSlider className="overflow-hidden rounded-2xl" style={{ aspectRatio: "3 / 2" }}
                    itemOne={<ReactCompareSliderImage src={renderUrl(id, pid, { mode: "before", edge: 1200 })} alt="보정 전" />}
                    itemTwo={<After id={id} pid={pid} spec={spec} />} />
                  <figcaption className="mt-2 flex justify-between text-xs text-text-3"><span>← 카메라 원본</span><span>보정 · {lookName} →</span></figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>

        <aside className="h-fit rounded-3xl bg-panel p-7 shadow-soft lg:sticky lg:top-8">
          <dl className="text-sm">
            <Row k="사진" v={w?.progress ? `${fmt.n(w.progress.photos - (w.progress.excluded ?? 0))}장${w.progress.excluded ? ` (뺀 ${fmt.n(w.progress.excluded)}장 제외)` : ""}` : "-"} />
            <Row k="필터" v={lookName} />
            <Row k="결과물" v="긴 변 2400px JPG" />
            <Row k="파일" v="원본 이름·촬영 날짜 그대로" />
            <Row k="다시 받기" v={w ? `${fmt.date(w.delete_at)}까지` : "-"} />
          </dl>

          <div className="mt-8">
            {running && exportJob ? (
              <>
                <div className="flex items-baseline justify-between text-sm tnum"><span className="text-[22px] font-semibold">{Math.round(exportJob.progress * 100)}%</span><span className="text-text-2">{exportJob.state === "queued" ? "차례를 기다리는 중 · 먼저 맡긴 작업이 끝나면 시작해요" : exportJob.message}</span></div>
                <Bar value={exportJob.progress} className="mt-3" />
                <p className="mt-4 text-sm text-text-2">{COPY.leave}</p>
                <button className="mt-6 text-sm text-text-2 underline underline-offset-4 hover:text-text"
                  onClick={() => api.cancelJob(id, exportJob.id).then(() => qc.invalidateQueries({ queryKey: ["wedding", id] }))}>멈추기</button>
                {doneJob && (
                  <p className="mt-6 border-t border-line pt-4 text-sm text-text-2">
                    먼저 만든 ZIP도 그대로 받을 수 있어요.{" "}
                    <a className="font-medium text-text underline underline-offset-4" href={`/api/weddings/${id}/download/${doneJob.id}`}>{doneJob.look_name ? `${doneJob.look_name} ZIP 받기` : "ZIP 받기"}</a>
                  </p>
                )}
              </>
            ) : done && doneJob ? (
              <>
                {stopped && <p className="mb-4 rounded-xl bg-raised px-4 py-3 text-sm text-text-2">다시 만들기를 멈췄어요. 먼저 만든 ZIP은 그대로 받을 수 있어요.</p>}
                <Button className="h-12 w-full rounded-xl text-[16px]" render={<a href={`/api/weddings/${id}/download/${doneJob.id}`} />} nativeButton={false}>
                  ZIP 받기{doneJob.result && typeof doneJob.result.bytes === "number" ? ` · ${(doneJob.result.bytes / 1e6).toFixed(0)}MB` : ""}
                </Button>
                <p className="mt-3 text-sm text-text-2">{doneJob.look_name ? `${withRo(doneJob.look_name)} 만든 ZIP이에요. ` : ""}{w && `${fmt.date(w.delete_at)}까지 다시 받을 수 있어요.`}</p>
                {doneJob.look_name !== lookName ? (
                  // 필터 화면에서 다른 필터를 고르고 돌아온 경우(예전 작업은 이름 기록이 없어 늘 보임): 고른 필터 이름을 적은 버튼으로 다시 만들기
                  <>
                    <Button variant="secondary" className="mt-6 h-11 w-full rounded-xl text-[15px]" onClick={start} disabled={busy}>
                      {busy ? <Loader2 className="animate-spin" /> : null}{withRo(lookName)} 다시 만들기
                    </Button>
                    <Link className="mt-3 inline-block text-sm text-text-2 underline underline-offset-4 hover:text-text" href={`/w/${id}/filter`}>다른 필터 고르기</Link>
                  </>
                ) : (
                  // 7차: 예전엔 이 버튼이 같은 필터로 바로 다시 만들기를 시작했음 → 필터 화면으로 보냄
                  <Link className="mt-6 inline-block text-sm text-text-2 underline underline-offset-4 hover:text-text" href={`/w/${id}/filter`}>필터를 바꿔 다시 만들기</Link>
                )}
              </>
            ) : w && (["uploading", "analyzing", "analyze_failed"].includes(w.stage) || w.progress?.learned === false) ? (
              <p className="rounded-xl bg-raised px-4 py-3 text-sm text-text-2">
                {w.progress?.learned === false ? "손본 값을 나머지 사진에 옮긴 뒤에 만들 수 있어요. " : "사진 처리가 끝나고 보정을 마친 뒤에 만들 수 있어요. "}
                <Link className="font-medium text-text underline underline-offset-4" href={`/w/${id}/${w.progress?.learned === false ? "fixes" : "processing"}`}>
                  {w.progress?.learned === false ? "손보정 화면으로" : "처리 화면으로"}</Link>
              </p>
            ) : !ready ? (
              <div className="h-12 rounded-xl bg-raised" aria-hidden />
            ) : needPay || (!w?.paid && freeLeft === 0) ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-text-2">결혼식 1건</span>
                  <span className="font-display text-[30px] tnum">{fmt.krw(wq.data?.price_krw ?? 14900)}</span>
                </div>
                {/* TODO(출시 전 결정): 부가세 포함 여부 표기, 환불 정책 링크 — DESIGN.md 2절 6 */}
                <p className="mt-2 text-sm text-text-2">{COPY.payWhen} 결제하면 바로 만들기 시작해요.</p>
                <Button className="mt-6 h-12 w-full rounded-xl text-[16px]" onClick={pay} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : null}결제하고 받기
                </Button>
              </>
            ) : (
              <>
                {stopped && <p className="mb-4 rounded-xl bg-raised px-4 py-3 text-sm text-text-2">만들기를 멈췄어요. 언제든 다시 시작할 수 있어요.</p>}
                {exportJob?.state === "failed" && <p className="mb-4 rounded-xl bg-raised px-4 py-3 text-sm text-danger-fg">{exportJob.error?.split("\n")[0] || "사진을 만들지 못했어요. 다시 시도해 주세요."}</p>}
                {willUseFree && <p className="mb-4 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-deep">{COPY.trial}</p>}
                <Button className="h-12 w-full rounded-xl text-[16px]" onClick={start} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : null}사진 만들기 시작
                </Button>
                <p className="mt-3 text-sm text-text-2">{COPY.leave}</p>
              </>
            )}
          </div>
          <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-text-3">{COPY.retention}</p>
        </aside>
      </main>
    </div>
  );
}

/** '(으)로': 마지막 한글 글자에 받침이 있으면 '으로'(ㄹ 받침은 '로') — "봄날 필름으로", "몽환 글로우로" */
function withRo(name: string) {
  const ch = [...name].reverse().find((c) => c >= "가" && c <= "힣");
  if (!ch) return `${name}로`;
  const jong = (ch.charCodeAt(0) - 0xac00) % 28;
  return `${name}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4 border-b border-line py-3"><dt className="text-text-3">{k}</dt><dd className="text-right font-medium tnum">{v}</dd></div>;
}

/** 보정 후 그림: 조정한 필터도 보이도록 POST 미리보기(오기 전엔 이름만으로 그린 그림) */
function After({ id, pid, spec }: { id: string; pid: number; spec: LookSpec }) {
  const adjusted = !!spec && typeof spec === "object";
  const { url } = usePreview(id, adjusted ? pid : null, { mode: "learn", edge: 1200, look: spec });
  const plain = renderUrl(id, pid, { mode: "learn", edge: 1200, look: typeof spec === "string" ? spec : adjusted ? spec.base : null });
  return <ReactCompareSliderImage src={(adjusted && url) || plain} alt="보정 후" />;
}

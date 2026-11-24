"use client";
// ③ 업로드: 화면 전체가 드롭 영역. 장수·용량·남은 시간, 업로드 중에만 탭 닫기 경고, 실패는 묶어서. DESIGN.md 12절
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Bar } from "@/components/app/bits";
import { FrameStack } from "@/components/app/art";
import { api, ApiError, COPY, fmt } from "@/lib/api";
import { pickJpegs, sameNameCount, uploadAll, type UploadState } from "@/lib/upload";
import { useWedding } from "@/lib/hooks";

export default function UploadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const w = useWedding(id);
  const [st, setSt] = useState<UploadState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState(0);   // 이름이 같아 한 장만 올린 사진 수
  const abort = useRef<AbortController | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const busy = !!st && !st.finished;
  const stopped = !!st && st.finished && st.done + st.failed.length < st.total;   // 멈추기를 눌러 일부만 올라감

  // 업로드 중에만 탭 닫기 경고
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [busy]);
  useEffect(() => { document.title = busy && st ? `(${Math.round((st.done / Math.max(st.total, 1)) * 100)}%) 업로드 중` : "업로드 · 웨딩 톤"; }, [busy, st]);

  async function start(files: File[]) {
    const jpgs = pickJpegs(files);
    setErr(null);
    setDup(sameNameCount(files));
    if (!jpgs.length) { setErr("JPG 사진이 없어요. 카메라 JPG 파일(.jpg)을 골라 주세요."); return; }
    if (jpgs.length > 2500) { setErr(`결혼식 1건은 2,500장까지예요. 지금 ${fmt.n(jpgs.length)}장이에요.`); return; }
    const ac = new AbortController();
    abort.current = ac;
    try {
      const res = await uploadAll(id, jpgs, setSt, ac.signal);
      // 멈추기를 눌렀으면 자동으로 처리 시작하지 않음(일부만 올라간 채 분석이 시작돼 더 올릴 수 없게 되던 문제, 2026-11-23)
      if (res.done > 0 && res.failed.length === 0 && !ac.signal.aborted) await analyze();
      await qc.invalidateQueries({ queryKey: ["wedding", id] });
    } catch (x) { setErr(x instanceof ApiError ? x.message : "업로드를 시작하지 못했어요"); setSt(null); }
  }

  async function analyze() {
    try {
      await api.analyze(id);
      await qc.invalidateQueries({ queryKey: ["wedding", id] });
      router.push(`/w/${id}/processing`);
    } catch (x) { setErr(x instanceof ApiError ? x.message : "처리를 시작하지 못했어요"); }
  }

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (files) => start(files), noClick: true, noKeyboard: true, disabled: busy,
    accept: { "image/jpeg": [".jpg", ".jpeg"] }, useFsAccessApi: false,
  });

  const elapsed = st ? (Date.now() - st.startedAt) / 1000 : 0;
  const sent = st ? st.done - st.skipped : 0;   // 이번에 실제로 올린 장수(건너뛴 것 빼고) — 남은 시간 계산용
  const rate = st && sent > 0 ? sent / elapsed : 0;
  const remain = st && rate > 0 ? Math.max(0, (st.total - st.done - st.failed.length) / rate) : null;
  const already = w.data?.wedding.uploaded ?? 0;
  const planned = w.data?.wedding.planned ?? 0;
  const missing = Math.max(0, planned - already);   // 새로고침·창 닫기로 덜 올라간 장수(6차: 712/1,342장에서 '이대로 처리 시작'만 보였음)
  const [confirmPartial, setConfirmPartial] = useState(false);
  const stg = w.data?.wedding.stage;
  const started = !!stg && stg !== "uploading";   // 처리를 시작한 뒤에는 더 올릴 수 없음(서버도 409) → '이대로 처리 시작' 대신 안내

  return (
    <div {...getRootProps()} className="relative flex h-full items-center px-[12%] py-8">
      <input {...getInputProps()} />
      <input ref={folderInput} type="file" className="hidden" multiple
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => e.target.files && start(Array.from(e.target.files))} />

      {/* 끌어다 놓는 동안 화면 가장자리에 흰 선 하나 */}
      {isDragActive && <div aria-hidden className="pointer-events-none absolute inset-4 rounded-2xl border-2 border-dashed border-text/50 bg-raised/40" />}
      <div className="grid w-full max-w-[1000px] items-center gap-14 md:grid-cols-[1fr_320px]">
        {!st ? (
          <div>
            <p className="text-sm text-text-3">1 · 업로드</p>
            <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.02em]">
              {isDragActive ? "놓으면 올리기 시작해요" : "촬영 폴더를 이 화면에 끌어다 놓으세요"}
            </h1>
            <p className="mt-3 text-md text-text-2">카메라 JPG만 올려요. 브라우저가 긴 변 2400px로 줄이고 촬영 정보는 그대로 붙여서 올려요.</p>
            <div className="mt-8 flex items-center gap-3">
              <Button className="h-11 rounded-xl px-5 text-[15px]" onClick={() => folderInput.current?.click()}>폴더 고르기</Button>
              <Button variant="ghost" className="h-10 px-4 text-[15px] text-text-2" onClick={open}>사진만 고르기</Button>
            </div>
            {started ? (
              <p className="mt-8 border-t border-line pt-4 text-sm text-text-2">
                {fmt.n(already)}장으로 처리를 시작했어요. 처리를 시작한 결혼식에는 사진을 더 올릴 수 없어요.{" "}
                <a className="font-medium text-text underline underline-offset-4" href={`/w/${id}/processing`}>처리 화면으로</a>
              </p>
            ) : already > 0 && missing > 0 ? (
              <div className="mt-8 border-t border-line pt-4 text-sm">
                <p className="text-warn-fg">
                  {fmt.n(planned)}장 중 {fmt.n(already)}장만 올라갔어요. 같은 폴더를 다시 넣으면 나머지 {fmt.n(missing)}장만 이어서 올려요.
                </p>
                {!confirmPartial ? (
                  <button className="mt-2 text-text-3 underline underline-offset-4" onClick={() => setConfirmPartial(true)}>{fmt.n(already)}장만으로 처리 시작</button>
                ) : (
                  <p className="mt-2 text-text-2">
                    처리를 시작하면 빠진 {fmt.n(missing)}장은 더 올릴 수 없어요.{" "}
                    <button className="font-medium text-danger-fg underline underline-offset-4" onClick={analyze}>그래도 {fmt.n(already)}장으로 시작</button>
                    {" · "}
                    <button className="text-text-2 underline underline-offset-4" onClick={() => setConfirmPartial(false)}>취소</button>
                  </p>
                )}
              </div>
            ) : already > 0 && (
              <p className="mt-8 border-t border-line pt-4 text-sm text-text-2">
                {planned > 0 ? `${fmt.n(already)}장 모두 올렸어요.` : `이미 ${fmt.n(already)}장 올렸어요.`}{" "}
                <button className="font-medium text-text underline underline-offset-4" onClick={analyze}>처리 시작</button>
              </p>
            )}
            {err && <p role="alert" className="mt-5 text-sm text-danger-fg">{err}</p>}
          </div>
        ) : (
          <div>
            <p className="text-sm text-text-3">1 · 업로드</p>
            <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.02em]">
              {st.finished ? (stopped ? "올리다 멈췄어요" : st.failed.length ? "몇 장은 확인이 필요해요" : "다 올렸어요") : "올리는 중"}
            </h1>
            <div className="mt-8 flex items-baseline justify-between tnum">
              <span><span className="text-[40px] font-semibold leading-none">{fmt.n(st.done)}</span><span className="ml-2 text-md text-text-3">/ {fmt.n(st.total)}장</span></span>
              <span className="text-sm text-text-2">
                {(st.bytesDone / 1e6).toFixed(0)}MB{!st.finished && remain !== null ? ` · ${remain < 60 ? "1분 안에 끝나요" : `약 ${Math.ceil(remain / 60)}분 남음`}` : ""}
              </span>
            </div>
            <Bar value={(st.done + st.failed.length) / Math.max(st.total, 1)} className="mt-4" />
            {st.skipped > 0 && <p className="mt-4 text-sm text-text-2">이미 올라간 {fmt.n(st.skipped)}장은 건너뛰고 나머지만 올려요.</p>}
            {!st.finished && <p className="mt-4 text-sm text-text-2">업로드가 끝날 때까지 이 창을 열어 두세요. 그다음 처리는 창을 닫아도 계속돼요.</p>}
            {stopped && <p className="mt-4 text-sm text-text-2">같은 폴더를 다시 올리면 이어서 올라가요. 처리를 시작하면 사진을 더 올릴 수 없어요.</p>}
            {dup > 0 && (
              <p className="mt-4 text-sm text-warn-fg">이름이 같은 사진 {fmt.n(dup)}장은 한 장만 올렸어요. 폴더가 달라도 파일 이름이 같으면 한 장으로 봐요 — 카메라 두 대가 같은 번호를 쓰면 한쪽 이름을 바꿔 다시 올려 주세요.</p>
            )}
            {st.noExif > 0 && (
              <p className="mt-4 text-sm text-warn-fg">촬영 정보(EXIF)가 없는 사진 {fmt.n(st.noExif)}장 — 조명 구역에서 빠질 수 있어요.</p>
            )}
            {st.failed.length > 0 && (
              <details className="mt-5 border-t border-line pt-3 text-sm">
                <summary className="cursor-pointer text-danger-fg">{fmt.n(st.failed.length)}장 확인 필요 · 목록 보기</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-text-2">
                  {st.failed.map((f) => <li key={f.name}><span className="text-text">{f.name}</span> — {f.reason}</li>)}
                </ul>
              </details>
            )}
            <div className="mt-8 flex items-center gap-3">
              {busy ? (
                <Button variant="ghost" className="h-10 px-4 text-text-2" onClick={() => abort.current?.abort()}>멈추기</Button>
              ) : (
                <>
                  <Button className="h-10 px-5 text-[15px]" disabled={st.done === 0} onClick={analyze}>
                    {st.failed.length || stopped ? `${fmt.n(st.done)}장으로 처리 시작` : "처리 시작"}
                  </Button>
                  <Button variant="ghost" className="h-10 px-4 text-text-2" onClick={() => setSt(null)}>사진 더 올리기</Button>
                </>
              )}
            </div>
            {err && <p role="alert" className="mt-4 text-sm text-danger-fg">{err}</p>}
          </div>
        )}
        <FrameStack className="hidden max-w-[320px] opacity-90 md:block" />
      </div>
      <p className="absolute bottom-5 left-6 right-6 text-xs text-text-3">{COPY.payWhen} {COPY.retention} {COPY.noTraining}</p>
    </div>
  );
}

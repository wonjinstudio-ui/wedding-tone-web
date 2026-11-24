"use client";
// ② 결혼식 목록 — 바깥 화면(사진가 브랜드). 카드 대신 가는 선으로 나눈 표. DESIGN.md 12절
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bar, Logo, StageText } from "@/components/app/bits";
import { api, ApiError, COPY, fmt, type Wedding } from "@/lib/api";
import { stagePath, useMe } from "@/lib/hooks";
import { FrameStack } from "@/components/app/art";

export default function Home() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const list = useQuery({
    queryKey: ["weddings"], queryFn: api.weddings, enabled: !!me.data,
    refetchInterval: (q) => (q.state.data?.weddings.some((w) => w.job && ["queued", "running"].includes(w.job.state)) ? 2000 : false),
  });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { wedding } = await api.createWedding(title.trim());
      await qc.invalidateQueries({ queryKey: ["weddings"] });
      router.push(`/w/${wedding.id}/upload`);
    } catch (x) { setErr(x instanceof ApiError ? x.message : "만들지 못했어요"); }
  }
  const newWedding = () => { setTitle(""); setErr(null); setOpen(true); };

  const weddings = list.data?.weddings ?? [];
  const loading = list.isLoading || me.isLoading;
  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto flex h-16 max-w-[1040px] items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-5 text-sm text-text-2">
          {me.data && <span className="hidden sm:inline">{me.data.user.email ?? me.data.user.name}</span>}
          <Link href="/account" className="hover:text-text">계정</Link>
          <button className="hover:text-text" onClick={async () => { await api.logout(); qc.clear(); router.replace("/login"); }}>로그아웃</button>
        </nav>
      </header>

      <main className="mx-auto max-w-[1040px] px-6 pb-20 pt-10">
        <div className="flex items-end justify-between gap-6 pb-6">
          <div>
            <h1 className="font-display text-[34px] leading-none tracking-[-0.02em]">결혼식</h1>
            {weddings.length > 0 && <p className="mt-2 text-[15px] text-text-2">진행 중인 결혼식을 이어서 보정하거나 다운로드할 수 있어요.</p>}
          </div>
          {weddings.length > 0 && <Button className="h-11 rounded-xl px-5 text-[15px]" onClick={newWedding}>+ 새 결혼식</Button>}
        </div>

        {loading ? (
          <div className="py-16 text-sm text-text-3">불러오는 중…</div>
        ) : weddings.length === 0 ? (
          <div className="grid items-center gap-10 rounded-3xl bg-panel p-10 shadow-soft md:grid-cols-[1fr_300px]">
            <div>
              <p className="font-display text-[28px] leading-snug">첫 결혼식을 만들어 볼까요?</p>
              <p className="mt-3 max-w-md text-md text-text-2">
                이름을 정하고 촬영 폴더를 끌어다 놓으면 업로드가 시작돼요. {COPY.payWhen}
              </p>
              <Button className="mt-8 h-12 rounded-xl px-6 text-[15px]" onClick={newWedding}>새 결혼식 만들기</Button>
              <dl className="mt-10 grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-text-3">체험</dt><dd className="mt-0.5 text-text">{COPY.trial}</dd></div>
              <div><dt className="text-text-3">보관</dt><dd className="mt-0.5 text-text">{COPY.retention}</dd></div>
              <div><dt className="text-text-3">사진</dt><dd className="mt-0.5 text-text">{COPY.noTraining}</dd></div>
              </dl>
            </div>
            <FrameStack className="mx-auto max-w-[300px]" />
          </div>
        ) : (
          <>
            <ul className="overflow-hidden rounded-2xl bg-panel shadow-soft">{weddings.map((w) => <Row key={w.id} w={w} />)}</ul>
            <p className="mt-8 text-sm text-text-3">{COPY.retention}</p>
          </>
        )}
      </main>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl p-7 sm:max-w-md">
          <form onSubmit={create}>
            <DialogHeader>
              <DialogTitle className="font-display text-[22px] font-normal">새 결혼식</DialogTitle>
              <DialogDescription>알아보기 쉬운 이름이면 돼요. 예: 11/22 김OO·이OO 본식</DialogDescription>
            </DialogHeader>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="결혼식 이름" className="mt-5 h-12 rounded-xl px-4 text-md" maxLength={80} />
            {err && <p role="alert" className="mt-2 text-sm text-danger-fg">{err}</p>}
            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" className="h-10" onClick={() => setOpen(false)}>취소</Button>
              <Button type="submit" className="h-11 rounded-xl px-5">만들고 사진 올리기</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ w }: { w: Wedding }) {
  const days = fmt.daysLeft(w.delete_at);
  const running = w.job && ["queued", "running"].includes(w.job.state);
  const action = { uploading: "올리기", analyzing: "보기", analyze_failed: "다시 시도", editing: "이어서 보정", learning: "보기",
    exporting: "보기", exported: "다운로드", deleting: "" }[w.stage];
  return (
    <li className="border-b border-line last:border-b-0">
      <Link href={stagePath(w)} className="group grid grid-cols-1 gap-1 px-6 py-5 transition-colors hover:bg-raised/60 md:grid-cols-[1fr_170px_100px_100px_110px] md:items-center md:gap-4">
        <span className="min-w-0">
          <span className="block truncate text-[17px] font-semibold">{w.title}</span>
          <span className="mt-0.5 block text-sm text-text-3 tnum">{fmt.date(w.created_at)}</span>
        </span>
        <span>
          <StageText stage={w.stage} progress={w.job?.progress} />
          {running && <Bar value={w.job!.progress} className="mt-2 max-w-[140px]" />}
        </span>
        <span className="text-sm text-text-2 tnum md:text-right">{w.uploaded !== null ? `${fmt.n(w.uploaded)}장` : ""}</span>
        <span className={`text-sm tnum md:text-right ${days <= 3 ? "text-warn-fg" : "text-text-2"}`}>{days}일 남음</span>
        <span className="text-sm font-medium text-text-2 transition-colors group-hover:text-text md:text-right">{action}{action && " →"}</span>
      </Link>
    </li>
  );
}

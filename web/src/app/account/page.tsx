"use client";
// 계정: 내 정보 + 계정 삭제(탈퇴). 2026-11-24 — 개인정보 처리방침의 '탈퇴' 권리를 화면에서 바로 쓸 수 있게
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/app/bits";
import { api, ApiError, fmt } from "@/lib/api";
import { useMe } from "@/lib/hooks";

export default function AccountPage() {
  const me = useMe();
  const u = me.data?.user;
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (!u) return;
    setBusy(true); setErr(null);
    try {
      await api.deleteAccount(u.has_password ? { password: secret } : { confirm: secret });
      // 화면을 새로 불러 로그인 화면으로(캐시를 먼저 비우면 '로그인 필요' 이동이 안내 문구를 덮어썼음)
      window.location.replace("/login?error=" + encodeURIComponent("계정을 지웠어요. 올린 사진과 결과도 곧 모두 지워져요."));
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "지우지 못했어요. 잠시 뒤 다시 시도해 주세요");
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto flex h-16 max-w-[760px] items-center justify-between px-6">
        <Link href="/"><Logo /></Link>
        <Link href="/" className="text-sm text-text-2 hover:text-text">← 결혼식 목록</Link>
      </header>
      <main className="mx-auto max-w-[760px] px-6 pb-20 pt-6">
        <h1 className="font-display text-[30px] tracking-[-0.02em]">계정</h1>
        <dl className="mt-6 text-sm">
          <Row k="이메일" v={u?.email ?? u?.name ?? "-"} />
          <Row k="로그인 방법" v={u ? (u.has_password ? "이메일·비밀번호" : "구글·카카오") : "-"} />
          <Row k="가입일" v={u?.created_at ? fmt.date(u.created_at) : "-"} />
        </dl>
        <p className="mt-6 text-sm text-text-2">
          <Link href="/terms" className="underline underline-offset-4">이용 약관</Link> ·{" "}
          <Link href="/privacy" className="underline underline-offset-4">개인정보 처리방침</Link>
        </p>

        <section className="mt-14 rounded-2xl border border-line p-6">
          <h2 className="text-md font-semibold">계정 삭제</h2>
          <p className="mt-2 text-sm text-text-2">
            계정을 지우면 올린 사진, 만든 결과(ZIP), 내 필터와 설정이 모두 지워지고 되살릴 수 없어요. 원본은 따로 보관해 두세요.
          </p>
          {!open ? (
            <Button variant="ghost" className="mt-4 h-10 px-4 text-danger-fg" onClick={() => { setOpen(true); setSecret(""); setErr(null); }}>계정 삭제…</Button>
          ) : (
            <form onSubmit={remove} className="mt-4 space-y-3">
              <label className="block text-sm text-text-2" htmlFor="secret">
                {u?.has_password ? "확인을 위해 비밀번호를 입력해 주세요" : "확인을 위해 '탈퇴'라고 입력해 주세요"}
              </label>
              <Input id="secret" type={u?.has_password ? "password" : "text"} autoComplete={u?.has_password ? "current-password" : "off"}
                value={secret} onChange={(e) => setSecret(e.target.value)} className="h-11 max-w-sm rounded-xl" />
              {err && <p role="alert" className="text-sm text-danger-fg">{err}</p>}
              <div className="flex gap-3">
                <Button type="submit" variant="destructive" disabled={busy || !secret} className="h-10 px-4">{busy ? "지우는 중…" : "계정과 모든 사진 지우기"}</Button>
                <Button type="button" variant="ghost" className="h-10 px-4" onClick={() => setOpen(false)}>취소</Button>
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4 border-b border-line py-3"><dt className="text-text-3">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;
}

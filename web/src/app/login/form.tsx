"use client";
// ① 가입·로그인 폼. 왼쪽 = 서비스가 하는 일(바탕체 제목 + 세 줄), 오른쪽 = 카카오 → 구글 → 이메일. DESIGN.md 12절
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/app/bits";
import { ToneTiles } from "@/components/app/art";
import { api, ApiError, COPY } from "@/lib/api";

const HOW: [string, string][] = [
  ["조명 구역마다 한 장", "같은 빛에서 찍힌 사진끼리 묶어, 구역마다 기준 컷 한 장만 평소처럼 보정해요."],
  ["손보는 건 40~50장", "엔진이 고른 40~50장을 키보드로 밝기·색만 맞춰요. 몇 분이면 끝나요."],
  ["나머지는 같은 톤으로", "손본 값을 배워 결혼식 전체에 옮기고, 셀렉본 JPG로 돌려 드려요."],
];

export function LoginForm({ hero }: { hero: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);   // 가입할 때만: 이용 약관·개인정보 처리방침 동의(필수)

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (mode === "login") await api.login(email, pw); else await api.signup(email, pw, agree);
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace("/");
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : "잠시 뒤에 다시 시도해 주세요");
    } finally { setBusy(false); }
  }

  return (
    <main className="grid min-h-screen bg-bg lg:grid-cols-[1.1fr_1fr]">
      {/* 왼쪽: 무엇을 해 주는 서비스인가 — 그림으로 */}
      <section className="relative hidden flex-col justify-between overflow-hidden px-14 py-12 lg:flex">
        {hero && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className={hero ? "relative text-white" : ""}><Logo /></div>
        <div className={hero ? "relative max-w-xl text-white" : "max-w-xl"}>
          <h1 className="font-display text-[42px] leading-[1.25] tracking-[-0.02em]">
            결혼식 한 건,<br />같은 톤 같은 밝기로.
          </h1>
          {!hero && (
            <>
              <figure className="mt-10 rounded-2xl bg-panel p-6 shadow-soft">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                  <ToneTiles t={0} cols={3} rows={3} label="찍은 그대로: 사진마다 색과 밝기가 다름" />
                  <span aria-hidden className="text-xl text-text-3">→</span>
                  <ToneTiles t={1} cols={3} rows={3} label="맞춘 뒤: 같은 톤과 밝기" />
                </div>
                <figcaption className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-4 text-center text-sm text-text-2">
                  <span>찍은 그대로</span><span className="w-5" /><span>같은 톤으로</span>
                </figcaption>
              </figure>
              <ol className="mt-8 space-y-4">
                {HOW.map(([t, d], i) => (
                  <li key={t} className="flex gap-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-display text-[15px] text-accent-deep tnum">{i + 1}</span>
                    <span>
                      <span className="block text-md font-semibold">{t}</span>
                      <span className="mt-0.5 block text-[15px] text-text-2">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <p className={hero ? "relative text-sm text-white/80" : "text-sm text-text-3"}>{COPY.noTraining}</p>
      </section>

      {/* 오른쪽: 로그인 */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-[400px] rounded-3xl bg-panel p-8 shadow-soft sm:p-10">
          <Logo className="mb-8 lg:hidden" />
          <h2 className="font-display text-[28px] tracking-[-0.01em]">{mode === "login" ? "웨딩 톤에 오신 걸 환영해요" : "시작해 볼까요"}</h2>
          <p className="mt-2 text-[15px] text-text-2">{COPY.trial}</p>

          <div className="mt-7 space-y-2.5">
            <a href="/api/auth/kakao/start"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FEE500] text-[15px] font-semibold text-black/85 transition hover:brightness-95">
              <KakaoIcon /> 카카오로 계속하기
            </a>
            <a href="/api/auth/google/start"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel text-[15px] font-medium transition hover:bg-raised">
              <GoogleIcon /> Google로 계속하기
            </a>
          </div>

          <p className="mt-3 text-center text-xs text-text-3">
            계속하면 <Link href="/terms" className="underline underline-offset-2">이용 약관</Link>과{" "}
            <Link href="/privacy" className="underline underline-offset-2">개인정보 처리방침</Link>에 동의하는 것으로 봐요.
          </p>

          <div className="my-6 flex items-center gap-3 text-xs text-text-3">
            <span className="h-px flex-1 bg-line" /> 또는 이메일 <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm text-text-2">이메일</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-xl border-line bg-bg px-4 text-md" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw" className="text-sm text-text-2">비밀번호{mode === "signup" && <span className="text-text-3"> · 8자 이상</span>}</Label>
              <Input id="pw" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8}
                value={pw} onChange={(e) => setPw(e.target.value)} className="h-12 rounded-xl border-line bg-bg px-4 text-md" />
            </div>
            {mode === "signup" && (
              <label className="flex items-start gap-2.5 text-sm text-text-2">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-label="이용 약관과 개인정보 처리방침에 동의합니다(필수)" className="mt-0.5 size-4 accent-[var(--text)]" />
                <span>
                  <Link href="/terms" target="_blank" className="font-medium text-text underline underline-offset-2">이용 약관</Link>과{" "}
                  <Link href="/privacy" target="_blank" className="font-medium text-text underline underline-offset-2">개인정보 처리방침</Link>(사진의 국외 서버 처리 포함)에 동의합니다 <span className="text-text-3">(필수)</span>
                </span>
              </label>
            )}
            {err && <p role="alert" className="text-sm text-danger-fg">{err}</p>}
            <Button type="submit" disabled={busy || !email || pw.length < (mode === "signup" ? 8 : 1) || (mode === "signup" && !agree)} className="h-12 w-full rounded-xl text-[15px]">
              {busy ? "잠시만요…" : mode === "login" ? "로그인" : "가입하고 시작하기"}
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-text-2">
            {mode === "login" ? "처음이신가요? " : "이미 계정이 있나요? "}
            <button type="button" className="font-medium text-text underline underline-offset-4"
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(null); }}>
              {mode === "login" ? "이메일로 가입" : "로그인"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

function KakaoIcon() {
  return <svg aria-hidden width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3C6.48 3 2 6.5 2 10.8c0 2.78 1.86 5.22 4.66 6.6-.2.75-.74 2.72-.85 3.14-.13.52.19.51.4.37.17-.11 2.66-1.8 3.74-2.53.66.1 1.34.15 2.05.15 5.52 0 10-3.5 10-7.73C22 6.5 17.52 3 12 3z" /></svg>;
}
function GoogleIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

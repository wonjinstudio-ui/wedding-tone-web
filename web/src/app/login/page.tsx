// ① 가입·로그인 — 바깥 화면(사진가 브랜드). 대표 사진은 public/brand/hero.jpg 가 있을 때만(작가 동의받은 사진).
import fs from "node:fs";
import path from "node:path";
import { Suspense } from "react";
import { LoginForm } from "./form";

export default function LoginPage() {
  const hero = fs.existsSync(path.join(process.cwd(), "public/brand/hero.jpg")) ? "/brand/hero.jpg" : null;
  return <Suspense><LoginForm hero={hero} /></Suspense>;
}

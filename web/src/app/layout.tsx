import type { Metadata } from "next";
import localFont from "next/font/local";
import { Gowun_Batang } from "next/font/google";
import { Providers } from "@/components/app/providers";
import "./globals.css";

// Pretendard Variable 하나만(OFL-1.1). DESIGN.md 5절
const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

// 제목용 바탕체(OFL) — 바깥 화면(로그인·목록·결제)의 큰 제목에만. 보정 화면은 Pretendard만
const gowun = Gowun_Batang({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-gowun", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "웨딩 톤 — 결혼식 전체 톤·밝기 맞추기",
  description: "기준 컷 몇 장과 40~50장만 손보면 결혼식 전체를 그 색으로 맞춰 드려요.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${gowun.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

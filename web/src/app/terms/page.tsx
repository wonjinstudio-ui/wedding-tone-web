// 이용 약관(시험 운영). 로그인 없이 볼 수 있음
import { LegalDoc } from "@/components/app/legal-doc";
import { TERMS, TERMS_VERSION } from "@/content/legal";

export const metadata = { title: "이용 약관 · 웨딩 톤" };
export default function TermsPage() {
  return <LegalDoc md={TERMS} version={TERMS_VERSION} />;
}

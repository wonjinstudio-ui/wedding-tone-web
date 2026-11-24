// 개인정보 처리방침. 로그인 없이 볼 수 있음
import { LegalDoc } from "@/components/app/legal-doc";
import { PRIVACY, TERMS_VERSION } from "@/content/legal";

export const metadata = { title: "개인정보 처리방침 · 웨딩 톤" };
export default function PrivacyPage() {
  return <LegalDoc md={PRIVACY} version={TERMS_VERSION} />;
}

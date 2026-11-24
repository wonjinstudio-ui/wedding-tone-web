"use client";
// 결혼식 주소로 오면 지금 단계 화면으로 보냄
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { stagePath, useWedding } from "@/lib/hooks";

export default function WeddingIndex() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useWedding(id);
  useEffect(() => { if (q.data) router.replace(stagePath(q.data.wedding)); }, [q.data, router]);
  return <div className="min-h-screen bg-bg" />;
}

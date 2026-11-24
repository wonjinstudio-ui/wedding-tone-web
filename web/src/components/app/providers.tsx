"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: (n, e: unknown) => (e as { status?: number })?.status !== 401 && n < 2, refetchOnWindowFocus: false } },
  }));
  const path = usePathname();
  const work = path.startsWith("/w/") && !path.endsWith("/download");
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider delay={400}>{children}</TooltipProvider>
      {/* 알림 상자도 화면 테마 색을 따르게(테마 변수는 감싼 요소에서 물려받음) */}
      <div className={work ? "theme-work" : "theme-light"}><Toaster position="bottom-center" theme={work ? "dark" : "light"} /></div>
    </QueryClientProvider>
  );
}

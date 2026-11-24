// 약관·처리방침 본문을 그리는 아주 작은 마크다운(제목·문단·목록·표·굵게만). 외부 패키지 없이.
import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/app/bits";

function inline(s: string, key: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong> : <span key={`${key}-${i}`}>{p}</span>);
}

function render(md: string): ReactNode[] {
  const lines = md.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("# ")) { out.push(<h1 key={i} className="font-display text-[30px] leading-tight tracking-[-0.02em]">{inline(l.slice(2), `h${i}`)}</h1>); i++; continue; }
    if (l.startsWith("## ")) { out.push(<h2 key={i} className="mt-9 text-lg font-semibold">{inline(l.slice(3), `h${i}`)}</h2>); i++; continue; }
    if (l.startsWith("---")) { out.push(<hr key={i} className="my-8 border-line" />); i++; continue; }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i].trim())) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={`t${i}`} className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr>{head.map((c, j) => <th key={j} className="border-b border-line px-2 py-2 text-left font-medium text-text-2">{inline(c, `th${i}${j}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border-b border-line px-2 py-2 align-top">{inline(c, `td${i}${k}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    if (/^(\d+\.|-) /.test(l.trimStart())) {
      const ordered = /^\d+\./.test(l.trimStart());
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length && /^\s*(\d+\.|-) /.test(lines[i])) {
        const indent = lines[i].length - lines[i].trimStart().length;
        const text = lines[i].trimStart().replace(/^(\d+\.|-) /, "");
        if (indent >= 2 && items.length) items[items.length - 1].sub.push(text); else items.push({ text, sub: [] });
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={`l${i}`} className={`mt-3 space-y-1.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, k) => (
            <li key={k}>{inline(it.text, `li${i}${k}`)}
              {it.sub.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-5 text-text-2">{it.sub.map((s, m) => <li key={m}>{inline(s, `s${i}${k}${m}`)}</li>)}</ul>}
            </li>))}
        </Tag>);
      continue;
    }
    out.push(<p key={i} className="mt-3">{inline(l, `p${i}`)}</p>);
    i++;
  }
  return out;
}

export function LegalDoc({ md, version }: { md: string; version: string }) {
  return (
    <div className="theme-light min-h-screen bg-bg">
      <header className="mx-auto flex h-16 max-w-[760px] items-center justify-between px-6">
        <Link href="/"><Logo /></Link>
        <nav className="flex gap-5 text-sm text-text-2">
          <Link href="/terms" className="hover:text-text">이용 약관</Link>
          <Link href="/privacy" className="hover:text-text">개인정보 처리방침</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-[760px] px-6 pb-20 pt-6 text-[15px] leading-relaxed text-text">
        {render(md)}
        <p className="mt-10 text-xs text-text-3">문서 판: {version}</p>
      </main>
    </div>
  );
}

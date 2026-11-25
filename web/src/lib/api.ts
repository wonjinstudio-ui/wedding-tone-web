// Node API(03_web/server)와 주고받는 함수와 타입. 같은 주소(/api, next.config rewrites)라 쿠키 로그인이 그대로 동작.

export class ApiError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : null;
  if (!r.ok) {
    const { error, ...rest } = (data || {}) as { error?: string };
    throw new ApiError(r.status, error || (r.status === 401 ? "로그인이 필요해요" : "잠시 뒤에 다시 시도해 주세요"), rest);
  }
  return data as T;
}

export type User = { id: string; email: string | null; name: string | null; free_weddings_left: number; created_at?: string; has_password?: boolean };
export type JobView = {
  id: string; kind: "prepare" | "learn" | "export" | "delete"; state: "queued" | "running" | "done" | "failed" | "canceled";
  progress: number; message: string | null; result: Record<string, unknown> | null; error: string | null;
  created_at: string; finished_at: string | null;
  look_name?: string | null;   // 내보내기: 만들 때 고른 필터 이름(ZIP 이름에도 들어감)
};
export type Stage = "uploading" | "analyzing" | "analyze_failed" | "editing" | "learning" | "exporting" | "exported" | "deleting";
export type Wedding = {
  id: string; title: string; paid: boolean; paid_via: string | null; created_at: string; delete_at: string;
  uploaded: number | null; planned?: number | null; stage: Stage; job?: JobView;
  progress?: { photos: number; zones: number; references_saved: number; fix_total: number; fix_done: number; learned: boolean; next: string;
    suspects: number; suspects_undecided: number; excluded: number; select_done: boolean };
};
export type Zone = { zone: number; n: number; cct: number; ref: number; ref_cct: number | null; settings: Settings | null };
export type Settings = { exposure: number; temp: number | null; tint: number; contrast: number; highlights: number; shadows: number; saturation: number;
  sharpen?: number; vignette?: number };
export type FixItem = { id: number; zone: number; ref: number; dx: number; dm: number; dg: number; done: boolean; excluded?: boolean };
export type Photo = { id: number; name: string; time: string; zone: number; is_ref: boolean; fixed: boolean; dx: number | null; excluded: boolean; suspect: boolean };
export type Box = [number, number, number, number];
export type Suspect = { id: number; name: string; reason: string; burst: number[]; best: number | null; face: Box | null; best_face: Box | null; same_person?: boolean; decision: "drop" | "keep" | null };
export type Decision = "drop" | "keep" | null;
export type LookItem = { key: string; name: string; desc: string; builtin: boolean; adjust?: Record<string, number> };
/** 필터: 이름 그대로, 또는 조정한 필터 {base, strength(0~1.5), adjust(화면 값)} — 엔진 looks.resolve */
/** 작가 설정(계정에 저장): 고른 필터 · 필터별 조정값 */
export type LookAdj = { strength: number; adjust: Record<string, number> };
/** 피부 톤(필터와 따로, 겹쳐 씀): 엔진 looks.SKIN_TONES. s는 강도 0~1.5 */
export type SkinTone = { key: "milky" | "lively" | "warm"; s: number };
/** 지난 결혼식 기준 컷의 스타일 값(서버가 기준 컷 저장 때 기록, 2026-11-25 C2) */
export type RefStyle = { wedding: string; title: string; values: Record<"contrast" | "saturation" | "sharpen" | "vignette", number> };
export type AccountPrefs = { look: string | null; lookAdj: Record<string, LookAdj>; skin?: SkinTone | null; refStyle?: RefStyle };
export type LookSpec = string | { base: string | null; strength: number; adjust: Record<string, number>; skin?: SkinTone } | null;

export const api = {
  me: () => req<{ user: User }>("GET", "/api/me"),
  prefs: () => req<{ prefs: AccountPrefs }>("GET", "/api/me/prefs"),
  savePrefs: (p: Partial<AccountPrefs>) => req<{ prefs: AccountPrefs }>("PUT", "/api/me/prefs", p),
  signup: (email: string, password: string, agree: boolean) => req<{ user: User }>("POST", "/api/auth/signup", { email, password, agree }),
  /** 계정 탈퇴: 이메일 가입은 비밀번호, 구글·카카오 가입은 confirm '탈퇴' */
  deleteAccount: (body: { password?: string; confirm?: string }) => req<{ ok: boolean; weddings_deleted: number }>("DELETE", "/api/me", body),
  login: (email: string, password: string) => req<{ user: User }>("POST", "/api/auth/login", { email, password }),
  logout: () => req("POST", "/api/auth/logout"),

  weddings: () => req<{ weddings: Wedding[] }>("GET", "/api/weddings"),
  createWedding: (title: string) => req<{ wedding: Wedding }>("POST", "/api/weddings", { title }),
  wedding: (id: string) => req<{ wedding: Wedding; jobs: JobView[]; can_download: boolean; price_krw: number }>("GET", `/api/weddings/${id}`),
  deleteWedding: (id: string) => req("DELETE", `/api/weddings/${id}`),
  uploadPlan: (id: string, files: { name: string; size: number }[]) =>
    req<{ targets: { name: string; method: string; url: string }[]; skip?: string[] }>("POST", `/api/weddings/${id}/uploads`, { files }),
  analyze: (id: string) => req<{ job: string }>("POST", `/api/weddings/${id}/analyze`),
  learn: (id: string) => req<{ job: string }>("POST", `/api/weddings/${id}/learn`),
  exportZip: (id: string, look: LookSpec, lookName?: string) => req<{ job: string }>("POST", `/api/weddings/${id}/export`, { look, look_name: lookName }),
  job: (id: string, job: string) => req<{ job: JobView }>("GET", `/api/weddings/${id}/jobs/${job}`),
  cancelJob: (id: string, job: string) => req("POST", `/api/weddings/${id}/jobs/${job}/cancel`),
  devPay: (id: string) => req("POST", `/api/weddings/${id}/pay/dev`),

  zones: (id: string) => req<Zone[]>("GET", `/api/weddings/${id}/zones`),
  candidates: (id: string, z: number, n = 12) => req<{ zone: number; current_ref: number; candidates: number[] }>("GET", `/api/weddings/${id}/zones/${z}/candidates?n=${n}`),
  // 화이트 밸런스 스포이트: x,y(0~1)를 흰색으로 만드는 색온도·틴트(저장 안 함)
  /** 화이트 밸런스 스포이트: 기본은 아이보리(드레스) 기준으로 아주 살짝 따뜻하게, pure면 완전한 흰색 */
  pickWhite: (id: string, pid: number, x: number, y: number, pure = false) =>
    req<{ temp: number; tint: number; limited: boolean; clipped: boolean; shaded: boolean; exact: { temp: number; tint: number } }>("POST", `/api/weddings/${id}/photos/${pid}/white`, { x, y, pure }),
  saveReference: (id: string, z: number, settings: Partial<Settings>, refId?: number) =>
    req("PUT", `/api/weddings/${id}/zones/${z}/reference`, { settings, ...(refId !== undefined ? { ref_id: refId } : {}) }),
  fixes: (id: string) => req<{ items: FixItem[]; colors: Record<string, string> }>("GET", `/api/weddings/${id}/fixes`),
  saveFix: (id: string, pid: number, v: { dx: number; dm: number; dg: number }) => req("PUT", `/api/weddings/${id}/fixes/${pid}`, v),
  photos: (id: string, q: { zone?: number; offset?: number; limit?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return req<{ total: number; offset: number; items: Photo[] }>("GET", `/api/weddings/${id}/photos?${p}`);
  },
  looks: () => req<LookItem[]>("GET", "/api/looks"),
  suspects: (id: string) => req<{ items: Suspect[] }>("GET", `/api/weddings/${id}/suspects`),
  decide: (id: string, pid: number, decision: Decision) => req("PUT", `/api/weddings/${id}/decisions/${pid}`, { decision }),
  selectDone: (id: string) => req("POST", `/api/weddings/${id}/select-done`, {}),
};

/** 미리보기 그림 주소(GET). mode: learn | ref | zone0 | before */
export function renderUrl(id: string, pid: number, o: { mode?: string; edge?: number; look?: string | null; dx?: number; dm?: number; dg?: number; v?: string | number } = {}) {
  const p = new URLSearchParams({ mode: o.mode || "learn", edge: String(o.edge || 1600) });
  if (o.look) p.set("look", o.look);
  for (const k of ["dx", "dm", "dg"] as const) if (o[k]) p.set(k, String(o[k]));
  if (o.v !== undefined) p.set("v", String(o.v));                 // 값이 바뀌면 브라우저 캐시를 피하려고
  return `/api/weddings/${id}/photos/${pid}/render?${p}`;
}

/** 슬라이더 값으로 미리보기(POST) → 그림 Blob */
export async function renderWith(id: string, pid: number, body: { settings?: Partial<Settings>; look?: LookSpec; mode?: string; edge?: number; delta?: [number, number, number] }, signal?: AbortSignal) {
  const r = await fetch(`/api/weddings/${id}/photos/${pid}/render`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!r.ok) throw new ApiError(r.status, "미리보기를 만들지 못했어요");
  return r.blob();
}

// ---------- 기능 켜고 끄기 ----------
// 흔들림·초점 의심 보기: 2026-11-24 숨김(페르소나 2차: 17장 중 진짜 3장, 눈물 닦는 신부가 또 잡힘).
// 엔진은 분석 때 계속 재서 결혼식 DB(cull·lite_sharp 표)에 기록만 남김. 판정을 고친 뒤 true로 바꾸면 전체 확인에 버튼이 다시 나옴.
export const FEATURES = { blurSuspects: false } as const;

// ---------- 고정 문구 (DESIGN.md 11절 — 이 문장만 쓰기) ----------
export const COPY = {
  trial: "첫 결혼식 1건은 다운로드까지 무료예요 (최대 2,500장).",
  payWhen: "결제는 다운로드할 때만 해요.",
  retention: "올린 사진과 결과는 14일 뒤 자동으로 지워져요.",
  noTraining: "올린 사진은 다른 작가나 AI 학습에 쓰지 않아요.",
  output: "긴 변 2400px JPG · 원본 파일 이름과 촬영 날짜 그대로.",
  leave: "창을 닫아도 계속돼요. 다시 들어오면 이어서 볼 수 있어요.",   // 알림은 허용한 작가에게만 가므로 약속하지 않음(2026-11-23)
  edge: "과거 보정본 수천 장 없이, 이 결혼식 안에서 바로 배워요.",
} as const;

export const fmt = {
  n: (v: number) => v.toLocaleString("ko-KR"),
  krw: (v: number) => `${v.toLocaleString("ko-KR")}원`,
  signed: (v: number, digits = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(digits),
  daysLeft: (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400e3)),
  date: (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" }),
};

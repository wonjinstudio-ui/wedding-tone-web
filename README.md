# 03 · 웹 서비스

> 계획: [12 웹 SaaS 개발 계획](../12_웹%20SaaS%20개발%20계획.md) · 구조 그림: [13 전체 구조 한눈에](../13_웹%20SaaS%20전체%20구조%20한눈에.md) · 엔진: [02_prototype](../02_prototype/README.md)

> **화면 디자인 규칙: [DESIGN.md](DESIGN.md)** — 웹 화면 코드를 쓰기 전에 먼저 읽기(색·글자·간격 토큰, 키보드, 문구, 점검표).

## 구성 (식당 비유)

| 부분 | 폴더 | 언어 | 하는 일 | 상태 |
|---|---|---|---|---|
| **웹 화면** | `03_web/web` | Next.js 16 + Tailwind v4 + shadcn/ui(Base UI) | 화면 11개(로그인·목록·업로드·처리·기준 컷·손보정·전체 확인(+흔들림 의심 보기)·필터·다운로드) · 어디서나 X로 사진 빼기 · 단계 앞뒤 이동. 2026-11-23: 1차 셀렉은 단계에서 빼고 전체 확인의 선택 화면으로 | ✅ 2026-11-23 |
| **API 서버** (홀 직원·장부) | `03_web/server` | Node(외부 패키지 없음) | 가입·로그인, 결혼식, 업로드 주소, 작업 넣기, 다운로드, 체험/결제 확인, 엔진 API 중계, 14일 자동 삭제 | ✅ 2026-11-23 |
| 엔진 API (음료 담당) | `02_prototype/wsnap/engineapi.py` | Python | 미리보기 한 장, 기준 컷·손보정 저장, 필터 | ✅ |
| 워커 (주방장) | `02_prototype/wsnap/worker.py` | Python | 분석·학습·내보내기·삭제 | ✅ |
| 작업 대기열 (주문표 꽂이) | `jobs` 표 | — | API 서버가 넣고 워커가 꺼냄 | ✅ (개발: SQLite 파일 하나를 셋이 같이 씀) |
| 저장소 (창고) | 폴더 / R2 | — | `uploads/{결혼식}/…`, `results/{결혼식}/{작업}.zip` | ✅ 폴더 · R2는 코드만 |

## 이 컴퓨터에서 넷 다 켜기

웹 화면: `cd 03_web/web && npm run dev -- -p 5173` (API는 `next.config.ts`의 rewrites로 `http://127.0.0.1:8781`에 연결). API 서버는 `PUBLIC_URL=http://localhost:5173 WEB_ORIGIN=http://localhost:5173`로 켜야 업로드 주소가 화면 주소로 나와요. 화면 확인용 가짜 사진: `python devtools/make_fake_photos.py <결혼식 wsnap.db> devdata/fake_photos 80`(픽셀은 그림, 촬영 정보만 실제 원본에서).

### 셋(엔진·워커·API)

데이터 폴더 하나(`$D`)를 셋이 같이 씁니다. 키(`ENGINE_API_KEY`)는 API 서버와 엔진 API가 같아야 해요.

```bash
cd "02_prototype" && ENGINE_API_KEY=devkey .venv/bin/python -m wsnap.engineapi --work-root $D/work --port 8790
```

```bash
cd "02_prototype" && .venv/bin/python -m wsnap.worker run --queue $D/jobs.sqlite --storage $D/storage --work-root $D/work
```

```bash
cd "03_web/server" && DATA_DIR=$D ENGINE_API_KEY=devkey DEV_PAYMENTS=1 node src/server.js
```

시험: `npm test`(API 서버만, 가짜 엔진·가짜 구글) · `node scripts/e2e.mjs http://127.0.0.1:8781 <2400px JPG 폴더>`(셋 다 켠 상태에서 처음부터 끝까지).

## API 서버 주소 (`/api`)

| 주소 | 하는 일 |
|---|---|
| `POST /auth/signup` `POST /auth/login` `POST /auth/logout` `GET /me` | 이메일 가입·로그인(쿠키 또는 `Authorization: Bearer`) |
| `GET /auth/google/start` · `/auth/kakao/start` → `…/callback` | 구글·카카오 로그인(키를 받으면 동작 — 아래) |
| `GET /weddings` `POST /weddings` `GET /weddings/:id` `DELETE /weddings/:id` | 결혼식 목록·만들기·상세(단계·진행률·작업 목록)·삭제 |
| `POST /weddings/:id/uploads` → `PUT /weddings/:id/files/:name` | 올릴 주소 받기 → 올리기(운영은 R2로 바로) |
| `POST /weddings/:id/analyze` · `/learn` · `/export` | 작업 넣기(분석·학습·내보내기). 내보내기는 체험 1건 무료, 그다음은 결제(402) |
| `GET /weddings/:id/jobs/:job` · `POST …/cancel` | 진행률·취소 |
| `GET /weddings/:id/download/:job` | ZIP 받기(운영은 R2 임시 주소로 넘김) |
| `GET/PUT /weddings/:id/zones…` `GET/PUT …/fixes…` `GET …/photos` `GET/POST …/photos/:pid/render` | 보정 화면 → 엔진 API로 중계(내 결혼식만, 작업 중에는 쓰기 막음) |
| `GET /looks` `PUT/DELETE /looks/:name` `POST /looks/import-xmp` | 내 필터, Lightroom 프리셋 불러오기 |
| `POST /weddings/:id/pay/dev` | 개발용 '결제 완료'(`DEV_PAYMENTS=1`일 때만) |

## 숨겨 둔 기능

- **흔들림·초점 의심 보기**(2026-11-24): 판정이 자주 틀려(17장 중 진짜 3장) 화면에서 숨김. 엔진은 분석 때 계속 재서 결혼식 DB(`cull`·`lite_sharp` 표)에 기록함. `web/src/lib/api.ts`의 `FEATURES.blurSuspects`를 `true`로 바꾸면 전체 확인 화면에 버튼이 다시 나옴. API(`/suspects`, `/decisions`)는 그대로 있음.

## 아직 안 한 것

- **결제(토스페이먼츠)**: 지금은 개발용 결제 버튼뿐. 사업자 등록·PG 심사 뒤 결제창 + 웹훅으로 `payments`·`weddings.paid`를 채우면 됨.
- **운영 DB(PostgreSQL)**: `src/db.js`만 바꾸면 되게 SQL을 모아 둠. 이 컴퓨터에 PostgreSQL이 없어 미실행.
- **R2**: 미리 서명 주소(AWS 서명 v4)는 공개 예제 값과 일치 확인, 실제 R2 버킷으로는 미실행.
- **구글·카카오**: 코드와 흐름은 가짜 구글 서버로 확인. 실제로 쓰려면 각 개발자 콘솔에 앱 등록 → `GOOGLE_CLIENT_ID/SECRET`, `KAKAO_CLIENT_ID/SECRET` 환경 변수, 돌아올 주소 `{PUBLIC_URL}/api/auth/{google|kakao}/callback` 등록. 카카오 이메일은 '비즈 앱' 검수가 있어야 받을 수 있음.
- 비밀번호 찾기·이메일 인증, 구독 요금제(월 N건), 서버 여러 대일 때 로그인 시도 제한 공유.

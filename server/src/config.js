// 설정: 모두 환경 변수. 개발 기본값은 이 컴퓨터에서 바로 돌도록.
import path from 'node:path';

const env = process.env;
const root = path.resolve(import.meta.dirname, '..');
const dataDir = env.DATA_DIR || path.join(root, 'data');

export const config = {
  port: Number(env.PORT || 8781),
  host: env.HOST || '127.0.0.1',
  prod: env.NODE_ENV === 'production',
  // 웹 화면 주소(쿠키·CORS·로그인 후 돌아갈 곳)
  webOrigin: env.WEB_ORIGIN || 'http://localhost:5173',
  publicUrl: env.PUBLIC_URL || `http://localhost:${env.PORT || 8781}`,

  appDb: env.APP_DB || path.join(dataDir, 'app.sqlite'),       // 계정·결혼식·결제
  jobsDb: env.JOBS_DB || path.join(dataDir, 'jobs.sqlite'),    // 워커와 같이 쓰는 작업 대기열(wsnap/jobs.py와 같은 표)
  storageDir: env.STORAGE_DIR || path.join(dataDir, 'storage'), // 개발용 저장소(운영은 R2)
  r2: env.R2_BUCKET ? {
    bucket: env.R2_BUCKET, accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  } : null,

  engineUrl: env.ENGINE_URL || 'http://127.0.0.1:8790',
  engineKey: env.ENGINE_API_KEY || '',

  // 계정
  sessionDays: Number(env.SESSION_DAYS || 30),
  google: env.GOOGLE_CLIENT_ID ? {
    clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    userUrl: env.GOOGLE_USER_URL || 'https://openidconnect.googleapis.com/v1/userinfo',
  } : null,
  kakao: env.KAKAO_CLIENT_ID ? {
    clientId: env.KAKAO_CLIENT_ID, clientSecret: env.KAKAO_CLIENT_SECRET || '',
    authUrl: env.KAKAO_AUTH_URL || 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: env.KAKAO_TOKEN_URL || 'https://kauth.kakao.com/oauth/token',
    userUrl: env.KAKAO_USER_URL || 'https://kapi.kakao.com/v2/user/me',
  } : null,

  // 서비스 규칙(12번 계획)
  freeWeddings: Number(env.FREE_WEDDINGS || 1),     // 체험: 첫 결혼식 다운로드까지 무료
  pricePerWeddingKrw: Number(env.PRICE_KRW || 14900),
  maxPhotos: Number(env.MAX_PHOTOS || 2500),
  maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024),  // 2400px JPG 한 장 상한
  retentionDays: Number(env.RETENTION_DAYS || 14),
  termsVersion: env.TERMS_VERSION || '2026-11-trial',   // 약관·처리방침을 바꾸면 올림
  trustProxy: env.TRUST_PROXY === '1',              // 운영: Caddy 뒤에서 실제 접속 IP를 X-Forwarded-For로 받음
  devPayments: env.DEV_PAYMENTS === '1',            // 개발용 '결제 완료' 버튼 허용(운영에서는 끔)
};

# 줌 실시간 자동 출석 (Vercel + Zoom Webhook)

줌에 누가 들어오고 나가는지 **실시간으로 받아서**, 등록 명단과 자동 대조해 미참석자를 표시하는 시스템입니다.
붙여넣기 없이 4초마다 자동 갱신됩니다.

```
브라우저(대시보드)  ←(4초마다)──  /api/status  ──  Upstash Redis
                                                        ▲
                              줌 참가자 입·퇴장 ──→ /api/zoom-webhook
```

준비물: **Vercel 계정 · Zoom Pro 이상 · (무료) Upstash Redis**

---

## 1단계 — Upstash Redis 만들기 (무료, 1분)

방법 A) Vercel 안에서: Vercel 프로젝트 → **Storage** 탭 → **Create / Marketplace** → **Upstash (Redis)** 선택 → 생성.
→ 환경변수 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 이 자동으로 추가됩니다. (3단계 건너뛰어도 됨)

방법 B) 직접: https://upstash.com 가입 → **Create Database**(Region은 가까운 곳) → 화면의 **REST URL**과 **REST TOKEN** 값을 복사해 둡니다.

---

## 2단계 — Vercel에 배포

방법 A) **GitHub**: 이 폴더를 GitHub 저장소에 올린 뒤, Vercel → **Add New → Project → Import** 로 가져오기.

방법 B) **CLI**: 이 폴더에서
```bash
npm i -g vercel
vercel        # 안내에 따라 배포
vercel --prod # 정식(Production) 배포
```

배포가 끝나면 주소가 생깁니다. 예: `https://your-app.vercel.app`

---

## 3단계 — 환경변수 설정

Vercel → 프로젝트 → **Settings → Environment Variables** 에 추가 (방법 A로 Upstash를 추가했다면 Redis 두 개는 이미 있음):

| 이름 | 값 |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST TOKEN |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | (4단계에서 발급 — 일단 비워두고 나중에) |
| `DASHBOARD_TOKEN` | (선택) 아무 비밀문자열. 참가자 명단을 외부에 숨기고 싶을 때 |

환경변수를 바꾼 뒤에는 **Deployments → 점 3개 → Redeploy** 로 다시 배포해야 적용됩니다.

---

## 4단계 — 줌 앱(Server-to-Server OAuth) 만들고 웹훅 연결

1. https://marketplace.zoom.us → 로그인 → **Develop → Build App**
2. **Server-to-Server OAuth** 선택, 앱 이름 입력 후 생성. (일반 "OAuth"가 아니라 **Server-to-Server OAuth**)
3. **Feature → Event Subscription** 켜기 → **Add New Event Subscription**
   - **Event notification endpoint URL** 에 입력:
     `https://your-app.vercel.app/api/zoom-webhook`
   - **Add Events** 에서 다음 4개 선택:
     - Meeting → **Participant/Host joined meeting**
     - Meeting → **Participant/Host left meeting**
     - Meeting → **Start Meeting** (선택, 권장)
     - Meeting → **End Meeting** (선택, 권장)
4. 그 화면에 표시되는 **Secret Token** 을 복사 → Vercel의 `ZOOM_WEBHOOK_SECRET_TOKEN` 에 넣고 **Redeploy**.
5. 다시 줌 화면에서 endpoint URL 옆 **Validate** 클릭 → `validated` 가 뜨면 성공. **Save**.
6. **Scopes** 탭에서 위 이벤트에 필요한 권한이 자동 안내되면 추가 후 저장. 필요 시 **Activation** 에서 앱을 활성화합니다.

> 참고: 참가자 입·퇴장 웹훅은 보통 **Pro 등급 이상**의 유료 줌 계정에서 동작합니다.

---

## 5단계 — 사용

1. `https://your-app.vercel.app` 접속
2. ⚙️ **연결 설정** 에서 **줌 회의 ID**(링크 `/j/` 뒤 숫자, 예: `7561927819`) 입력 → 저장 및 연결. `DASHBOARD_TOKEN`을 설정했다면 같은 값도 입력.
3. **등록 명단** 에 수강생 이름을 한 줄에 한 명씩 붙여넣기 → 명단 적용
4. 줌 회의를 시작하면 우측 상단이 **실시간 연결됨** 으로 바뀌고, 접속자가 자동으로 잡힙니다.
   - **실시간 미참석자**: 지금 줌에 없는 등록자 (수업 중 독려용)
   - **명단 외 접속자**: 명단에 없는 접속자 (이름 다름/외부인)
5. 09:00 / 점심 후 / 마지막에 각 차수의 **'지금 출석 확정'** 을 누르면 그 순간 접속자가 출석으로 저장됩니다.
6. 끝나면 **CSV 내보내기**.

---

## 자주 막히는 부분

- **`validated` 가 안 뜸**: `ZOOM_WEBHOOK_SECRET_TOKEN` 을 넣고 **Redeploy** 했는지 확인. URL 끝이 `/api/zoom-webhook` 인지 확인.
- **연결 오류 / 접속자 0명**: Redis 환경변수 2개가 있는지, Redeploy 했는지 확인. 줌 회의가 **시작**되어 있어야 입·퇴장 이벤트가 옵니다.
- **이름이 '명단 외'로 빠짐**: 줌 표시 이름이 명단과 다르기 때문. 종합 표에서 해당 칸을 눌러 수동 처리하거나, 수강생에게 줌 이름을 실명으로 바꾸도록 안내.
- **회의 ID**: 매번 같은 개인회의(PMI)를 쓰면 그대로 두면 됩니다. 다른 회의를 쓰면 그 회의 ID로 바꾸세요.

비용: Vercel 무료 + Upstash 무료 티어로 충분합니다(소규모 교육 기준). 줌만 Pro 이상.

---

# (선택) 음성 안내 발송 추가하기 — 솔라피(Solapi)

미참석자에게 **자동으로 전화를 걸어 음성 안내(TTS)** 를 보내는 기능입니다. 대시보드에 이미 포함되어 있고, 아래 설정만 하면 켜집니다. **건당 약 250원이 실제로 과금**됩니다.

## 솔라피 준비 (직접 해야 하는 부분)
1. https://solapi.com 가입
2. **발신번호 등록·인증** (본인 휴대폰 010이면 문자인증 2분) — 등록 안 하면 발송 불가(법규)
3. **충전** — 테스트 몇 통은 보유 포인트로 가능. 10명 ≈ 3천원, 100명 ≈ 2~3만원
4. 콘솔 → **개발(<>) → API Key 관리 → 생성**
   - IP 제한은 반드시 **"모든 IP 허용"** (Vercel 서버 IP가 수시로 바뀌므로)
   - 나오는 **API Key**와 **API Secret** 을 안전하게 복사 (이 화면에서만 보임)

## Vercel 환경변수 3개 추가
프로젝트 → **Settings → Environment Variables**:

| 이름 | 값 |
|---|---|
| `SOLAPI_API_KEY` | 솔라피 API Key |
| `SOLAPI_API_SECRET` | 솔라피 API Secret |
| `ADMIN_KEY` | 직접 정하는 발송 비밀번호 (대시보드에서 입력) |

추가 후 **Deployments → ⋯ → Redeploy** (적용).

## 사용법
1. 대시보드 **등록 명단** 에 이름과 함께 **전화번호**도 적기 — 예: `홍길동 010-1234-5678`
   (이름만 적으면 출석 체크만 되고 전화는 못 보냅니다)
2. 맨 아래 **📞 음성 안내 발송** 패널에서:
   - **관리자 키**: 위에서 정한 `ADMIN_KEY` 입력
   - **발신번호**: 솔라피에 등록한 번호
   - **음성 문구**: 그대로 두거나 차수·일정에 맞게 수정
   - **발송 대상**: `실시간 미참석자` / `등록 명단 전체` / `직접 입력(테스트)` 중 선택
3. **미리보기(비용 확인)** 로 인원·예상 비용 확인 → **📞 전화 발송** (확인 창에서 한 번 더 확인)

## 처음엔 테스트부터
`직접 입력(테스트)` 에 **본인 번호 1개**만 넣고 발송 → 실제 전화·음성 확인 후 사용하세요.

## 안전장치
- 발송은 **관리자 키가 맞아야만** 동작 (돈이 나가는 기능 보호)
- 한 번에 최대 200명 제한, 발송 전 **"정말 N명에게 발송?"** 확인
- ⚠️ `ADMIN_KEY` 와 API Key/Secret 은 외부에 노출되지 않게 관리하세요. 솔라피 키는 코드가 아니라 **Vercel 환경변수**에만 둡니다.

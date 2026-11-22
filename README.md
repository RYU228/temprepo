# AI 오피스

AI 에이전트를 직원으로 두고 부서를 만들어 운영하는 웹 기반 **가상 사무실**입니다.
2D 픽셀 사무실 지도에서 부서(방)와 직원(캐릭터)이 보이고, 업무를 지시하면 AI 직원들이 실제로 일하는 모습이 실시간으로 표시됩니다.

## 업무가 처리되는 방식

1. **대표(나)** 가 부서에 업무를 지시합니다.
2. **팀장 에이전트** 가 업무를 분석해 팀원별로 나눠 배정합니다. (구조화된 JSON 출력)
3. **팀원 에이전트** 들이 각자 맡은 부분을 동시에 작성합니다. 결과는 스트리밍으로 실시간 표시됩니다.
4. **팀장** 이 팀원들의 결과물을 종합해 최종 보고서를 올립니다.

지도에서는 상태에 따라 캐릭터가 움직입니다. 대기 중에는 돌아다니고, 일할 때는 자리에 앉아 모니터가 켜지며, 작업을 끝낸 팀원은 회의 테이블로 모입니다.
부서마다 업무는 한 번에 하나씩 진행되고, 나머지는 대기열에서 순서대로 처리됩니다.

## 기능

- 부서 생성/수정/삭제 (방 색상 지정, 지도에서 빈 방을 눌러 바로 생성)
- AI 직원 채용/수정/부서 이동/내보내기, 팀장 지정, 성격·전문성(프롬프트) 설정
- 업무 지시, 진행 과정 실시간 확인, 최종 결과 열람·복사
- 조직도 트리, 상태 표시, 여러 브라우저 간 실시간 동기화 (SSE)
- 데이터는 SQLite 파일(`data/office.db`)에 저장

## 실행

Node.js 22.13 이상이 필요합니다 (내장 `node:sqlite` 사용).

```bash
npm install
```

API 키 없이 실행하면 **데모 모드**로 동작합니다(가짜 응답으로 화면과 흐름만 확인).
실제 Claude가 일하게 하려면 키를 설정합니다.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npm run dev
```

브라우저에서 http://localhost:5173 을 엽니다.

### 배포용 실행

```bash
npm run build
```

```bash
npm start
```

http://localhost:3001 에서 빌드된 화면과 API를 함께 제공합니다.

### 환경 변수

| 변수 | 설명 | 기본값 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API 키. 없으면 데모 모드 | - |
| `CLAUDE_MODEL` | 사용할 모델 | `claude-opus-5-5` |
| `DEMO_MODE` | `1`이면 키가 있어도 데모 모드 | - |
| `PORT` | 서버 포트 | `3001` |
| `HOST` | 서버가 받을 주소 (배포 시 `127.0.0.1`) | `0.0.0.0` |

## 서버 배포 (오라클 클라우드 Ubuntu)

서버에 SSH로 접속한 뒤 실행합니다.

```bash
git clone https://github.com/RYU228/temprepo ~/ai-office
```

```bash
bash ~/ai-office/deploy/setup.sh
```

스크립트가 Node.js, nginx, 자동 실행 서비스, 접속 비밀번호, 서버 방화벽(80번)을 설정합니다.
오라클 콘솔의 Security List에서도 80번 포트를 열어야 외부에서 접속됩니다.

- API 키 설정: `sudo nano /etc/ai-office.env` 에서 `ANTHROPIC_API_KEY=` 뒤에 키를 넣고 `sudo systemctl restart ai-office`
- 코드 업데이트: `bash ~/ai-office/deploy/update.sh`
- 로그 확인: `sudo journalctl -u ai-office -f`
- 비밀번호 변경: `sudo htpasswd /etc/nginx/.ai-office-htpasswd <아이디>`

도메인 없이 IP로 접속하면 HTTP라서 비밀번호가 암호화되지 않고 전송됩니다. 중요한 서비스로 쓰려면 HTTPS를 붙이세요.

## 구조

```
server/
  index.ts         REST API (부서·직원·업무) + 정적 파일 제공
  orchestrator.ts  팀장 배분 → 팀원 병렬 작업 → 팀장 종합, 부서별 대기열
  llm.ts           Claude API 호출 (구조화 출력, 스트리밍) + 데모 모드
  events.ts        실시간 이벤트(SSE) 브로드캐스트
  db.ts            SQLite 스키마, 초기 데이터
src/
  office/          캔버스 기반 2D 사무실 (배치 계산, 캐릭터 이동/렌더링)
  Panels.tsx       조직도, 업무 목록, 폼, 업무 상세
  api.ts           API 클라이언트와 실시간 상태 훅
```

## 참고

- 거절(refusal) 응답이 나오면 서버 측 fallback으로 다른 모델이 이어서 처리하도록 설정되어 있습니다.
- 인증 기능은 없습니다. 외부에 공개하려면 로그인을 먼저 추가하세요.
- 초기 데이터로 돌아가려면 서버를 끄고 `data/` 폴더를 지운 뒤 다시 실행하세요.

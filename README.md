# 테트리스 온라인 - 배포 가이드

## 로컬 실행

```bash
npm install
npm start
# http://localhost:3000 접속
```

개발 모드 (자동 재시작):
```bash
npm run dev
```

---

## GitHub 업로드

```bash
git init
git add .
git commit -m "첫 커밋: 테트리스 온라인"
git branch -M main
git remote add origin https://github.com/YOUR_ID/tetris-online.git
git push -u origin main
```

---

## Render.com 배포

1. https://render.com 가입 (GitHub 연동)
2. **New +** → **Web Service** 클릭
3. GitHub 레포 선택
4. 설정:
   - **Name**: tetris-online (원하는 이름)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. **Create Web Service** 클릭
6. 2~3분 후 `https://tetris-online-xxxx.onrender.com` 주소 생성됨!

> ⚠️ Render 무료 플랜은 15분 비활성 시 서버가 슬립(Sleep) 상태로 들어갑니다.
> 첫 접속 시 30초 정도 대기 시간이 있을 수 있어요.

---

## 폴더 구조

```
tetris-online/
├── server.js          # Express + Socket.io 서버
├── package.json
├── .gitignore
└── public/
    ├── index.html     # 메인 (닉네임/로비/방/게임 화면 통합)
    └── js/
        ├── tetris.js  # 테트리스 게임 엔진
        └── lobby.js   # 클라이언트 소켓/UI 로직
```

---

## 게임 조작법

| 키 | 동작 |
|---|---|
| ← → | 좌우 이동 |
| ↓ | 빠른 낙하 |
| ↑ / Z | 회전 |
| Space | 하드드롭 |

---

## 기능 목록

- ✅ 닉네임으로 간단 입장
- ✅ 방 만들기 (2~6인)
- ✅ 방 목록 / 참가
- ✅ 레디 시스템 (모두 레디 시 자동 시작)
- ✅ 실시간 대전 (상대방 보드 실시간 표시)
- ✅ 훼방 블록 시스템 (2줄 이상 클리어 시 공격)
- ✅ 로비 채팅 / 방 채팅
- ✅ 랭킹 (인메모리, 점수순 TOP 20)
- ✅ 게임 오버 / 승패 판정

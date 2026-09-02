# 실시간 턴제 전투 데모

TypeScript + Vite로 만든, "실시간 턴제(Real-Time Turn-Based)" 전투 시스템 데모입니다.

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 안내되는 로컬 주소로 접속하면 됩니다. `npm run build`로 정적 빌드도 가능합니다.

## 데스크톱 실행파일(.exe)로 빌드하기

Electron으로 감싸서 Windows용 실행파일을 만들 수 있습니다.

**방법 A: GitHub Actions에서 빌드 (Windows PC가 없어도 됨, 권장)**

이 저장소의 GitHub → Actions 탭에서 **"Build Windows executable"** 워크플로를 수동 실행(`Run workflow`)하면,
실제 Windows 러너에서 빌드한 뒤 완료된 실행파일을 워크플로 실행 결과의 Artifacts에서 zip으로 내려받을 수 있습니다.
(`v`로 시작하는 태그를 푸시해도 자동으로 실행됩니다.)

**방법 B: 로컬 Windows PC에서 직접 빌드**

```bash
npm install
npm run dist:win
```

`release/` 폴더에 설치형 실행파일(`TurnBattleDemo Setup x.x.x.exe`)과 별도 설치 없이 바로 실행되는
포터블 실행파일이 생성됩니다. (서명이 되어있지 않아 Windows SmartScreen 경고가 뜰 수 있는데, "추가 정보 → 실행"으로 진행하면 됩니다.)

> 참고: `dist:win`은 Windows용 빌드 도구(NSIS 등)를 사용하므로 macOS/Linux에서 실행하려면 별도로 `wine`이 설치돼 있어야 합니다.
> Windows PC에서 직접 실행하거나, 위 방법 A(GitHub Actions)를 사용하는 쪽이 훨씬 간단합니다.

개발 중 Electron 창으로 미리 보고 싶다면(핫리로드 포함): `npm run electron:dev`

## 핵심 규칙과 구현 위치

1. **턴이 활성화되어도 다른 캐릭터의 진행이 멈추지 않는다.**
   `src/engine/battle.ts`의 `chargeGauges()`가 매 프레임 살아있는 모든 캐릭터의 ATB 게이지를 충전합니다.
   이미 "준비 상태"인 캐릭터만 충전을 멈추고, 그 외에는 누군가 행동을 고르고 있어도 계속 시간이 흐릅니다.

2. **먼저 턴이 활성화된 캐릭터가 있어도, 나중에 활성화된 캐릭터가 먼저 행동할 수 있다.**
   게이지가 가득 찬 캐릭터는 모두 `readyIds`에 들어가 동시에 "행동 가능" 상태가 되며, 순서가 실제 행동 순서를
   강제하지 않습니다. 플레이어 캐릭터는 준비된 순서와 무관하게 원하는 아무 캐릭터부터 행동시킬 수 있고
   (하단 액션 패널에 준비된 아군 전원이 각자 버튼과 함께 나열됩니다), 적은 캐릭터마다 독립적인 "생각 시간"
   타이머로 따로따로 행동합니다. 그래서 리엘이 먼저 준비되어 있어도, 그 사이 플레이어가 입력을 미루면
   나중에 준비된 다크 샤먼이 먼저 공격할 수 있습니다.

3. **캐릭터마다 고유한 일반공격/스킬/필살기가 있고, 필살기는 자기 턴이 아니어도 사용 가능하다.**
   `src/engine/characters.ts`에 5명(전사/마도사/힐러 + 적 2종)의 스킬셋이 정의되어 있습니다.
   `performUltimate()`는 `readyIds`를 전혀 건드리지 않는 별도 경로로, 에너지가 가득 차면 즉시 발동합니다 —
   화면에서도 각 캐릭터 카드의 필살기 버튼으로 언제든(내 턴이 아니어도) 사용할 수 있습니다.

4. **캐릭터마다 속도(SPD)가 달라 턴이 열리는 주기가 다르다.**
   게이지 충전 속도는 `effectiveSpd(character)`에 비례합니다 (속도 버프/디버프도 반영). 상단의 "다음 턴 순서" 미리보기도 이 속도를 기반으로 시뮬레이션합니다.

5. **버프/디버프 지속시간은 턴 수 또는 실제 시간(초)으로 계산될 수 있다.**
   `src/engine/types.ts`의 `StatusTemplate.durationType`이 `'turn' | 'time'`을 구분합니다.
   - `turn` 기반 효과(예: 전사의 철벽, 오크의 분노)는 효과를 가진 캐릭터 자신의 턴이 끝날 때만 1씩 감소합니다.
   - `time` 기반 효과(예: 화상, 중독, 재생)는 턴과 무관하게 실제 경과 시간(ms)에 따라 계속 감소하며, 일정 간격마다 도트 피해/회복을 발생시킵니다.

## 구조

```
src/
  engine/
    types.ts          타입 정의
    statusEffects.ts  버프/디버프 템플릿 + 스탯 보정 계산
    characters.ts      캐릭터 5종의 일반공격/스킬/필살기 정의
    battle.ts          게이지/대기열/필살기 인터럽트/AI를 포함한 전투 시뮬레이션 엔진
  ui/
    types.ts           UI 전용 타입 (대상 선택 상태 등)
    render.ts           DOM 렌더링 (구조 변경과 수치 갱신을 분리해 매 프레임 버튼이 재생성되지 않도록 함)
  main.ts               게임 루프(rAF) + 이벤트 연결
  style.css
electron/
  main.cjs               Electron 메인 프로세스 (개발 중엔 vite dev 서버, 빌드 후엔 dist/index.html 로드)
.github/workflows/
  build-windows.yml       GitHub Actions에서 Windows 실행파일을 빌드하는 워크플로
```

## 조작

- 캐릭터 카드 아래 필살기 버튼: 에너지가 가득 차면 언제든(자기 턴이 아니어도) 사용 가능
- 하단 액션 패널: 자신의 턴이 활성화된 아군 캐릭터의 일반공격/스킬 선택 (대상이 필요하면 카드를 클릭해서 지정)
- 상단 컨트롤: 일시정지, 배속(x1/x2/x4), 전투 재시작

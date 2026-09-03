import './style.css';
import { BattleEngine } from './engine/battle';
import { PLAYER_CHARACTER_DEFS } from './engine/characters';
import { renderApp, resetUiCaches } from './ui/render';
import { renderPartySelect } from './ui/partyScreen';
import type { ActionKey, PendingAction, UiHandlers } from './ui/types';

type Screen = 'title' | 'party' | 'stage' | 'battle';

const STAGE_NAME = 'STAGE 1';
const STAGE_INTRO_MS = 1800;
const MAX_PARTY_SIZE = 4;

const engine = new BattleEngine();
let pending: PendingAction | null = null;
/** 클릭으로 선택된, "지금 Q/E로 행동시킬" 아군 캐릭터 */
let selectedActorId: string | null = null;

let screen: Screen = 'title';
const partySelection = new Set<string>();
/** 마지막으로 전투에 데려간 아군 키 — 전투 재시작 시 같은 편성을 재사용한다. */
let lastPartyKeys: string[] = [];

const screenEls = {
  title: document.getElementById('screen-title')!,
  party: document.getElementById('screen-party')!,
  stage: document.getElementById('screen-stage')!,
  battle: document.getElementById('screen-battle')!,
};

function showScreen(next: Screen): void {
  screen = next;
  screenEls.title.hidden = next !== 'title';
  screenEls.party.hidden = next !== 'party';
  screenEls.stage.hidden = next !== 'stage';
  screenEls.battle.hidden = next !== 'battle';
}

/** 대상 선택 상태를 바꿀 때는 항상 이 함수로: 엔진에도 함께 알려 게이지 충전을 멈추거나 재개한다. */
function setPending(next: PendingAction | null): void {
  pending = next;
  engine.setTargetSelectionPaused(pending !== null);
}

function execute(actorId: string, key: ActionKey, targetId?: string): void {
  if (key === 'ultimate') engine.performUltimate(actorId, targetId);
  else engine.performAction(actorId, key, targetId);
  setPending(null);
  if (selectedActorId === actorId) selectedActorId = null;
}

function chooseAction(actorId: string, key: ActionKey): void {
  const actor = engine.findById(actorId);
  if (!actor) return;
  const skillDef = key === 'ultimate' ? actor.skills.ultimate : actor.skills[key];
  const { targetType } = skillDef;

  // 전체/자신 대상 스킬은 대상 선택 없이 즉시 실행, 단일 대상 스킬은 선택 모드로 전환
  if (targetType === 'allEnemies' || targetType === 'allAllies' || targetType === 'self') {
    execute(actorId, key);
    renderBattle();
    return;
  }
  setPending({ actorId, key, targetType });
  renderBattle();
}

const handlers: UiHandlers = {
  onChooseAction: chooseAction,
  onChooseTarget: (targetId) => {
    if (!pending) return;
    execute(pending.actorId, pending.key, targetId);
    renderBattle();
  },
  onSelectActor: (actorId) => {
    selectedActorId = selectedActorId === actorId ? null : actorId;
    renderBattle();
  },
  onCancelPending: () => {
    setPending(null);
    renderBattle();
  },
  onReset: () => restartBattle(),
};

function renderBattle(): void {
  if (selectedActorId) {
    const actor = engine.findById(selectedActorId);
    if (!actor || !actor.alive || !engine.isReady(actor.id)) selectedActorId = null;
  }
  renderApp(engine, pending, selectedActorId, handlers);
}

function restartBattle(): void {
  engine.reset(lastPartyKeys);
  setPending(null);
  selectedActorId = null;
  resetUiCaches();
  showScreen('battle');
  renderBattle();
}

// -------------------------------------------------------------------------
// 화면 흐름: 타이틀 -> 파티 편성 -> 스테이지 인트로 -> 전투
// -------------------------------------------------------------------------
document.getElementById('btn-start')!.addEventListener('click', () => {
  showScreen('party');
  renderPartySelect(PLAYER_CHARACTER_DEFS, partySelection, onTogglePartyMember);
  syncStartBattleButton();
});

function onTogglePartyMember(key: string): void {
  if (partySelection.has(key)) {
    partySelection.delete(key);
  } else if (partySelection.size < MAX_PARTY_SIZE) {
    partySelection.add(key);
  }
  renderPartySelect(PLAYER_CHARACTER_DEFS, partySelection, onTogglePartyMember);
  syncStartBattleButton();
}

function syncStartBattleButton(): void {
  (document.getElementById('btn-start-battle') as HTMLButtonElement).disabled = partySelection.size === 0;
}

document.getElementById('btn-start-battle')!.addEventListener('click', () => {
  if (partySelection.size === 0) return;
  lastPartyKeys = [...partySelection];
  document.getElementById('stage-title')!.textContent = STAGE_NAME;
  showScreen('stage');
  setTimeout(() => {
    engine.reset(lastPartyKeys);
    setPending(null);
    selectedActorId = null;
    resetUiCaches();
    showScreen('battle');
    renderBattle();
  }, STAGE_INTRO_MS);
});

// -------------------------------------------------------------------------
// 키보드 조작 (전투 화면일 때만 동작): 캐릭터/대상 선택은 마우스로 하고,
// Q/E는 클릭으로 선택된 캐릭터의 일반공격/스킬을, 1~4는 그 슬롯의 필살기가
// 준비되어 있을 때만 즉시 사용하는 단축키다.
// -------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (screen !== 'battle' || engine.status !== 'ongoing') return;
  if (e.repeat) return;

  if (e.key >= '1' && e.key <= '4') {
    const players = engine.characters.filter((c) => c.team === 'player');
    const actor = players[Number(e.key) - 1];
    if (!actor || !actor.alive || actor.energy < actor.maxEnergy) return;
    chooseAction(actor.id, 'ultimate');
    return;
  }

  if (e.key === 'q' || e.key === 'Q') {
    if (selectedActorId) chooseAction(selectedActorId, 'normal');
    return;
  }
  if (e.key === 'e' || e.key === 'E') {
    if (selectedActorId) chooseAction(selectedActorId, 'skill');
  }
});

// 정적 컨트롤 버튼은 한 번만 연결한다
document.getElementById('btn-pause')!.addEventListener('click', () => {
  engine.setPaused(!engine.paused);
});
document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    engine.setTimeScale(Number(btn.dataset.speed));
  });
});
document.getElementById('btn-reset')!.addEventListener('click', () => restartBattle());

// 시뮬레이션은 매 프레임 갱신하되, 렌더링은 살짝 스로틀링해 부드러운 CSS 전환과 함께 사용한다
const RENDER_INTERVAL_MS = 90;
let last = performance.now();
let renderAcc = 0;

function frame(now: number): void {
  const dt = Math.min(now - last, 100);
  last = now;

  if (screen === 'battle') {
    engine.update(dt);
    renderAcc += dt;
    if (renderAcc >= RENDER_INTERVAL_MS) {
      renderAcc = 0;
      renderBattle();
    }
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

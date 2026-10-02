import './style.css';
import { BattleEngine } from './engine/battle';
import { PLAYER_CHARACTER_DEFS } from './engine/characters';
import { renderApp, resetUiCaches } from './ui/render';
import { renderPartySelect } from './ui/partyScreen';
import { loadSettings, saveSettings, type GameSettings } from './settings';
import type { ActionKey, PendingAction, UiHandlers } from './ui/types';

type Screen = 'title' | 'settings' | 'party' | 'stage' | 'battle';
type BindableAction = 'normal' | 'skill' | 'ultimate';

const STAGE_NAME = 'STAGE 1';
const STAGE_INTRO_MS = 1800;
const MAX_PARTY_SIZE = 4;

const engine = new BattleEngine();
let pending: PendingAction | null = null;
/** 숫자키 또는 클릭으로 선택된, "지금 행동을 준비 중인" 아군 캐릭터 */
let selectedActorId: string | null = null;

let screen: Screen = 'title';
const partySelection = new Set<string>();
/** 마지막으로 전투에 데려간 아군 키 — 전투 재시작 시 같은 편성을 재사용한다. */
let lastPartyKeys: string[] = [];

const settings: GameSettings = loadSettings();
/** 설정 화면에서 "이 동작의 키를 다시 누르세요" 대기 중일 때만 값이 들어간다. */
let rebindingAction: BindableAction | null = null;

const screenEls = {
  title: document.getElementById('screen-title')!,
  settings: document.getElementById('screen-settings')!,
  party: document.getElementById('screen-party')!,
  stage: document.getElementById('screen-stage')!,
  battle: document.getElementById('screen-battle')!,
};

function showScreen(next: Screen): void {
  screen = next;
  screenEls.title.hidden = next !== 'title';
  screenEls.settings.hidden = next !== 'settings';
  screenEls.party.hidden = next !== 'party';
  screenEls.stage.hidden = next !== 'stage';
  screenEls.battle.hidden = next !== 'battle';
}

/** 행동/대상을 "준비 중"인 동안에는 게이지를 멈춘다 — 단, 하드 모드에서는 멈추지 않는다.
 *  selectedActorId/pending이 바뀔 수 있는 모든 경로가 결국 renderBattle()을 거치므로 거기서 한 곳에만 둔다. */
function syncPause(): void {
  const preparingAction = selectedActorId !== null || pending !== null;
  engine.setTargetSelectionPaused(!settings.hardMode && preparingAction);
}

function setPending(next: PendingAction | null): void {
  pending = next;
}

function execute(actorId: string, key: ActionKey, targetId?: string): void {
  if (key === 'ultimate') engine.performUltimate(actorId, targetId);
  else engine.performAction(actorId, key, targetId);
  pending = null;
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
  syncPause();
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
// 설정 화면: 하드 모드 토글 + 일반공격/스킬/필살기 단축키 변경
// -------------------------------------------------------------------------
const KEYBIND_BTN_IDS: Record<BindableAction, string> = {
  normal: 'keybind-normal',
  skill: 'keybind-skill',
  ultimate: 'keybind-ultimate',
};

function settingsKeyFor(action: BindableAction): string {
  return action === 'normal' ? settings.keyNormal : action === 'skill' ? settings.keySkill : settings.keyUltimate;
}

function assignSettingsKey(action: BindableAction, key: string): void {
  if (action === 'normal') settings.keyNormal = key;
  else if (action === 'skill') settings.keySkill = key;
  else settings.keyUltimate = key;
}

/** 두 동작에 같은 키가 겹치면 혼란스러우므로, 새 키가 이미 다른 동작에 쓰이고 있었다면 서로 맞바꾼다. */
function setSettingsKey(action: BindableAction, key: string): void {
  const prevKey = settingsKeyFor(action);
  (['normal', 'skill', 'ultimate'] as const).forEach((other) => {
    if (other !== action && settingsKeyFor(other) === key) assignSettingsKey(other, prevKey);
  });
  assignSettingsKey(action, key);
  saveSettings(settings);
  renderSettingsScreen();
  renderKeyboardHint();
  syncPause();
}

function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

function renderSettingsScreen(): void {
  (document.getElementById('setting-hardmode') as HTMLInputElement).checked = settings.hardMode;
  (['normal', 'skill', 'ultimate'] as const).forEach((action) => {
    const btn = document.getElementById(KEYBIND_BTN_IDS[action]) as HTMLButtonElement;
    const listening = rebindingAction === action;
    btn.textContent = listening ? '키 입력 대기...' : keyLabel(settingsKeyFor(action));
    btn.classList.toggle('listening', listening);
  });
}

function renderKeyboardHint(): void {
  const hint = document.getElementById('keyboard-hint');
  if (!hint) return;
  hint.textContent =
    `⌨ 숫자키(1~4)로 캐릭터 준비 · ${keyLabel(settings.keyNormal)} 일반공격 · ` +
    `${keyLabel(settings.keySkill)} 스킬 · ${keyLabel(settings.keyUltimate)} 필살기` +
    (settings.hardMode ? ' · 하드 모드' : '');
}

document.getElementById('btn-open-settings')!.addEventListener('click', () => {
  rebindingAction = null;
  renderSettingsScreen();
  showScreen('settings');
});
document.getElementById('btn-settings-back')!.addEventListener('click', () => {
  rebindingAction = null;
  showScreen('title');
});
document.getElementById('setting-hardmode')!.addEventListener('change', (e) => {
  settings.hardMode = (e.target as HTMLInputElement).checked;
  saveSettings(settings);
  renderKeyboardHint();
  syncPause();
});
(['normal', 'skill', 'ultimate'] as const).forEach((action) => {
  document.getElementById(KEYBIND_BTN_IDS[action])!.addEventListener('click', () => {
    rebindingAction = rebindingAction === action ? null : action;
    renderSettingsScreen();
  });
});

renderKeyboardHint();

// -------------------------------------------------------------------------
// 키보드 조작
// - 설정 화면에서 키 재지정을 기다리는 중이면 다음 입력을 그 동작의 단축키로 받는다.
// - 전투 화면에서는: 숫자키(1~4)로 그 슬롯의 "턴이 활성화된" 캐릭터를 선택(= 클릭과 동일)하고,
//   선택된 캐릭터에게 설정된 키로 일반공격/스킬/필살기를 사용한다 (필살기는 자신의 턴이 아니어도
//   에너지만 차 있으면 사용 가능 — 카드의 필살기 버튼과 동일한 조건).
// -------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (rebindingAction) {
    e.preventDefault();
    const action = rebindingAction;
    rebindingAction = null;
    const ignored = ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock'];
    if (e.key !== 'Escape' && !ignored.includes(e.key)) {
      setSettingsKey(action, e.key.length === 1 ? e.key.toLowerCase() : e.key);
    } else {
      renderSettingsScreen();
    }
    return;
  }

  if (screen !== 'battle' || engine.status !== 'ongoing') return;
  if (e.repeat) return;

  if (!pending && e.key >= '1' && e.key <= '4') {
    const players = engine.characters.filter((c) => c.team === 'player');
    const actor = players[Number(e.key) - 1];
    if (actor && actor.alive && engine.isReady(actor.id)) {
      handlers.onSelectActor(actor.id);
    }
    return;
  }

  if (!selectedActorId) return;
  const key = e.key.toLowerCase();
  if (key === settings.keyNormal) {
    chooseAction(selectedActorId, 'normal');
  } else if (key === settings.keySkill) {
    chooseAction(selectedActorId, 'skill');
  } else if (key === settings.keyUltimate) {
    const actor = engine.findById(selectedActorId);
    if (actor && actor.energy >= actor.maxEnergy) chooseAction(selectedActorId, 'ultimate');
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

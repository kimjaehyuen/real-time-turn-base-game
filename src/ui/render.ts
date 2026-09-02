import { BattleEngine, GAUGE_MAX } from '../engine/battle';
import type { Character, StatusEffect } from '../engine/types';
import type { PendingAction, UiHandlers } from './types';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

function statusRemainLabel(s: StatusEffect): string {
  return s.durationType === 'turn'
    ? `${Math.max(0, s.remainingTurns)}턴`
    : `${Math.max(0, s.remainingMs / 1000).toFixed(1)}초`;
}

function isValidTarget(engine: BattleEngine, pending: PendingAction, c: Character): boolean {
  if (!c.alive) return false;
  return engine.getValidTargets(pending.actorId, pending.targetType).some((t) => t.id === c.id);
}

// ---------------------------------------------------------------------------
// 컨트롤 바 (일시정지 / 배속 / 재시작) — 정적 버튼의 상태만 동기화
// ---------------------------------------------------------------------------
export function syncControls(engine: BattleEngine): void {
  const pauseBtn = byId('btn-pause');
  pauseBtn.textContent = engine.paused ? '▶ 재개' : '⏸ 일시정지';
  pauseBtn.classList.toggle('active', engine.paused);

  document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((btn) => {
    const speed = Number(btn.dataset.speed);
    btn.classList.toggle('active', speed === engine.timeScale);
  });
}

// ---------------------------------------------------------------------------
// 턴 순서 미리보기 — 상호작용이 없는 순수 표시용이라 매 프레임 새로 그려도 무방
// ---------------------------------------------------------------------------
function renderTurnOrder(engine: BattleEngine): void {
  const container = byId('turn-order');
  const wrap = el('div', 'turn-order-inner');
  wrap.appendChild(el('span', 'turn-order-label', '다음 턴 순서'));

  const list = engine.getTurnOrderPreview(8);
  list.forEach((c, i) => {
    const chip = el('div', `turn-chip team-${c.team}${i === 0 ? ' first' : ''}${!c.alive ? ' dead' : ''}`);
    chip.textContent = c.portrait;
    chip.title = c.name;
    wrap.appendChild(chip);
    if (i < list.length - 1) wrap.appendChild(el('span', 'turn-arrow', '›'));
  });

  container.innerHTML = '';
  container.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// 캐릭터 카드
// 구조(버튼/상태칩/뱃지 등)는 "구조 시그니처"가 바뀔 때만 다시 그리고,
// 매 프레임 바뀌는 수치(HP/게이지/에너지/남은시간)는 캐시된 엘리먼트를 직접 갱신한다.
// 이렇게 하지 않으면 렌더 주기마다 버튼이 통째로 교체되어 클릭 이벤트가 유실되거나
// 리스너가 반복 등록될 수 있다.
// ---------------------------------------------------------------------------
interface CardHandle {
  root: HTMLElement;
  signature: string;
  hpFill: HTMLElement;
  hpLabel: HTMLElement;
  atbFill: HTMLElement;
  atbLabel: HTMLElement;
  energyFill: HTMLElement;
  energyLabel: HTMLElement;
  ultSlot: HTMLElement;
  statusRemainEls: Map<string, HTMLElement>;
}

const cardCache = new Map<string, CardHandle>();

export function clearCardCache(): void {
  cardCache.clear();
}

function cardSignature(engine: BattleEngine, c: Character, pending: PendingAction | null): string {
  const targetable = !!pending && isValidTarget(engine, pending, c);
  const ultReady = c.energy >= c.maxEnergy;
  const statusSig = c.statuses.map((s) => s.id).join(',');
  return [
    c.alive ? 'a' : 'd',
    engine.isReady(c.id) ? 'ready' : 'idle',
    targetable ? 'targetable' : '',
    ultReady ? 'ultready' : '',
    statusSig,
  ].join('|');
}

function buildBar(label: string, kind: string): { wrap: HTMLElement; fill: HTMLElement; labelEl: HTMLElement } {
  const wrap = el('div', `bar-wrap ${kind}-wrap`);
  const labelEl = el('div', 'bar-label-row', label);
  const track = el('div', `bar-track ${kind}-track`);
  const fill = el('div', `bar-fill ${kind}-fill`);
  track.appendChild(fill);
  wrap.appendChild(labelEl);
  wrap.appendChild(track);
  return { wrap, fill, labelEl };
}

function buildCard(engine: BattleEngine, c: Character, pending: PendingAction | null, handlers: UiHandlers): CardHandle {
  const classes = ['char-card', `team-${c.team}`, c.alive ? '' : 'dead', engine.isReady(c.id) ? 'active-turn' : '']
    .filter(Boolean)
    .join(' ');
  const root = el('div', classes);

  const targetable = !!pending && isValidTarget(engine, pending, c);
  if (targetable) {
    root.classList.add('targetable');
    root.addEventListener('click', () => handlers.onChooseTarget(c.id));
  }

  const head = el('div', 'card-head');
  head.appendChild(el('div', 'portrait', c.portrait));
  const nameCol = el('div', 'name-col');
  nameCol.appendChild(el('div', 'name', c.name));
  nameCol.appendChild(el('div', 'spd-label', `SPD ${Math.round(c.base.spd)}`));
  head.appendChild(nameCol);
  root.appendChild(head);

  if (engine.isReady(c.id)) {
    root.appendChild(el('div', 'turn-badge active', c.team === 'player' ? '내 턴 — 행동 선택' : '공격 준비 중'));
  }

  const hp = buildBar('HP', 'hp');
  root.appendChild(hp.wrap);
  const atb = buildBar('ATB', 'atb');
  root.appendChild(atb.wrap);
  const energy = buildBar('필살기', 'energy');
  root.appendChild(energy.wrap);

  const statusRemainEls = new Map<string, HTMLElement>();
  if (c.statuses.length) {
    const row = el('div', 'status-row');
    for (const s of c.statuses) {
      const chip = el('div', `status-chip ${s.kind}`);
      chip.textContent = s.icon;
      const remain = el('span', 'status-remain', statusRemainLabel(s));
      chip.appendChild(remain);
      row.appendChild(chip);
      statusRemainEls.set(s.id, remain);
    }
    root.appendChild(row);
  }

  const ultSlot = el('div', 'ult-slot');
  if (c.alive) {
    if (c.team === 'player') {
      const ready = c.energy >= c.maxEnergy;
      const btn = el('button', `ult-btn${ready ? ' ready' : ''}`);
      btn.title = c.skills.ultimate.description;
      btn.disabled = !ready;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onChooseAction(c.id, 'ultimate');
      });
      ultSlot.appendChild(btn);
    } else {
      ultSlot.appendChild(el('div', 'ult-indicator'));
    }
  }
  root.appendChild(ultSlot);

  return {
    root,
    signature: cardSignature(engine, c, pending),
    hpFill: hp.fill,
    hpLabel: hp.labelEl,
    atbFill: atb.fill,
    atbLabel: atb.labelEl,
    energyFill: energy.fill,
    energyLabel: energy.labelEl,
    ultSlot,
    statusRemainEls,
  };
}

/** 매 프레임 바뀌는 수치들을 캐시된 엘리먼트에 직접 반영한다 (구조는 건드리지 않음) */
function updateCardDynamics(engine: BattleEngine, c: Character, handle: CardHandle): void {
  const hpPct = c.maxHp > 0 ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 0;
  handle.hpFill.style.width = `${hpPct}%`;
  handle.hpLabel.textContent = `HP · ${Math.max(0, Math.round(c.hp))} / ${c.maxHp}`;

  const gaugePct = Math.max(0, Math.min(100, (c.gauge / GAUGE_MAX) * 100));
  const gaugeText = engine.isReady(c.id) ? '행동 대기' : '충전 중';
  handle.atbFill.style.width = `${gaugePct}%`;
  handle.atbLabel.textContent = `ATB · ${gaugeText}`;

  const energyPct = Math.max(0, Math.min(100, (c.energy / c.maxEnergy) * 100));
  handle.energyFill.style.width = `${energyPct}%`;
  handle.energyLabel.textContent = `필살기 · ${Math.floor(energyPct)}%`;

  for (const s of c.statuses) {
    const target = handle.statusRemainEls.get(s.id);
    if (target) target.textContent = statusRemainLabel(s);
  }

  if (c.alive && c.team === 'player') {
    const btn = handle.ultSlot.querySelector('.ult-btn') as HTMLButtonElement | null;
    if (btn) {
      const ready = c.energy >= c.maxEnergy;
      btn.textContent = ready ? `💫 필살기: ${c.skills.ultimate.name}` : `필살기 충전 중 (${Math.floor(energyPct)}%)`;
    }
  } else if (c.alive && c.team === 'enemy') {
    const indicator = handle.ultSlot.querySelector('.ult-indicator') as HTMLElement | null;
    if (indicator) {
      const ready = c.energy >= c.maxEnergy;
      indicator.classList.toggle('ready', ready);
      indicator.textContent = ready ? '💫 필살기 준비!' : `필살기 ${Math.floor(energyPct)}%`;
    }
  }
}

function renderParty(engine: BattleEngine, team: 'player' | 'enemy', pending: PendingAction | null, handlers: UiHandlers): void {
  const container = byId(team === 'player' ? 'player-party' : 'enemy-party');
  const members = engine.characters.filter((c) => c.team === team);

  const frag = document.createDocumentFragment();
  for (const c of members) {
    const sig = cardSignature(engine, c, pending);
    let handle = cardCache.get(c.id);
    if (!handle || handle.signature !== sig) {
      handle = buildCard(engine, c, pending, handlers);
      cardCache.set(c.id, handle);
    }
    updateCardDynamics(engine, c, handle);
    frag.appendChild(handle.root);
  }

  container.innerHTML = '';
  container.appendChild(frag);
}

// ---------------------------------------------------------------------------
// 하단 액션 패널: 턴이 활성화된 "플레이어" 캐릭터 전원의 일반공격/스킬 선택.
// 동시에 여러 명이 준비될 수 있으므로, 준비된 순서와 무관하게 원하는 캐릭터부터
// 먼저 행동시킬 수 있다 (적도 마찬가지로 각자 독립적인 타이밍에 따로 행동한다).
// (필살기는 각 캐릭터 카드의 버튼으로 언제든 별도 사용 — 여기 포함되지 않음)
// 상태가 바뀔 때만 다시 그린다.
// ---------------------------------------------------------------------------
let lastPanelSignature = '';

function renderActionPanel(engine: BattleEngine, pending: PendingAction | null, handlers: UiHandlers): void {
  const readyPlayers = engine.characters.filter((c) => c.team === 'player' && c.alive && engine.isReady(c.id));
  const signature = `${engine.status}|${readyPlayers.map((c) => c.id).join(',')}|${pending ? `${pending.actorId}:${pending.key}` : ''}`;
  if (signature === lastPanelSignature) return;
  lastPanelSignature = signature;

  const container = byId('action-panel');
  const panel = el('div', 'action-panel-inner');

  if (engine.status !== 'ongoing') {
    container.innerHTML = '';
    container.appendChild(panel);
    return;
  }

  if (!readyPlayers.length) {
    panel.appendChild(el('div', 'hint', '캐릭터의 턴이 활성화되면 여기에서 행동을 선택할 수 있습니다.'));
    container.innerHTML = '';
    container.appendChild(panel);
    return;
  }

  const list = el('div', 'ready-actor-list');
  for (const actor of readyPlayers) {
    const row = el('div', 'ready-actor-row');
    row.appendChild(el('div', 'ready-actor-name', `${actor.portrait} ${actor.name}`));

    if (pending && pending.actorId === actor.id) {
      const kindLabel = pending.key === 'skill' ? '스킬' : pending.key === 'ultimate' ? '필살기' : '일반 공격';
      row.appendChild(el('div', 'hint', `${kindLabel} 대상을 선택하세요 (강조된 대상을 클릭)`));
      const cancelBtn = el('button', 'ctrl-btn cancel', '취소');
      cancelBtn.addEventListener('click', () => handlers.onCancelPending());
      row.appendChild(cancelBtn);
    } else {
      const btnRow = el('div', 'action-buttons');
      const normalBtn = el('button', 'action-btn', actor.skills.normal.name);
      normalBtn.title = actor.skills.normal.description;
      normalBtn.addEventListener('click', () => handlers.onChooseAction(actor.id, 'normal'));

      const skillBtn = el('button', 'action-btn skill', actor.skills.skill.name);
      skillBtn.title = actor.skills.skill.description;
      skillBtn.addEventListener('click', () => handlers.onChooseAction(actor.id, 'skill'));

      btnRow.appendChild(normalBtn);
      btnRow.appendChild(skillBtn);
      row.appendChild(btnRow);
    }
    list.appendChild(row);
  }
  panel.appendChild(list);
  container.innerHTML = '';
  container.appendChild(panel);
}

export function resetActionPanelCache(): void {
  lastPanelSignature = '';
}

// ---------------------------------------------------------------------------
// 전투 로그 — 새로 추가된 항목만 append 한다
// ---------------------------------------------------------------------------
let lastLogCount = 0;

function renderLog(engine: BattleEngine): void {
  const container = byId('log-list');

  if (engine.logs.length < lastLogCount) {
    container.innerHTML = '';
    lastLogCount = 0;
  }
  if (engine.logs.length === lastLogCount) return;

  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;

  const frag = document.createDocumentFragment();
  for (let i = lastLogCount; i < engine.logs.length; i++) {
    const entry = engine.logs[i];
    const line = el('div', `log-entry kind-${entry.kind}`);
    line.appendChild(el('span', 'log-time', `${entry.time.toFixed(1)}s`));
    line.appendChild(el('span', 'log-msg', entry.message));
    frag.appendChild(line);
  }
  container.appendChild(frag);
  lastLogCount = engine.logs.length;

  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

export function resetLogCache(): void {
  lastLogCount = 0;
}

// ---------------------------------------------------------------------------
// 승패 오버레이
// ---------------------------------------------------------------------------
function renderOverlay(engine: BattleEngine, handlers: UiHandlers): void {
  const overlay = byId('overlay');
  const title = byId('overlay-title');
  const resetBtn = byId('overlay-reset') as HTMLButtonElement;

  if (engine.status === 'ongoing') {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  title.textContent = engine.status === 'player_win' ? '🎉 승리했습니다!' : '💀 패배했습니다...';
  resetBtn.onclick = () => handlers.onReset();
}

export function renderApp(engine: BattleEngine, pending: PendingAction | null, handlers: UiHandlers): void {
  syncControls(engine);
  renderTurnOrder(engine);
  renderParty(engine, 'enemy', pending, handlers);
  renderParty(engine, 'player', pending, handlers);
  renderActionPanel(engine, pending, handlers);
  renderLog(engine);
  renderOverlay(engine, handlers);
}

export function resetUiCaches(): void {
  clearCardCache();
  resetActionPanelCache();
  resetLogCache();
}

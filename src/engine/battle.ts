import type { BattleApi, Character, DamageType, StatusEffect, StatusTemplate, TargetType } from './types';
import { createBattleRoster } from './characters';
import { computeDamage } from './damage';
import { effectiveAtk, effectiveSpd } from './statusEffects';

/** 이 값만큼 게이지가 차면 턴이 "활성화"된다. spd=100 기준 4초. */
export const GAUGE_MAX = 400;
/** 피격 시 얻는 필살기 에너지 (선딜 없이 피격만으로도 필살기가 채워지도록) */
const HIT_ENERGY_GAIN = 8;
/** 아군 전체가 공유하는 SP(스킬 포인트)의 최대치와 시작값 */
export const MAX_SP = 10;
const STARTING_SP = 3;
/** 적 AI가 "생각하는" 시간(ms) — 행동 게이지가 가득 찬 뒤 실제로 행동하기까지의 고정 지연.
 *  하드 모드에서는 더 짧아진다 (적이 더 빠르게 공격한다) — main.ts가 setEnemyActionDelayMs()로 지정. */
export const ENEMY_ACTION_DELAY_NORMAL_MS = 1000;
export const ENEMY_ACTION_DELAY_HARD_MS = 500;
/** 제압이 발동했을 때 행동불능 상태가 지속되는 시간(ms) */
export const SUPPRESSION_DURATION_MS = 4000;
/** 제압된 적이 아니더라도, 적이 행동을 마칠 때마다 제압 게이지가 이만큼 회복된다. */
const SUPPRESSION_REGEN_PER_ACTION = 15;
/** 대상의 행동 게이지가 가득 찬 상태에서 적중시키면 제압 게이지 소모량이 이 배수로 적용된다. */
const SUPPRESSION_READY_HIT_MULTIPLIER = 5;
/** 위 상황에서 추가로 대상의 행동 게이지를 이 비율만큼 깎는다 (0.5 = 50% 감소). */
const SUPPRESSION_READY_HIT_GAUGE_CUT = 0.5;

export type BattleStatus = 'ongoing' | 'player_win' | 'enemy_win';

export class BattleEngine implements BattleApi {
  characters: Character[] = [];
  /** 게이지가 가득 차 "턴이 활성화된" 캐릭터들. 순서는 단순 참고용일 뿐, 행동 순서를 강제하지 않는다 —
   *  나중에 활성화된 캐릭터가 먼저 활성화된 캐릭터보다 먼저 행동할 수 있다 (아래 update() 참고). */
  readyIds: string[] = [];
  status: BattleStatus = 'ongoing';
  battleTimeMs = 0;
  paused = false;
  timeScale = 1;
  /** 아군 전체가 공유하는 SP. 스킬 사용에 소모되고 일반공격 등으로 회복된다 (적은 관여하지 않음). */
  sp = STARTING_SP;
  maxSp = MAX_SP;
  /** 아군이 최근 행동에서 적에게 입힌 피해 합계 — 아군이 새 행동을 시작할 때마다 0으로 리셋된다. */
  lastPlayerDamage = 0;
  /** 적이 최근 행동에서 아군에게 입힌 피해 합계 — 적이 새 행동을 시작할 때마다 0으로 리셋된다. */
  lastEnemyDamage = 0;

  /** 준비된 적 캐릭터마다 독립적으로 흐르는 "생각 시간". 캐릭터별로 따로 카운트되므로
   *  먼저 준비된 적이라도 이 타이머가 늦게 끝나면 나중에 준비된 적에게 행동 순서를 내줄 수 있다. */
  private enemyThinkTimers = new Map<string, number>();
  /** 대상 선택 중에는 true — 모든 게이지 충전과 적의 행동 진행이 멈춘다 (필살기는 예외). */
  private targetSelectionPaused = false;
  /** 적이 행동 게이지가 가득 찬 뒤 실제로 행동하기까지 걸리는 고정 시간. 하드 모드면 더 짧다. */
  private enemyActionDelayMs = ENEMY_ACTION_DELAY_NORMAL_MS;

  /** 파티 편성 화면에서 선택된 아군 키 목록으로 전투를 (재)시작한다. */
  reset(selectedPlayerKeys: string[]): void {
    this.characters = createBattleRoster(selectedPlayerKeys);
    this.readyIds = [];
    this.status = 'ongoing';
    this.battleTimeMs = 0;
    this.sp = STARTING_SP;
    this.lastPlayerDamage = 0;
    this.lastEnemyDamage = 0;
    this.enemyThinkTimers.clear();
    this.targetSelectionPaused = false;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  /** 준비된 캐릭터의 스킬(등) 대상을 고르는 중일 때 true로 설정한다.
   *  이 동안에는 모든 캐릭터의 행동 게이지 충전과 적의 행동 진행이 멈춘다 — 필살기는 예외로 계속 즉시 사용 가능하다. */
  setTargetSelectionPaused(paused: boolean): void {
    this.targetSelectionPaused = paused;
  }

  /** 적이 행동 게이지가 가득 찬 뒤 실제로 행동하기까지 걸리는 고정 지연 시간을 바꾼다
   *  (하드 모드 여부에 따라 main.ts가 호출 — 하드 모드일수록 적이 더 빠르게 공격한다). */
  setEnemyActionDelayMs(ms: number): void {
    this.enemyActionDelayMs = ms;
  }

  findById(id: string | null | undefined): Character | undefined {
    if (!id) return undefined;
    return this.characters.find((c) => c.id === id);
  }

  isReady(id: string): boolean {
    return this.readyIds.includes(id);
  }

  // -------------------------------------------------------------------------
  // 메인 루프: 매 프레임 호출된다 (real dt를 ms 단위로 전달)
  //
  // 턴은 "활성화된다고 해서 다른 캐릭터를 멈추지 않는다": 게이지가 다 찬 캐릭터는 모두
  // 동시에 readyIds에 들어가 각자 독립적으로 행동 기회를 얻는다. 즉 A가 먼저 활성화되어
  // 있어도, 그 이후에 B가 활성화되면 B가 A보다 먼저 행동할 수도 있다 — 실제 행동 순서는
  // (플레이어의 입력 타이밍 / 적 AI의 개별 사고 시간)에 따라 그때그때 결정된다.
  // -------------------------------------------------------------------------
  update(realDtMs: number): void {
    if (this.status !== 'ongoing') return;
    const dt = this.paused ? 0 : realDtMs * this.timeScale;
    if (dt <= 0) return;
    this.battleTimeMs += dt;

    // 대상 선택 중에는 게이지 충전/적 행동뿐 아니라 턴/시간 기반 버프·디버프의 지속시간, 제압 지속시간도 함께 멈춘다.
    if (!this.targetSelectionPaused) {
      this.tickTimeBasedStatuses(dt);
      if (this.status !== 'ongoing') return;

      this.tickSuppression(dt);
      this.chargeGauges(dt);

      // 준비된 적들은 각자 독립적인 타이머로 행동한다 (하나가 끝나기를 기다리지 않는다).
      for (const id of [...this.readyIds]) {
        const actor = this.findById(id);
        if (!actor || !actor.alive || actor.team !== 'enemy') continue;
        const remaining = (this.enemyThinkTimers.get(id) ?? 0) - dt;
        if (remaining <= 0) {
          this.enemyThinkTimers.delete(id);
          this.runEnemyAI(actor);
        } else {
          this.enemyThinkTimers.set(id, remaining);
        }
      }
    }

    // 필살기는 게이지/준비 상태와 무관하게, 자신의 턴이 아니어도 에너지가 차면 즉시 사용 가능.
    // (플레이어 캐릭터는 UI 버튼으로 직접 트리거하고, 적은 자동으로 즉시 사용한다. 제압되어 행동불능인
    // 동안에는 필살기도 사용할 수 없다 — "행동불능"에는 예외가 없다)
    for (const c of this.characters) {
      if (c.alive && !c.suppressed && c.team === 'enemy' && c.energy >= c.maxEnergy) {
        this.runEnemyUltimateAI(c);
      }
    }
  }

  /** 제압된 캐릭터의 남은 행동불능 시간을 줄이고, 0이 되면 제압을 해제한다. */
  private tickSuppression(dt: number): void {
    for (const c of this.characters) {
      if (!c.alive || !c.suppressed) continue;
      c.suppressedRemainingMs -= dt;
      if (c.suppressedRemainingMs <= 0) {
        c.suppressed = false;
        c.suppressedRemainingMs = 0;
      }
    }
  }

  private tickTimeBasedStatuses(dt: number): void {
    for (const c of this.characters) {
      if (!c.alive) continue;
      for (const s of [...c.statuses]) {
        if (s.durationType !== 'time') continue;
        s.remainingMs -= dt;
        if (s.tick) {
          s.msSinceLastTick += dt;
          while (s.msSinceLastTick >= s.tick.intervalMs) {
            s.msSinceLastTick -= s.tick.intervalMs;
            const source = this.findById(s.sourceId) ?? c;
            if (s.tick.isHeal) {
              const amount = Math.max(1, Math.round(effectiveAtk(source) * s.tick.atkMultiplier));
              this.heal(source, c, amount);
            } else {
              // 지속피해(도트)는 물리/마법 구분이 없고 속성만 정해져 있다 (예: 화상 -> 화염).
              const element = s.tick.element ?? source.element;
              const { amount } = computeDamage({
                attacker: source,
                target: c,
                atkMultiplier: s.tick.atkMultiplier,
                damageType: 'dot',
                element,
              });
              this.applyDotDamage(source, c, amount);
            }
            if (!c.alive) break;
          }
        }
        if (!c.alive) continue;
        if (s.remainingMs <= 0) {
          this.expireStatus(c, s);
        }
      }
    }
  }

  private chargeGauges(dt: number): void {
    for (const c of this.characters) {
      if (!c.alive || c.suppressed) continue; // 제압되어 행동불능인 동안에는 게이지가 차지 않는다
      if (this.readyIds.includes(c.id)) continue;
      c.gauge += (effectiveSpd(c) * dt) / 1000;
      if (c.gauge >= GAUGE_MAX) {
        c.gauge = GAUGE_MAX;
        this.readyIds.push(c.id);
        if (c.team === 'enemy') {
          this.enemyThinkTimers.set(c.id, this.enemyActionDelayMs);
        }
      }
    }
  }

  /** 게이지가 가득 찬 상태에서 벗어나면(제압 보너스로 깎이는 등) readyIds/생각 타이머에서 제외한다. */
  private revokeReadyIfNeeded(c: Character): void {
    if (c.gauge < GAUGE_MAX && this.readyIds.includes(c.id)) {
      this.readyIds = this.readyIds.filter((id) => id !== c.id);
      this.enemyThinkTimers.delete(c.id);
    }
  }

  /** 해당 진영이 새 행동을 시작할 때 그 진영이 입힌 피해 표시를 리셋한다 (규칙: 행동할 때마다 초기화). */
  private resetDamageDisplay(team: Character['team']): void {
    if (team === 'player') this.lastPlayerDamage = 0;
    else this.lastEnemyDamage = 0;
  }

  // -------------------------------------------------------------------------
  // 행동 실행 (일반 공격 / 스킬) — "턴이 활성화된(준비된)" 캐릭터라면 누구든, 언제든 사용 가능.
  // 다른 캐릭터가 먼저 준비되어 있었는지는 상관없다.
  // -------------------------------------------------------------------------
  performAction(actorId: string, key: 'normal' | 'skill', targetId?: string): boolean {
    if (this.status !== 'ongoing') return false;
    if (!this.readyIds.includes(actorId)) return false;
    const actor = this.findById(actorId);
    if (!actor || !actor.alive || actor.suppressed) return false;

    const skillDef = actor.skills[key];

    // 스킬은 아군 전체가 공유하는 SP를 소모한다 (부족하면 사용 불가).
    const spCost = key === 'skill' && actor.team === 'player' ? (skillDef.spCost ?? 0) : 0;
    if (spCost > this.sp) return false;

    const targets = this.resolveTargets(actor, skillDef.targetType, targetId);
    if (!targets.length) return false;

    this.resetDamageDisplay(actor.team);
    if (spCost > 0) {
      this.sp = Math.max(0, this.sp - spCost);
    }
    skillDef.execute({ battle: this, actor, targets });
    if (actor.alive) {
      actor.energy = Math.min(actor.maxEnergy, actor.energy + skillDef.energyGain);
      this.gainSp(actor, skillDef.spGain ?? 0);
    }
    this.finishTurn(actor);
    return true;
  }

  /** 플레이어 캐릭터의 행동으로 공유 SP를 회복시킨다 (적은 SP 시스템에 관여하지 않는다). */
  private gainSp(actor: Character, amount: number): void {
    if (amount <= 0 || actor.team !== 'player') return;
    this.sp = Math.min(this.maxSp, this.sp + amount);
  }

  private finishTurn(actor: Character): void {
    // 턴 기반(N턴) 지속시간은 소유자 자신의 턴이 끝날 때만 감소한다.
    for (const s of [...actor.statuses]) {
      if (s.durationType === 'turn') {
        s.remainingTurns -= 1;
        if (s.remainingTurns <= 0) this.expireStatus(actor, s);
      }
    }
    actor.gauge = 0;
    this.readyIds = this.readyIds.filter((id) => id !== actor.id);
    this.enemyThinkTimers.delete(actor.id);
    this.regenSuppression(actor);
    this.checkBattleEnd();
  }

  /** 적이 행동(일반공격/스킬/필살기)을 마칠 때마다 제압 게이지를 일정량 회복시킨다. */
  private regenSuppression(actor: Character): void {
    if (actor.team !== 'enemy' || !actor.alive) return;
    actor.suppressionGauge = Math.min(actor.maxSuppressionGauge, actor.suppressionGauge + SUPPRESSION_REGEN_PER_ACTION);
  }

  // -------------------------------------------------------------------------
  // 필살기: 게이지/준비 상태와 완전히 무관하게, 에너지가 차면 언제든 즉시 발동.
  // 다른 캐릭터의 진행 중인 턴을 가로채거나 멈추지 않는다.
  // -------------------------------------------------------------------------
  performUltimate(actorId: string, targetId?: string): boolean {
    if (this.status !== 'ongoing') return false;
    const actor = this.findById(actorId);
    if (!actor || !actor.alive || actor.suppressed) return false;
    if (actor.energy < actor.maxEnergy) return false;

    const skillDef = actor.skills.ultimate;
    const targets = this.resolveTargets(actor, skillDef.targetType, targetId);
    if (!targets.length) return false;

    this.resetDamageDisplay(actor.team);
    skillDef.execute({ battle: this, actor, targets });
    actor.energy = 0;
    this.gainSp(actor, skillDef.spGain ?? 0);
    this.regenSuppression(actor);
    this.checkBattleEnd();
    return true;
  }

  private resolveTargets(actor: Character, targetType: TargetType, targetId?: string): Character[] {
    switch (targetType) {
      case 'self':
        return actor.alive ? [actor] : [];
      case 'allEnemies':
        return this.livingEnemies(actor);
      case 'allAllies':
        return this.livingAllies(actor);
      case 'singleEnemy': {
        const pool = this.livingEnemies(actor);
        const t = targetId ? pool.find((c) => c.id === targetId) : pool[0];
        return t ? [t] : [];
      }
      case 'singleAlly': {
        const pool = this.livingAllies(actor);
        const t = targetId ? pool.find((c) => c.id === targetId) : pool[0];
        return t ? [t] : [];
      }
      case 'areaEnemy': {
        const pool = this.livingEnemies(actor);
        const primary = targetId ? pool.find((c) => c.id === targetId) : pool[0];
        return primary ? this.adjacentGroup(primary) : [];
      }
      case 'areaAlly': {
        const pool = this.livingAllies(actor);
        const primary = targetId ? pool.find((c) => c.id === targetId) : pool[0];
        return primary ? this.adjacentGroup(primary) : [];
      }
    }
  }

  /** 범위 공격: 주 목표 + 원래 진형 순서상 바로 좌우에 있는(살아있는) 대상들. */
  private adjacentGroup(primary: Character): Character[] {
    const formation = this.characters.filter((c) => c.team === primary.team);
    const idx = formation.indexOf(primary);
    return [formation[idx - 1], formation[idx], formation[idx + 1]].filter(
      (c): c is Character => !!c && c.alive,
    );
  }

  /** UI가 타겟 선택 시 클릭 가능하게 만들 후보 목록 (단일 타겟류는 대상군 전체를 반환) */
  getValidTargets(actorId: string, targetType: TargetType): Character[] {
    const actor = this.findById(actorId);
    if (!actor) return [];
    switch (targetType) {
      case 'singleEnemy':
      case 'areaEnemy':
      case 'allEnemies':
        return this.livingEnemies(actor);
      case 'singleAlly':
      case 'areaAlly':
      case 'allAllies':
        return this.livingAllies(actor);
      case 'self':
        return actor.alive ? [actor] : [];
    }
  }

  // -------------------------------------------------------------------------
  // 간단한 적 AI
  // -------------------------------------------------------------------------
  private runEnemyAI(actor: Character): void {
    const useSkill = Math.random() < 0.5;
    const key: 'normal' | 'skill' = useSkill ? 'skill' : 'normal';
    const skillDef = actor.skills[key];
    const targetId = this.pickAiTarget(actor, skillDef.targetType);
    this.performAction(actor.id, key, targetId);
  }

  private runEnemyUltimateAI(actor: Character): void {
    const skillDef = actor.skills.ultimate;
    const targetId = this.pickAiTarget(actor, skillDef.targetType);
    this.performUltimate(actor.id, targetId);
  }

  private pickAiTarget(actor: Character, targetType: TargetType): string | undefined {
    const isEnemyPool = targetType === 'singleEnemy' || targetType === 'areaEnemy';
    const isAllyPool = targetType === 'singleAlly' || targetType === 'areaAlly';
    if (!isEnemyPool && !isAllyPool) return undefined;
    const pool = isEnemyPool ? this.livingEnemies(actor) : this.livingAllies(actor);
    if (!pool.length) return undefined;
    return pool.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b)).id;
  }

  // -------------------------------------------------------------------------
  // BattleApi 구현 (스킬 execute() 에서 사용하는 헬퍼)
  // -------------------------------------------------------------------------
  dealDamage(attacker: Character, target: Character, atkMultiplier: number, damageType: DamageType): number {
    if (!target.alive) return 0;
    // 속성은 공격자 고유값(Character.element)을 그대로 쓴다 — 캐릭터마다 가하는 속성이 고정되어 있다.
    const { amount } = computeDamage({ attacker, target, atkMultiplier, damageType, element: attacker.element });

    target.hp = Math.max(0, target.hp - amount);
    target.energy = Math.min(target.maxEnergy, target.energy + HIT_ENERGY_GAIN);
    this.recordDamage(attacker.team, amount);
    this.handlePossibleDeath(target);
    return amount;
  }

  /** 제압 게이지를 소모시킨다. 대상의 행동 게이지가 가득 찬("행동 준비됨") 상태에서 맞히면
   *  5배로 적용되고, 그 대신 대상의 행동 게이지도 50% 깎인다(= 그 적의 턴을 지연시킨다). */
  applySuppression(target: Character, baseAmount: number): void {
    if (!target.alive || baseAmount <= 0 || target.suppressed) return;
    const hitWhileReady = this.isReady(target.id);
    const amount = hitWhileReady ? baseAmount * SUPPRESSION_READY_HIT_MULTIPLIER : baseAmount;
    target.suppressionGauge = Math.max(0, target.suppressionGauge - amount);
    if (hitWhileReady) {
      target.gauge = Math.max(0, target.gauge * (1 - SUPPRESSION_READY_HIT_GAUGE_CUT));
      this.revokeReadyIfNeeded(target);
    }
    if (target.suppressionGauge <= 0) {
      this.triggerSuppression(target);
    }
  }

  /** 제압 발동: 일정 시간 행동불능 상태로 만들고(내성은 effectiveResistances()가 0으로 취급),
   *  제압 게이지는 다시 가득 채워 넣는다 — 다음 제압을 위해서는 또 처음부터 소모시켜야 한다. */
  private triggerSuppression(target: Character): void {
    target.suppressed = true;
    target.suppressedRemainingMs = SUPPRESSION_DURATION_MS;
    target.suppressionGauge = target.maxSuppressionGauge;
    target.gauge = 0;
    this.readyIds = this.readyIds.filter((id) => id !== target.id);
    this.enemyThinkTimers.delete(target.id);
  }

  private applyDotDamage(source: Character, target: Character, amount: number): void {
    if (!target.alive) return;
    target.hp = Math.max(0, target.hp - amount);
    this.recordDamage(source.team, amount);
    this.handlePossibleDeath(target);
  }

  /** attacker 쪽의 "최근 행동 피해량" 표시에 더한다 (해당 진영의 새 행동이 시작될 때 리셋됨). */
  private recordDamage(attackerTeam: Character['team'], amount: number): void {
    if (attackerTeam === 'player') this.lastPlayerDamage += amount;
    else this.lastEnemyDamage += amount;
  }

  private handlePossibleDeath(target: Character): void {
    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      target.gauge = 0;
      target.statuses = [];
      this.readyIds = this.readyIds.filter((id) => id !== target.id);
      this.enemyThinkTimers.delete(target.id);
    }
    this.checkBattleEnd();
  }

  private checkBattleEnd(): void {
    if (this.status !== 'ongoing') return;
    const playersAlive = this.characters.some((c) => c.team === 'player' && c.alive);
    const enemiesAlive = this.characters.some((c) => c.team === 'enemy' && c.alive);
    if (!playersAlive) {
      this.status = 'enemy_win';
    } else if (!enemiesAlive) {
      this.status = 'player_win';
    }
  }

  heal(_caster: Character, target: Character, amount: number): number {
    if (!target.alive) return 0;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + Math.max(0, amount));
    return target.hp - before;
  }

  applyStatus(target: Character, template: StatusTemplate, source: Character): void {
    if (!target.alive) return;
    const instance: StatusEffect = {
      ...template,
      id: `${template.defId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      remainingTurns: template.turns ?? 0,
      remainingMs: template.ms ?? 0,
      msSinceLastTick: 0,
      sourceId: source.id,
      sourceName: source.name,
    };
    const existingIdx = target.statuses.findIndex((s) => s.defId === template.defId);
    if (existingIdx >= 0) target.statuses.splice(existingIdx, 1, instance);
    else target.statuses.push(instance);
  }

  private expireStatus(owner: Character, status: StatusEffect): void {
    owner.statuses = owner.statuses.filter((s) => s.id !== status.id);
  }

  livingAllies(of: Character): Character[] {
    return this.characters.filter((c) => c.alive && c.team === of.team);
  }

  livingEnemies(of: Character): Character[] {
    return this.characters.filter((c) => c.alive && c.team !== of.team);
  }

  rng(): number {
    return Math.random();
  }
}

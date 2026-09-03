import type { BattleApi, Character, StatusEffect, StatusTemplate, TargetType } from './types';
import { createInitialRoster } from './characters';
import { dmgDealtMult, dmgTakenMult, effectiveAtk, effectiveDef, effectiveSpd } from './statusEffects';

/** 이 값만큼 게이지가 차면 턴이 "활성화"된다. spd=100 기준 4초. */
export const GAUGE_MAX = 400;
/** 피격 시 얻는 필살기 에너지 (선딜 없이 피격만으로도 필살기가 채워지도록) */
const HIT_ENERGY_GAIN = 8;
/** 아군 전체가 공유하는 SP(스킬 포인트)의 최대치와 시작값 */
export const MAX_SP = 10;
const STARTING_SP = 3;
/** 적 AI가 "생각하는" 시간 범위(ms) — 준비되자마자 즉시 처리되지 않고 눈에 보이도록 하기 위함.
 *  각 캐릭터마다 독립적으로 부여되므로, 나중에 준비된 캐릭터가 먼저 행동할 수도 있다. */
const ENEMY_THINK_MS_MIN = 450;
const ENEMY_THINK_MS_MAX = 950;

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

  constructor() {
    this.reset();
  }

  reset(): void {
    this.characters = createInitialRoster();
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

    // 시간 기반 상태이상(화상/중독/재생 등)은 대상 선택 중에도 턴과 무관하게 계속 흐른다 (규칙 5).
    this.tickTimeBasedStatuses(dt);
    if (this.status !== 'ongoing') return;

    // 대상 선택 중에는 모든 캐릭터의 행동 게이지 충전과 적의 행동 진행이 멈춘다.
    if (!this.targetSelectionPaused) {
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
    // (플레이어 캐릭터는 UI 버튼으로 직접 트리거하고, 적은 자동으로 즉시 사용한다)
    for (const c of this.characters) {
      if (c.alive && c.team === 'enemy' && c.energy >= c.maxEnergy) {
        this.runEnemyUltimateAI(c);
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
            const amount = Math.max(1, Math.round(effectiveAtk(source) * s.tick.atkMultiplier));
            if (s.tick.isHeal) {
              this.heal(source, c, amount);
            } else {
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
      if (!c.alive) continue;
      if (this.readyIds.includes(c.id)) continue;
      c.gauge += (effectiveSpd(c) * dt) / 1000;
      if (c.gauge >= GAUGE_MAX) {
        c.gauge = GAUGE_MAX;
        this.readyIds.push(c.id);
        if (c.team === 'enemy') {
          this.enemyThinkTimers.set(c.id, ENEMY_THINK_MS_MIN + Math.random() * (ENEMY_THINK_MS_MAX - ENEMY_THINK_MS_MIN));
        }
      }
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
    if (!actor || !actor.alive) return false;

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
    this.checkBattleEnd();
  }

  // -------------------------------------------------------------------------
  // 필살기: 게이지/준비 상태와 완전히 무관하게, 에너지가 차면 언제든 즉시 발동.
  // 다른 캐릭터의 진행 중인 턴을 가로채거나 멈추지 않는다.
  // -------------------------------------------------------------------------
  performUltimate(actorId: string, targetId?: string): boolean {
    if (this.status !== 'ongoing') return false;
    const actor = this.findById(actorId);
    if (!actor || !actor.alive) return false;
    if (actor.energy < actor.maxEnergy) return false;

    const skillDef = actor.skills.ultimate;
    const targets = this.resolveTargets(actor, skillDef.targetType, targetId);
    if (!targets.length) return false;

    this.resetDamageDisplay(actor.team);
    skillDef.execute({ battle: this, actor, targets });
    actor.energy = 0;
    this.gainSp(actor, skillDef.spGain ?? 0);
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
    }
  }

  /** UI가 타겟 선택 시 클릭 가능하게 만들 후보 목록 (단일 타겟류는 대상군 전체를 반환) */
  getValidTargets(actorId: string, targetType: TargetType): Character[] {
    const actor = this.findById(actorId);
    if (!actor) return [];
    switch (targetType) {
      case 'singleEnemy':
      case 'allEnemies':
        return this.livingEnemies(actor);
      case 'singleAlly':
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
    if (targetType !== 'singleEnemy' && targetType !== 'singleAlly') return undefined;
    const pool = targetType === 'singleEnemy' ? this.livingEnemies(actor) : this.livingAllies(actor);
    if (!pool.length) return undefined;
    return pool.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b)).id;
  }

  // -------------------------------------------------------------------------
  // 턴 순서 미리보기 (속도 기반 예측, 실제 상태를 변경하지 않는 시뮬레이션)
  // 참고: 이미 준비된 캐릭터들 사이의 실제 행동 순서는 강제되지 않으므로,
  // 이 목록은 "누가 먼저 준비되는지"에 대한 참고용 예측일 뿐이다.
  // -------------------------------------------------------------------------
  getTurnOrderPreview(count = 8): Character[] {
    const living = this.characters.filter((c) => c.alive);
    if (!living.length) return [];

    const order: string[] = [...this.readyIds];

    const sim = new Map(living.map((c) => [c.id, { gauge: c.gauge, spd: effectiveSpd(c) }]));
    for (const id of order) {
      const s = sim.get(id);
      if (s) s.gauge = 0;
    }

    while (order.length < count) {
      let bestId: string | null = null;
      let bestTime = Infinity;
      for (const c of living) {
        const s = sim.get(c.id)!;
        const t = (GAUGE_MAX - s.gauge) / s.spd;
        if (t < bestTime) {
          bestTime = t;
          bestId = c.id;
        }
      }
      if (!bestId) break;
      order.push(bestId);
      for (const c of living) {
        sim.get(c.id)!.gauge += sim.get(c.id)!.spd * bestTime;
      }
      sim.get(bestId)!.gauge = 0;
    }

    return order
      .slice(0, count)
      .map((id) => this.findById(id))
      .filter((c): c is Character => !!c);
  }

  // -------------------------------------------------------------------------
  // BattleApi 구현 (스킬 execute() 에서 사용하는 헬퍼)
  // -------------------------------------------------------------------------
  dealDamage(attacker: Character, target: Character, atkMultiplier: number): number {
    if (!target.alive) return 0;
    const atk = effectiveAtk(attacker);
    const def = effectiveDef(target);
    let raw = atk * atkMultiplier - def * 0.5;
    raw = Math.max(raw, atk * atkMultiplier * 0.15);
    let dmg = raw * dmgDealtMult(attacker) * dmgTakenMult(target);
    const isCrit = Math.random() < 0.15;
    if (isCrit) dmg *= 1.5;
    dmg *= 0.9 + Math.random() * 0.2;
    const finalDmg = Math.max(1, Math.round(dmg));

    target.hp = Math.max(0, target.hp - finalDmg);
    target.energy = Math.min(target.maxEnergy, target.energy + HIT_ENERGY_GAIN);
    this.recordDamage(attacker.team, finalDmg);
    this.handlePossibleDeath(target);
    return finalDmg;
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

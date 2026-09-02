import type { BattleApi, Character, LogKind, StatusEffect, StatusTemplate, TargetType } from './types';
import { createInitialRoster } from './characters';
import { dmgDealtMult, dmgTakenMult, effectiveAtk, effectiveDef, effectiveSpd } from './statusEffects';

/** 이 값만큼 게이지가 차면 턴이 "활성화"된다. spd=100 기준 4초. */
export const GAUGE_MAX = 400;
/** 피격 시 얻는 필살기 에너지 (선딜 없이 피격만으로도 필살기가 채워지도록) */
const HIT_ENERGY_GAIN = 8;
/** 적 AI가 "생각하는" 시간 범위(ms) — 즉시 처리되지 않고 눈에 보이도록 하기 위함 */
const ENEMY_THINK_MS_MIN = 450;
const ENEMY_THINK_MS_MAX = 950;

export type BattleStatus = 'ongoing' | 'player_win' | 'enemy_win';

export interface LogEntry {
  id: number;
  time: number; // battleTimeMs 기준 초 단위, 소수 1자리
  kind: LogKind;
  message: string;
}

let logSeq = 0;

export class BattleEngine implements BattleApi {
  characters: Character[] = [];
  readyQueue: string[] = [];
  activeId: string | null = null;
  status: BattleStatus = 'ongoing';
  logs: LogEntry[] = [];
  battleTimeMs = 0;
  paused = false;
  timeScale = 1;

  private enemyThinkMs = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.characters = createInitialRoster();
    this.readyQueue = [];
    this.activeId = null;
    this.status = 'ongoing';
    this.logs = [];
    this.battleTimeMs = 0;
    this.enemyThinkMs = 0;
    this.log('전투 시작!', 'info');
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  findById(id: string | null | undefined): Character | undefined {
    if (!id) return undefined;
    return this.characters.find((c) => c.id === id);
  }

  // -------------------------------------------------------------------------
  // 메인 루프: 매 프레임 호출된다 (real dt를 ms 단위로 전달)
  // -------------------------------------------------------------------------
  update(realDtMs: number): void {
    if (this.status !== 'ongoing') return;
    const dt = this.paused ? 0 : realDtMs * this.timeScale;
    if (dt <= 0) return;
    this.battleTimeMs += dt;

    this.tickTimeBasedStatuses(dt);
    if (this.status !== 'ongoing') return;

    this.chargeGauges(dt);

    if (!this.activeId && this.readyQueue.length > 0) {
      const nextId = this.readyQueue.shift()!;
      const next = this.findById(nextId);
      if (next && next.alive) {
        this.activeId = nextId;
        this.log(`— ${next.name}의 턴 —`, 'action');
        if (next.team === 'enemy') {
          this.enemyThinkMs = ENEMY_THINK_MS_MIN + Math.random() * (ENEMY_THINK_MS_MAX - ENEMY_THINK_MS_MIN);
        }
      }
    }

    if (this.activeId) {
      const active = this.findById(this.activeId);
      if (active && active.team === 'enemy' && active.alive) {
        this.enemyThinkMs -= dt;
        if (this.enemyThinkMs <= 0) {
          this.runEnemyAI(active);
        }
      }
    }

    // 필살기는 게이지/대기열과 무관하게, 자신의 턴이 아니어도 에너지가 차면 즉시 사용 가능.
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
              this.applyDotDamage(c, amount, s.name);
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
      if (c.id === this.activeId) continue;
      if (this.readyQueue.includes(c.id)) continue;
      c.gauge += (effectiveSpd(c) * dt) / 1000;
      if (c.gauge >= GAUGE_MAX) {
        c.gauge = GAUGE_MAX;
        this.readyQueue.push(c.id);
        this.log(`${c.name}의 턴이 활성화되었습니다.`, 'ready');
      }
    }
  }

  // -------------------------------------------------------------------------
  // 행동 실행 (일반 공격 / 스킬) — 반드시 "현재 활성화된 턴"의 캐릭터만 사용 가능
  // -------------------------------------------------------------------------
  performAction(actorId: string, key: 'normal' | 'skill', targetId?: string): boolean {
    if (this.status !== 'ongoing') return false;
    if (this.activeId !== actorId) return false;
    const actor = this.findById(actorId);
    if (!actor || !actor.alive) return false;

    const skillDef = actor.skills[key];
    const targets = this.resolveTargets(actor, skillDef.targetType, targetId);
    if (!targets.length) return false;

    this.log(`${actor.name}의 [${skillDef.name}]!`, 'action');
    skillDef.execute({ battle: this, actor, targets });
    if (actor.alive) {
      actor.energy = Math.min(actor.maxEnergy, actor.energy + skillDef.energyGain);
    }
    this.finishTurn(actor);
    return true;
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
    if (this.activeId === actor.id) this.activeId = null;
    this.checkBattleEnd();
  }

  // -------------------------------------------------------------------------
  // 필살기: 게이지/대기열/활성 턴과 완전히 무관하게, 에너지가 차면 언제든 즉시 발동.
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

    this.log(`💫 ${actor.name}의 필살기 [${skillDef.name}]! (턴 순서와 무관하게 즉시 발동)`, 'ultimate');
    skillDef.execute({ battle: this, actor, targets });
    actor.energy = 0;
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
  // -------------------------------------------------------------------------
  getTurnOrderPreview(count = 8): Character[] {
    const living = this.characters.filter((c) => c.alive);
    if (!living.length) return [];

    const order: string[] = [];
    if (this.activeId) order.push(this.activeId);
    order.push(...this.readyQueue);

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
    this.log(`${attacker.name} → ${target.name} : ${finalDmg} 피해${isCrit ? ' (치명타!)' : ''}`, 'damage');
    this.handlePossibleDeath(target);
    return finalDmg;
  }

  private applyDotDamage(target: Character, amount: number, label: string): void {
    if (!target.alive) return;
    target.hp = Math.max(0, target.hp - amount);
    this.log(`[${label}] ${target.name}이(가) ${amount}의 피해를 입었습니다.`, 'debuff');
    this.handlePossibleDeath(target);
  }

  private handlePossibleDeath(target: Character): void {
    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      target.gauge = 0;
      target.statuses = [];
      this.log(`${target.name} 전투불능!`, 'defeat');
      this.readyQueue = this.readyQueue.filter((id) => id !== target.id);
      if (this.activeId === target.id) this.activeId = null;
    }
    this.checkBattleEnd();
  }

  private checkBattleEnd(): void {
    if (this.status !== 'ongoing') return;
    const playersAlive = this.characters.some((c) => c.team === 'player' && c.alive);
    const enemiesAlive = this.characters.some((c) => c.team === 'enemy' && c.alive);
    if (!playersAlive) {
      this.status = 'enemy_win';
      this.log('전멸했습니다... 패배.', 'defeat');
    } else if (!enemiesAlive) {
      this.status = 'player_win';
      this.log('적을 모두 물리쳤습니다! 승리!', 'defeat');
    }
  }

  heal(caster: Character, target: Character, amount: number): number {
    if (!target.alive) return 0;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + Math.max(0, amount));
    const healed = target.hp - before;
    if (healed > 0) {
      this.log(`${caster.name} → ${target.name} : 체력 ${healed} 회복`, 'heal');
    }
    return healed;
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

    const durationLabel =
      template.durationType === 'turn' ? `${template.turns}턴` : `${((template.ms ?? 0) / 1000).toFixed(1)}초`;
    this.log(
      `${target.name}에게 [${template.icon} ${template.name}] ${template.kind === 'buff' ? '부여' : '적용'} (${durationLabel})`,
      template.kind,
    );
  }

  private expireStatus(owner: Character, status: StatusEffect): void {
    owner.statuses = owner.statuses.filter((s) => s.id !== status.id);
    this.log(`${owner.name}의 [${status.icon} ${status.name}] 효과가 종료되었습니다.`, 'info');
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

  log(message: string, kind: LogKind): void {
    logSeq += 1;
    this.logs.push({ id: logSeq, time: Math.round(this.battleTimeMs) / 1000, kind, message });
    if (this.logs.length > 200) this.logs.shift();
  }
}

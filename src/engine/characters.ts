import type { Character, SkillDef } from './types';
import { effectiveAtk } from './statusEffects';
import {
  ArmorBreak,
  Blessing,
  Burn,
  Curse,
  IronWall,
  Poison,
  Rage,
  Regen,
} from './statusEffects';

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}_${uid}`;
}

// ---------------------------------------------------------------------------
// 전사 브란 (Warrior) — 균형형, 턴 기반 버프/디버프를 사용
// ---------------------------------------------------------------------------
function warriorSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'warrior_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 물리 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.0);
    },
  };
  const skill: SkillDef = {
    id: 'warrior_skill',
    name: '방패 강타',
    type: 'skill',
    description: '적 1명에게 피해를 입히고 방어를 무너뜨리며, 자신은 철벽 태세에 들어갑니다. (턴 기반 지속시간)',
    targetType: 'singleEnemy',
    energyGain: 20,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.2);
      battle.applyStatus(targets[0], ArmorBreak, actor);
      battle.applyStatus(actor, IronWall, actor);
    },
  };
  const ultimate: SkillDef = {
    id: 'warrior_ultimate',
    name: '파괴의 일격',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 적 1명에게 압도적인 피해를 입히고 피해의 일부만큼 회복합니다.',
    targetType: 'singleEnemy',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      const dmg = battle.dealDamage(actor, targets[0], 2.4);
      battle.heal(actor, actor, Math.round(dmg * 0.15));
    },
  };
  return { normal, skill, ultimate };
}

// ---------------------------------------------------------------------------
// 화염 마도사 리엘 (Mage) — 고속, 시간 기반 화상(DOT)을 사용
// ---------------------------------------------------------------------------
function mageSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'mage_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 마법 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.9);
    },
  };
  const skill: SkillDef = {
    id: 'mage_skill',
    name: '화염구',
    type: 'skill',
    description: '적 전체에게 마법 피해를 입히고 화상을 부여합니다. (시간 기반 지속시간, 매초 도트 피해)',
    targetType: 'allEnemies',
    energyGain: 20,
    execute: ({ battle, actor, targets }) => {
      for (const t of targets) {
        battle.dealDamage(actor, t, 0.7);
        battle.applyStatus(t, Burn, actor);
      }
    },
  };
  const ultimate: SkillDef = {
    id: 'mage_ultimate',
    name: '메테오',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 적 전체에게 강력한 마법 피해를 입힙니다.',
    targetType: 'allEnemies',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      for (const t of targets) {
        battle.dealDamage(actor, t, 1.5);
      }
    },
  };
  return { normal, skill, ultimate };
}

// ---------------------------------------------------------------------------
// 성기사 세라 (Healer) — 저속, 시간 기반 재생 + 턴 기반 보호막을 사용
// ---------------------------------------------------------------------------
function healerSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'healer_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 약한 빛 속성 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.7);
    },
  };
  const skill: SkillDef = {
    id: 'healer_skill',
    name: '치유의 빛',
    type: 'skill',
    description: '아군 1명을 즉시 회복시키고 재생 효과를 부여합니다. (시간 기반 지속시간, 매초 회복)',
    targetType: 'singleAlly',
    energyGain: 20,
    execute: ({ battle, actor, targets }) => {
      const amount = Math.round(effectiveAtk(actor) * 0.9 + targets[0].maxHp * 0.08);
      battle.heal(actor, targets[0], amount);
      battle.applyStatus(targets[0], Regen, actor);
    },
  };
  const ultimate: SkillDef = {
    id: 'healer_ultimate',
    name: '천사의 축복',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 아군 전체를 회복시키고 받는 피해를 줄여주는 가호를 겁니다. (턴 기반 지속시간)',
    targetType: 'allAllies',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      for (const t of targets) {
        const amount = Math.round(effectiveAtk(actor) * 0.7 + t.maxHp * 0.1);
        battle.heal(actor, t, amount);
        battle.applyStatus(t, Blessing, actor);
      }
    },
  };
  return { normal, skill, ultimate };
}

// ---------------------------------------------------------------------------
// 오크 전사 (Enemy) — 턴 기반 자강 버프
// ---------------------------------------------------------------------------
function orcSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'orc_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 물리 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.0);
    },
  };
  const skill: SkillDef = {
    id: 'orc_skill',
    name: '분쇄',
    type: 'skill',
    description: '적 1명에게 강한 피해를 입히고 자신의 공격력을 올립니다. (턴 기반 지속시간)',
    targetType: 'singleEnemy',
    energyGain: 20,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.3);
      battle.applyStatus(actor, Rage, actor);
    },
  };
  const ultimate: SkillDef = {
    id: 'orc_ultimate',
    name: '광폭화 강타',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 적 1명에게 압도적인 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 2.0);
    },
  };
  return { normal, skill, ultimate };
}

// ---------------------------------------------------------------------------
// 다크 샤먼 (Enemy) — 턴 기반 저주 + 시간 기반 중독
// ---------------------------------------------------------------------------
function shamanSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'shaman_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 마법 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.85);
    },
  };
  const skill: SkillDef = {
    id: 'shaman_skill',
    name: '저주',
    type: 'skill',
    description: '적 1명에게 피해를 입히고 방어력을 낮추는 저주를 겁니다. (턴 기반 지속시간)',
    targetType: 'singleEnemy',
    energyGain: 20,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.5);
      battle.applyStatus(targets[0], Curse, actor);
    },
  };
  const ultimate: SkillDef = {
    id: 'shaman_ultimate',
    name: '죽음의 저주',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 적 전체에게 피해를 입히고 중독시킵니다. (시간 기반 지속시간, 매초 도트 피해)',
    targetType: 'allEnemies',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      for (const t of targets) {
        battle.dealDamage(actor, t, 1.1);
        battle.applyStatus(t, Poison, actor);
      }
    },
  };
  return { normal, skill, ultimate };
}

function makeCharacter(
  name: string,
  team: Character['team'],
  portrait: string,
  base: Character['base'],
  skills: Character['skills'],
): Character {
  return {
    id: nextId(team),
    name,
    team,
    portrait,
    base,
    hp: base.hp,
    maxHp: base.hp,
    gauge: 0,
    energy: 0,
    maxEnergy: 100,
    alive: true,
    statuses: [],
    skills,
  };
}

export function createInitialRoster(): Character[] {
  // uid는 리셋하지 않는다 — 재시작 후에도 캐릭터 id가 이전 전투와 겹치지 않도록 보장한다.
  return [
    makeCharacter('전사 브란', 'player', '🗡️', { hp: 1400, atk: 130, def: 90, spd: 100 }, warriorSkills()),
    makeCharacter('화염 마도사 리엘', 'player', '🔥', { hp: 950, atk: 150, def: 55, spd: 125 }, mageSkills()),
    makeCharacter('성기사 세라', 'player', '✨', { hp: 1150, atk: 110, def: 70, spd: 95 }, healerSkills()),
    makeCharacter('오크 전사', 'enemy', '👹', { hp: 1300, atk: 120, def: 80, spd: 105 }, orcSkills()),
    makeCharacter('다크 샤먼', 'enemy', '🧙', { hp: 1000, atk: 125, def: 60, spd: 115 }, shamanSkills()),
  ];
}

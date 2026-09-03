import type { Character, SkillDef } from './types';
import { effectiveAtk } from './statusEffects';
import {
  ArmorBreak,
  Blessing,
  Bulwark,
  Burn,
  Curse,
  IronWall,
  Poison,
  Rage,
  Regen,
  Sprint,
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
    description: '적 1명에게 물리 피해를 입힙니다. SP를 1 회복합니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    spGain: 1,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.0);
    },
  };
  const skill: SkillDef = {
    id: 'warrior_skill',
    name: '방패 강타',
    type: 'skill',
    description: 'SP 1을 소모해 적 1명에게 피해를 입히고 방어를 무너뜨리며, 자신은 철벽 태세에 들어갑니다. (턴 기반 지속시간)',
    targetType: 'singleEnemy',
    energyGain: 20,
    spCost: 1,
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
    description: '적 1명에게 마법 피해를 입힙니다. SP를 1 회복합니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    spGain: 1,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.9);
    },
  };
  const skill: SkillDef = {
    id: 'mage_skill',
    name: '화염구',
    type: 'skill',
    description: 'SP 2를 소모해 적 전체에게 마법 피해를 입히고 화상을 부여합니다. (시간 기반 지속시간, 매초 도트 피해)',
    targetType: 'allEnemies',
    energyGain: 20,
    spCost: 2,
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
    description: '적 1명에게 약한 빛 속성 피해를 입힙니다. SP를 1 회복합니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    spGain: 1,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.7);
    },
  };
  const skill: SkillDef = {
    id: 'healer_skill',
    name: '치유의 빛',
    type: 'skill',
    description: 'SP 1을 소모해 아군 1명을 즉시 회복시키고 재생 효과를 부여합니다. (시간 기반 지속시간, 매초 회복)',
    targetType: 'singleAlly',
    energyGain: 20,
    spCost: 1,
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
    description:
      '자신의 턴이 아니어도 즉시 발동. 아군 전체를 회복시키고 받는 피해를 줄여주는 가호를 겁니다. (턴 기반 지속시간) SP를 2 회복합니다.',
    targetType: 'allAllies',
    energyGain: 0,
    spGain: 2,
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
// 암살자 카인 (Assassin) — 최고속, SP를 소모하지 않는 스킬을 사용
// ---------------------------------------------------------------------------
function assassinSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'assassin_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 물리 피해를 입힙니다. SP를 1 회복합니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    spGain: 1,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.0);
    },
  };
  const skill: SkillDef = {
    id: 'assassin_skill',
    name: '그림자 일격',
    type: 'skill',
    description: 'SP를 소모하지 않고 즉시 사용할 수 있는 기습기. 적 1명에게 강한 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 20,
    spCost: 0,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.4);
    },
  };
  const ultimate: SkillDef = {
    id: 'assassin_ultimate',
    name: '일격필살',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 적 1명에게 압도적인 단일 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 2.6);
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

// ---------------------------------------------------------------------------
// 고블린 정찰병 (Enemy) — 매우 빠름, 턴 기반 가속 버프
// ---------------------------------------------------------------------------
function goblinScoutSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'goblin_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 물리 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.9);
    },
  };
  const skill: SkillDef = {
    id: 'goblin_skill',
    name: '급습',
    type: 'skill',
    description: '적 1명에게 피해를 입히고 자신의 속도를 올립니다. (턴 기반 지속시간)',
    targetType: 'singleEnemy',
    energyGain: 20,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.1);
      battle.applyStatus(actor, Sprint, actor);
    },
  };
  const ultimate: SkillDef = {
    id: 'goblin_ultimate',
    name: '연속 베기',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 적 1명에게 강한 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.8);
    },
  };
  return { normal, skill, ultimate };
}

// ---------------------------------------------------------------------------
// 스켈레톤 방패병 (Enemy) — 느리고 매우 단단함, 턴 기반 방어 버프
// ---------------------------------------------------------------------------
function skeletonGuardSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'skeleton_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 물리 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.8);
    },
  };
  const skill: SkillDef = {
    id: 'skeleton_skill',
    name: '철벽 방어',
    type: 'skill',
    description: '적 1명에게 약한 피해를 입히고 자신의 방어력을 크게 올립니다. (턴 기반 지속시간)',
    targetType: 'singleEnemy',
    energyGain: 20,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.6);
      battle.applyStatus(actor, Bulwark, actor);
    },
  };
  const ultimate: SkillDef = {
    id: 'skeleton_ultimate',
    name: '대지 강타',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 적 1명에게 강한 피해를 입히고 방어를 무너뜨립니다. (턴 기반 지속시간)',
    targetType: 'singleEnemy',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.7);
      battle.applyStatus(targets[0], ArmorBreak, actor);
    },
  };
  return { normal, skill, ultimate };
}

// ---------------------------------------------------------------------------
// 다크엘프 궁수 (Enemy) — 원거리 물리, 턴 기반 방어 파괴
// ---------------------------------------------------------------------------
function darkElfArcherSkills(): Character['skills'] {
  const normal: SkillDef = {
    id: 'archer_normal',
    name: '일반 공격',
    type: 'normal',
    description: '적 1명에게 물리 피해를 입힙니다.',
    targetType: 'singleEnemy',
    energyGain: 15,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 0.9);
    },
  };
  const skill: SkillDef = {
    id: 'archer_skill',
    name: '관통 사격',
    type: 'skill',
    description: '적 1명에게 피해를 입히고 방어력을 낮춥니다. (턴 기반 지속시간)',
    targetType: 'singleEnemy',
    energyGain: 20,
    execute: ({ battle, actor, targets }) => {
      battle.dealDamage(actor, targets[0], 1.2);
      battle.applyStatus(targets[0], ArmorBreak, actor);
    },
  };
  const ultimate: SkillDef = {
    id: 'archer_ultimate',
    name: '우박 화살',
    type: 'ultimate',
    description: '자신의 턴이 아니어도 즉시 발동. 적 전체에게 피해를 입힙니다.',
    targetType: 'allEnemies',
    energyGain: 0,
    execute: ({ battle, actor, targets }) => {
      for (const t of targets) {
        battle.dealDamage(actor, t, 1.3);
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

/** 파티 편성 화면에 캐릭터를 나열하기 위한 설계도 (아직 전투 인스턴스가 아니다) */
export interface PlayerCharacterDef {
  key: string;
  name: string;
  portrait: string;
  base: Character['base'];
  makeSkills: () => Character['skills'];
}

/** 편성 가능한 아군 전체 목록 — 최대 4명까지 이 중에서 선택해 전투에 데려간다. */
export const PLAYER_CHARACTER_DEFS: PlayerCharacterDef[] = [
  { key: 'warrior', name: '전사 브란', portrait: '🗡️', base: { hp: 1750, atk: 130, def: 105, spd: 100 }, makeSkills: warriorSkills },
  { key: 'mage', name: '화염 마도사 리엘', portrait: '🔥', base: { hp: 1100, atk: 150, def: 60, spd: 125 }, makeSkills: mageSkills },
  { key: 'healer', name: '성기사 세라', portrait: '✨', base: { hp: 1350, atk: 110, def: 80, spd: 95 }, makeSkills: healerSkills },
  { key: 'assassin', name: '암살자 카인', portrait: '🥷', base: { hp: 1050, atk: 145, def: 55, spd: 140 }, makeSkills: assassinSkills },
];

/** 이 데모의 적 편성(고정) — 최대 5마리까지 동시에 등장한다. */
const ENEMY_DEFS: PlayerCharacterDef[] = [
  { key: 'orc', name: '오크 전사', portrait: '👹', base: { hp: 1300, atk: 120, def: 80, spd: 105 }, makeSkills: orcSkills },
  { key: 'shaman', name: '다크 샤먼', portrait: '🧙', base: { hp: 1000, atk: 125, def: 60, spd: 115 }, makeSkills: shamanSkills },
  { key: 'goblin', name: '고블린 정찰병', portrait: '👺', base: { hp: 850, atk: 100, def: 45, spd: 130 }, makeSkills: goblinScoutSkills },
  { key: 'skeleton', name: '스켈레톤 방패병', portrait: '💀', base: { hp: 1600, atk: 90, def: 110, spd: 80 }, makeSkills: skeletonGuardSkills },
  { key: 'archer', name: '다크엘프 궁수', portrait: '🏹', base: { hp: 950, atk: 130, def: 55, spd: 110 }, makeSkills: darkElfArcherSkills },
];

/** 파티 편성 화면에서 선택된 아군 키(1~4명)로 실제 전투 로스터를 만든다. */
export function createBattleRoster(selectedPlayerKeys: string[]): Character[] {
  // uid는 리셋하지 않는다 — 재시작 후에도 캐릭터 id가 이전 전투와 겹치지 않도록 보장한다.
  const players = PLAYER_CHARACTER_DEFS.filter((def) => selectedPlayerKeys.includes(def.key)).map((def) =>
    makeCharacter(def.name, 'player', def.portrait, def.base, def.makeSkills()),
  );
  const enemies = ENEMY_DEFS.map((def) => makeCharacter(def.name, 'enemy', def.portrait, def.base, def.makeSkills()));
  return [...players, ...enemies];
}

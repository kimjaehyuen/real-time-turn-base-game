import type { PlayerCharacterDef } from '../engine/characters';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SKILL_LABELS: Record<'normal' | 'skill' | 'ultimate', string> = {
  normal: '일반공격',
  skill: '스킬',
  ultimate: '필살기',
};

/** 파티 편성 화면의 캐릭터 카드 그리드를 그린다. 스탯/스킬은 매번 새로 만들어도 무방할 만큼 가볍다. */
export function renderPartySelect(defs: PlayerCharacterDef[], selectedKeys: ReadonlySet<string>, onToggle: (key: string) => void): void {
  const container = document.getElementById('party-select-grid');
  if (!container) return;
  container.innerHTML = '';

  for (const def of defs) {
    const card = el('div', `party-card${selectedKeys.has(def.key) ? ' selected' : ''}`);
    card.addEventListener('click', () => onToggle(def.key));

    const head = el('div', 'party-card-head');
    head.appendChild(el('div', 'party-card-portrait', def.portrait));
    const nameCol = el('div', 'party-card-name-col');
    nameCol.appendChild(el('div', 'party-card-name', def.name));
    nameCol.appendChild(el('div', 'party-card-check', selectedKeys.has(def.key) ? '✓ 선택됨' : '선택 안 함'));
    head.appendChild(nameCol);
    card.appendChild(head);

    const stats = el('div', 'party-card-stats');
    const statEntries: [string, number][] = [
      ['공격력', def.base.atk],
      ['체력', def.base.hp],
      ['방어력', def.base.def],
      ['속도', def.base.spd],
    ];
    for (const [label, value] of statEntries) {
      const row = el('div', 'stat-row');
      row.appendChild(el('span', 'stat-label', label));
      row.appendChild(el('span', 'stat-value', String(value)));
      stats.appendChild(row);
    }
    card.appendChild(stats);

    const skillsWrap = el('div', 'party-card-skills');
    const skills = def.makeSkills();
    (['normal', 'skill', 'ultimate'] as const).forEach((key) => {
      const s = skills[key];
      const row = el('div', 'party-skill-row');
      row.appendChild(el('div', 'party-skill-name', `${SKILL_LABELS[key]} · ${s.name}`));
      row.appendChild(el('div', 'party-skill-desc', s.description));
      skillsWrap.appendChild(row);
    });
    card.appendChild(skillsWrap);

    container.appendChild(card);
  }
}

// src/ui/armor-swap.js — K key opens armor set swap dialog.
// Each armor set provides sprites for all body part slots.
// Sprites overlay on the assembled FK rig via the existing equipment system.

const ARMOR_SETS = {
  none: { name: 'No Armor', pieces: {} },
  dark_lord: {
    name: 'Dark Lord',
    pieces: {
      head:      '/assets/pixelab/equipment/dark_lord/head.png',
      torso:     '/assets/pixelab/equipment/dark_lord/torso.png',
      arm_upper: '/assets/pixelab/equipment/dark_lord/arm_upper.png',
      arm_fore:  '/assets/pixelab/equipment/dark_lord/arm_fore.png',
      hand:      '/assets/pixelab/equipment/dark_lord/hand.png',
      thigh:     '/assets/pixelab/equipment/dark_lord/thigh.png',
      shin:      '/assets/pixelab/equipment/dark_lord/shin.png',
      foot:      '/assets/pixelab/equipment/dark_lord/foot.png',
    },
  },
  desert_ranger: {
    name: 'Desert Ranger',
    pieces: {
      head:      '/assets/pixelab/equipment/desert_ranger/head.png',
      torso:     '/assets/pixelab/equipment/desert_ranger/torso.png',
      arm_upper: '/assets/pixelab/equipment/desert_ranger/arm_upper.png',
      arm_fore:  '/assets/pixelab/equipment/desert_ranger/arm_fore.png',
      hand:      '/assets/pixelab/equipment/desert_ranger/hand.png',
      thigh:     '/assets/pixelab/equipment/desert_ranger/thigh.png',
      shin:      '/assets/pixelab/equipment/desert_ranger/shin.png',
      foot:      '/assets/pixelab/equipment/desert_ranger/foot.png',
    },
  },
  golden_paladin: {
    name: 'Golden Paladin',
    pieces: {
      head:      '/assets/pixelab/equipment/golden_paladin/head.png',
      torso:     '/assets/pixelab/equipment/golden_paladin/torso.png',
      arm_upper: '/assets/pixelab/equipment/golden_paladin/arm_upper.png',
      arm_fore:  '/assets/pixelab/equipment/golden_paladin/arm_fore.png',
      hand:      '/assets/pixelab/equipment/golden_paladin/hand.png',
      thigh:     '/assets/pixelab/equipment/golden_paladin/thigh.png',
      shin:      '/assets/pixelab/equipment/golden_paladin/shin.png',
      foot:      '/assets/pixelab/equipment/golden_paladin/foot.png',
    },
  },
};

// Map armor piece slots to rig bone names (L/R pairs share the same sprite, mirrored)
const SLOT_TO_BONES = {
  head:      ['head'],
  torso:     ['spine'],
  arm_upper: ['arm_u_l', 'arm_u_r'],
  arm_fore:  ['arm_f_l', 'arm_f_r'],
  hand:      ['hand_l', 'hand_r'],
  thigh:     ['thigh_l', 'thigh_r'],
  shin:      ['shin_l', 'shin_r'],
  foot:      ['foot_l', 'foot_r'],
};

let _container = null;
let _open = false;
let _currentSet = 'none';
let _onEquipChange = null; // callback when set changes

export function initArmorSwap(onEquipChange) {
  _onEquipChange = onEquipChange;

  _container = document.createElement('div');
  _container.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1000;display:none;background:rgba(0,0,0,0.9);border:1px solid #555;border-radius:10px;padding:16px;min-width:280px;';

  const title = document.createElement('div');
  title.textContent = 'Armor Sets (K)';
  title.style.cssText = 'color:#9af;font:bold 16px monospace;margin-bottom:12px;text-align:center;';
  _container.appendChild(title);

  for (const [id, set] of Object.entries(ARMOR_SETS)) {
    const btn = document.createElement('button');
    btn.textContent = set.name;
    btn.dataset.setId = id;
    btn.style.cssText = 'display:block;width:100%;padding:8px 12px;margin:4px 0;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;font:14px monospace;cursor:pointer;text-align:left;';
    btn.onmouseenter = () => { btn.style.background = '#335'; };
    btn.onmouseleave = () => { btn.style.background = id === _currentSet ? '#446' : '#222'; };
    btn.onclick = () => selectSet(id);
    _container.appendChild(btn);
  }

  const hint = document.createElement('div');
  hint.textContent = 'Press K or Esc to close';
  hint.style.cssText = 'color:#555;font:11px monospace;margin-top:8px;text-align:center;';
  _container.appendChild(hint);

  document.body.appendChild(_container);

  window.addEventListener('keydown', e => {
    if (e.key === 'k' || e.key === 'K') {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      _open ? closeSwap() : openSwap();
    }
    if (e.key === 'Escape' && _open) closeSwap();
  });
}

function openSwap() {
  _open = true;
  _container.style.display = 'block';
  updateButtons();
}

function closeSwap() {
  _open = false;
  _container.style.display = 'none';
}

function updateButtons() {
  _container.querySelectorAll('button').forEach(btn => {
    btn.style.background = btn.dataset.setId === _currentSet ? '#446' : '#222';
    btn.style.borderColor = btn.dataset.setId === _currentSet ? '#88f' : '#444';
  });
}

function selectSet(id) {
  _currentSet = id;
  updateButtons();
  if (_onEquipChange) _onEquipChange(id, ARMOR_SETS[id]);
  closeSwap();
}

export function getCurrentArmorSet() { return _currentSet; }
export function getArmorSetData(id) { return ARMOR_SETS[id]; }
export { SLOT_TO_BONES };

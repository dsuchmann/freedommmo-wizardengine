// src/ui/command-chat.js — Enter opens a command chat; type a motion command,
// press Enter to execute. Esc closes. Game input suppressed while open.
// Matches against the choreography manifest; misses show closest guess or
// "no LLM configured" (honest absence until Task 4 wires the generator).
import { parseCommand, matchMotion } from '../life/motion-match.js';
import { MOTION_MANIFEST } from '../life/choreography/manifest.js';
import { playMotion } from '../render/humanoid-player-renderer.js';

let _container = null;
let _input = null;
let _feedback = null;
let _open = false;
let _gameInput = null; // reference to InputState for suppression

export function isCommandChatOpen() { return _open; }

export function initCommandChat(gameInput) {
  _gameInput = gameInput;

  _container = document.createElement('div');
  _container.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:1000;display:none;flex-direction:column;align-items:center;gap:4px;';

  _feedback = document.createElement('div');
  _feedback.style.cssText = 'color:#fff;font:13px monospace;background:rgba(0,0,0,0.7);padding:4px 10px;border-radius:4px;display:none;white-space:nowrap;';
  _container.appendChild(_feedback);

  _input = document.createElement('input');
  _input.type = 'text';
  _input.placeholder = 'command avatar...';
  _input.style.cssText = 'width:320px;padding:6px 10px;font:14px monospace;background:rgba(0,0,0,0.8);color:#fff;border:1px solid #555;border-radius:6px;outline:none;';
  _container.appendChild(_input);

  document.body.appendChild(_container);

  _input.addEventListener('keydown', e => {
    e.stopPropagation(); // prevent game input
    if (e.key === 'Escape') { closeChat(); return; }
    if (e.key === 'Enter') { submitCommand(); return; }
  });
  _input.addEventListener('keyup', e => e.stopPropagation());

  window.addEventListener('keydown', e => {
    if (_open) return;
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openChat();
    }
  });
}

function openChat() {
  _open = true;
  _container.style.display = 'flex';
  _input.value = '';
  _feedback.style.display = 'none';
  _input.focus();
}

function closeChat() {
  _open = false;
  _container.style.display = 'none';
  _input.blur();
  // Clear any held keys so game input doesn't ghost
  if (_gameInput) _gameInput.keys.clear();
}

function showFeedback(msg, color = '#aaffaa') {
  _feedback.textContent = msg;
  _feedback.style.color = color;
  _feedback.style.display = 'block';
  setTimeout(() => { _feedback.style.display = 'none'; }, 3000);
}

async function submitCommand() {
  const text = _input.value.trim();
  if (!text) { closeChat(); return; }

  const { count, tokens } = parseCommand(text);
  const match = matchMotion(tokens, MOTION_MANIFEST);

  if (match) {
    // Load the program JSON and play it
    try {
      const res = await fetch(`/src/life/choreography/${match.id}.json`);
      if (!res.ok) throw new Error(res.status);
      const program = await res.json();
      playMotion(program, { count });
      showFeedback(`${match.id} ×${count}`);
    } catch (err) {
      showFeedback(`failed to load ${match.id}: ${err.message}`, '#ffaaaa');
    }
  } else {
    // No match — find closest guess
    const { tokens: t } = parseCommand(text);
    let bestId = null, bestScore = 0;
    for (const entry of MOTION_MANIFEST) {
      const idTokens = entry.id.split('_');
      const tagTokens = entry.tags.flatMap(tg => tg.split(/\s+/));
      let s = 0;
      for (const w of t) {
        if (idTokens.some(it => it.startsWith(w))) s += 2;
        else if (tagTokens.some(tt => tt.startsWith(w))) s += 1;
      }
      if (s > bestScore) { bestScore = s; bestId = entry.id; }
    }
    const hint = bestId ? ` — closest: ${bestId}` : '';
    showFeedback(`no match for "${text}"${hint} (no LLM configured)`, '#ffcc66');
  }
  closeChat();
}

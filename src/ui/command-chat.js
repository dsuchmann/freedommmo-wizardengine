// src/ui/command-chat.js — Command chat with sequence queueing + autocomplete.
// Enter opens chat. Supports chained commands: "dance then clap then wave"
// Autocomplete suggests from validated-spatial directory as you type.
import { parseCommand, matchMotion } from '../life/motion-match.js';
import { MOTION_MANIFEST } from '../life/choreography/manifest.js';
import { playMotion } from '../render/humanoid-player-renderer.js';
import { isLLMConfigured } from '../life/motion-llm.js';
import { composeSpatial } from '../life/eval/spatial-compose.js';
import { compileSpatialProgram } from '../life/eval/spatial-compiler.js';
import { queueMotion, queueSequence, clearQueue } from '../life/motion-queue.js';

let _container = null;
let _input = null;
let _feedback = null;
let _autocomplete = null;
let _open = false;
let _gameInput = null;
let _validatedList = null; // cached list of validated choreography IDs

export function isCommandChatOpen() { return _open; }

// ── Load validated choreography list ────────────────────────────────────
async function loadValidatedList() {
  if (_validatedList) return _validatedList;
  // Try to fetch the directory listing — fall back to known list
  try {
    const mod = await import('../life/eval/motion-taxonomy.js');
    _validatedList = mod.ALL_COMMANDS.map(c => c.command);
  } catch {
    _validatedList = [];
  }
  return _validatedList;
}

export function initCommandChat(gameInput) {
  _gameInput = gameInput;
  loadValidatedList();

  _container = document.createElement('div');
  _container.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:1000;display:none;flex-direction:column;align-items:center;gap:4px;';

  _feedback = document.createElement('div');
  _feedback.style.cssText = 'color:#fff;font:13px monospace;background:rgba(0,0,0,0.7);padding:4px 10px;border-radius:4px;display:none;white-space:nowrap;max-width:600px;overflow:hidden;text-overflow:ellipsis;';
  _container.appendChild(_feedback);

  _autocomplete = document.createElement('div');
  _autocomplete.style.cssText = 'width:400px;max-height:200px;overflow-y:auto;background:rgba(0,0,0,0.9);border:1px solid #555;border-radius:6px;display:none;';
  _container.appendChild(_autocomplete);

  _input = document.createElement('input');
  _input.type = 'text';
  _input.placeholder = 'command avatar... (use "then" to chain: dance then clap)';
  _input.style.cssText = 'width:400px;padding:6px 10px;font:14px monospace;background:rgba(0,0,0,0.8);color:#fff;border:1px solid #555;border-radius:6px;outline:none;';
  _container.appendChild(_input);

  document.body.appendChild(_container);

  _input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { closeChat(); return; }
    if (e.key === 'Enter') { submitCommand(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      acceptAutocomplete();
      return;
    }
  });
  _input.addEventListener('keyup', e => { e.stopPropagation(); updateAutocomplete(); });
  _input.addEventListener('input', () => updateAutocomplete());

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
  _autocomplete.style.display = 'none';
  _input.focus();
}

function closeChat() {
  _open = false;
  _container.style.display = 'none';
  _autocomplete.style.display = 'none';
  _input.blur();
  if (_gameInput) _gameInput.keys.clear();
}

function showFeedback(msg, color = '#aaffaa') {
  _feedback.textContent = msg;
  _feedback.style.color = color;
  _feedback.style.display = 'block';
  setTimeout(() => { _feedback.style.display = 'none'; }, 4000);
}

// ── Autocomplete ────────────────────────────────────────────────────────

function updateAutocomplete() {
  const text = _input.value.trim().toLowerCase();
  // Get the last segment after "then"
  const parts = text.split(/\s+then\s+/);
  const current = parts[parts.length - 1].trim();

  if (current.length < 2) { _autocomplete.style.display = 'none'; return; }

  const matches = (_validatedList || [])
    .filter(cmd => cmd.toLowerCase().includes(current))
    .slice(0, 8);

  if (matches.length === 0) { _autocomplete.style.display = 'none'; return; }

  _autocomplete.innerHTML = matches.map((m, i) =>
    `<div style="padding:4px 10px;cursor:pointer;font:12px monospace;color:#ccc;border-bottom:1px solid #333;${i === 0 ? 'background:#333;color:#fff;' : ''}" data-cmd="${m}">${m}</div>`
  ).join('');

  _autocomplete.style.display = 'block';

  _autocomplete.querySelectorAll('[data-cmd]').forEach(el => {
    el.onclick = () => {
      // Replace the current segment with the selected command
      const parts = _input.value.split(/\s+then\s+/);
      parts[parts.length - 1] = el.dataset.cmd;
      _input.value = parts.join(' then ');
      _autocomplete.style.display = 'none';
      _input.focus();
    };
  });
}

function acceptAutocomplete() {
  const first = _autocomplete.querySelector('[data-cmd]');
  if (first) first.click();
}

// ── Resolve a single command to a program ───────────────────────────────

async function resolveCommand(text) {
  const { count, tokens } = parseCommand(text);
  const id = tokens.join('_');

  // 1. Try validated-spatial directory
  try {
    const res = await fetch(`/src/life/choreography/validated-spatial/${id}.json`);
    if (res.ok) return { program: await res.json(), count, source: 'validated' };
  } catch {}

  // 2. Try validated directory (old)
  try {
    const res = await fetch(`/src/life/choreography/validated/${id}.json`);
    if (res.ok) return { program: await res.json(), count, source: 'validated-old' };
  } catch {}

  // 3. Try manifest match
  const match = matchMotion(tokens, MOTION_MANIFEST);
  if (match) {
    try {
      const res = await fetch(`/src/life/choreography/${match.id}.json`);
      if (res.ok) return { program: await res.json(), count, source: 'manifest' };
    } catch {}
  }

  // 4. Generate via spatial LLM
  if (isLLMConfigured()) {
    const cfg = JSON.parse(localStorage.getItem('motion_llm'));
    const rules = JSON.parse(localStorage.getItem('motion_eval_rules') || '[]');
    const rigRes = await fetch('/src/life/rigs/humanoid.json');
    const rig = await rigRes.json();
    const { choreography, error } = await composeSpatial(text, cfg, { rules });
    if (error) return { error };
    const playerDir = (window._player?.character?.direction || 'S').toLowerCase();
    const program = compileSpatialProgram(choreography, rig, playerDir);
    return { program, count, source: 'generated' };
  }

  return { error: `no match for "${text}"` };
}

// ── Submit: parse sequences, resolve each, queue ────────────────────────

async function submitCommand() {
  const text = _input.value.trim();
  if (!text) { closeChat(); return; }

  // Split on "then", "and then", ", then", etc.
  const segments = text.split(/\s*(?:,?\s*then\s+|,\s*and\s+then\s+|,\s+then\s+)/i).filter(Boolean);

  closeChat();

  if (segments.length === 1) {
    // Single command — play directly
    const { program, count, error, source } = await resolveCommand(segments[0]);
    if (error) { showFeedback(error, '#ffaaaa'); return; }
    playMotion(program, { count });
    showFeedback(`${program.id || segments[0]} ×${count} (${source})`);
  } else {
    // Sequence — resolve all then queue
    showFeedback(`queuing ${segments.length} motions...`, '#aaccff');
    const resolved = [];
    for (const seg of segments) {
      const result = await resolveCommand(seg.trim());
      if (result.error) {
        showFeedback(`failed on "${seg}": ${result.error}`, '#ffaaaa');
        return;
      }
      resolved.push(result);
    }
    clearQueue();
    queueSequence(resolved);
    showFeedback(`playing ${resolved.length} motions: ${segments.join(' → ')}`);
  }
}

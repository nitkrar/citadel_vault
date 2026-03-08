import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'pv_shortcuts';

const SHORTCUT_DEFS = [
  { id: 'lock',   key: 'l', label: 'Lock vault',       when: 'Vault unlocked' },
  { id: 'unlock', key: 'u', label: 'Unlock vault',     when: 'Vault locked' },
  { id: 'search', key: 'k', label: 'Search entries',   when: 'Vault unlocked' },
  { id: 'help',   key: '/', label: 'Toggle shortcuts',  when: 'Always' },
];

const ALL_DEFAULTS = Object.fromEntries(SHORTCUT_DEFS.map(s => [s.id, true]));

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...ALL_DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...ALL_DEFAULTS };
}

function saveSettings(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

function isDesktopPointer() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
}

/**
 * Global keyboard shortcuts hook.
 * @param {Object} callbacks - { onLock, onUnlock, onSearch, onToggleHelp }
 * @returns {{ isDesktop, settings, toggleShortcut, SHORTCUT_DEFS }}
 */
export default function useKeyboardShortcuts(callbacks = {}) {
  const [isDesktop] = useState(isDesktopPointer);
  const [settings, setSettings] = useState(loadSettings);

  const toggleShortcut = useCallback((id) => {
    setSettings(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isDesktop) return;

    const handler = (e) => {
      // Skip when typing in form fields (except Escape)
      const tag = e.target.tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && e.key !== 'Escape') return;
      if (e.target.isContentEditable && e.key !== 'Escape') return;

      // We use Ctrl (not Meta/Cmd) to avoid OS conflicts
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;

      const key = e.key.toLowerCase();
      const { onLock, onUnlock, onSearch, onToggleHelp } = callbacks;
      const s = loadSettings(); // read fresh in case toggled in ProfilePage

      if (key === 'l' && s.lock && onLock) {
        e.preventDefault();
        onLock();
      } else if (key === 'u' && s.unlock && onUnlock) {
        e.preventDefault();
        onUnlock();
      } else if (key === 'k' && s.search && onSearch) {
        e.preventDefault();
        onSearch();
      } else if (key === '/' && s.help && onToggleHelp) {
        e.preventDefault();
        onToggleHelp();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDesktop, callbacks]);

  return { isDesktop, settings, toggleShortcut, SHORTCUT_DEFS };
}

export { SHORTCUT_DEFS, STORAGE_KEY };

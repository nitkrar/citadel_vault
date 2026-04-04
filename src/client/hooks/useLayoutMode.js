import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'pv_layout_preference';
const MOBILE_QUERY = '(max-width: 768px)';

/**
 * Layout mode hook — combines viewport detection with user preference.
 *
 * Preference values:
 *   'auto'    — follow viewport (≤768px = mobile, >768px = classic)
 *   'mobile'  — force mobile layout on any screen size
 *   'classic' — force classic sidebar layout on any screen size
 *
 * Returns { isMobile, preference, setPreference }
 */
export default function useLayoutMode() {
  const [preference, setPreferenceState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'auto'; } catch { return 'auto'; }
  });

  const [viewportMobile, setViewportMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );

  // Listen for viewport changes
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e) => setViewportMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setPreference = useCallback((value) => {
    const v = ['auto', 'mobile', 'classic'].includes(value) ? value : 'auto';
    setPreferenceState(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* */ }
  }, []);

  const isMobile = preference === 'mobile' ? true
    : preference === 'classic' ? false
    : viewportMobile;

  return { isMobile, preference, setPreference };
}

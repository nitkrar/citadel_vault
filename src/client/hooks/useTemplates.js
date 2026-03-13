import { useState, useCallback } from 'react';
import useReferenceData, { invalidateReferenceCache } from './useReferenceData';

/**
 * useTemplates — load and cache entry templates.
 * @returns {{ templates: Array, loading: boolean, refetchTemplates: Function }}
 */
export default function useTemplates() {
  const [version, setVersion] = useState(0);
  const { templates, loading } = useReferenceData(
    [{ key: 'templates', url: '/templates.php' }],
    { deps: [version] }
  );

  const refetchTemplates = useCallback(() => {
    invalidateReferenceCache('templates');
    setVersion(v => v + 1);
  }, []);

  return { templates: templates || [], loading, refetchTemplates };
}

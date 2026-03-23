import { useCallback, useMemo } from 'react';
import api from '../api/client';
import { apiData } from '../lib/checks';
import useVaultData from './useVaultData';

export default function useShareData() {
  const fetchSharedByMe = useCallback(async () => {
    const { data: resp } = await api.get('/sharing.php?action=shared-by-me');
    return apiData({ data: resp }) || [];
  }, []);

  const { data: sharedByMe, loading, refetch } = useVaultData(fetchSharedByMe, []);

  // Derive share counts per entry: { [source_entry_id]: count }
  const shareCounts = useMemo(() => {
    const counts = {};
    for (const share of sharedByMe) {
      const eid = share.source_entry_id;
      counts[eid] = (counts[eid] || 0) + 1;
    }
    return counts;
  }, [sharedByMe]);

  // Derive shares grouped by entry: { [source_entry_id]: [share, ...] }
  const sharesByEntry = useMemo(() => {
    const grouped = {};
    for (const share of sharedByMe) {
      const eid = share.source_entry_id;
      if (!grouped[eid]) grouped[eid] = [];
      grouped[eid].push(share);
    }
    return grouped;
  }, [sharedByMe]);

  return { sharedByMe, shareCounts, sharesByEntry, loading, refetch };
}

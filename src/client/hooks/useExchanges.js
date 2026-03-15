import useReferenceData from './useReferenceData';

const EXCHANGES_CONFIG = [
  { key: 'exchanges', url: '/reference.php?resource=exchanges' },
];

export default function useExchanges() {
  const { exchanges, loading } = useReferenceData(EXCHANGES_CONFIG);
  return { exchanges: exchanges || [], loading };
}

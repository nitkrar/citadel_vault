import useReferenceData from './useReferenceData';

/**
 * useCountries — load and cache the countries list.
 * @returns {{ countries: Array, loading: boolean }}
 */
export default function useCountries() {
  const { countries, loading } = useReferenceData([
    { key: 'countries', url: '/reference.php?resource=countries' },
  ]);
  return { countries: countries || [], loading };
}

import useReferenceData from './useReferenceData';

/**
 * useCurrencies — load and cache the currencies list.
 * @returns {{ currencies: Array, loading: boolean }}
 */
export default function useCurrencies() {
  const { currencies, loading } = useReferenceData([
    { key: 'currencies', url: '/reference.php?resource=currencies' },
  ]);
  return { currencies: currencies || [], loading };
}

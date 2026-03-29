import useReferenceData from './useReferenceData';

/**
 * useAppConfig — load and cache server app config (base_currency, etc).
 * @returns {{ config: object, loading: boolean }}
 */
export default function useAppConfig({ enabled = true } = {}) {
  const { config, loading } = useReferenceData(
    [{ key: 'config', url: '/reference.php?resource=config' }],
    { enabled },
  );
  return { config: config || {}, loading };
}

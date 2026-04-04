/**
 * Shared chart color constants and helpers.
 * Used by OverviewTab, PerformanceTab, and any future chart components.
 */

export const TYPE_COLORS = {
  cash:            '#00C4B4',  // cyan-teal
  stock:           '#F5A623',  // warm amber
  cash_equivalent: '#4FC3F7',  // cornflower sky
  real_estate:     '#BA68C8',  // soft violet
  crypto:          '#5C6BC0',  // periwinkle indigo
  bond:            '#F4845F',  // warm coral
  vehicle:         '#CFD8DC',  // light blue-grey (rare, muted)
  asset:           '#78909C',  // mid blue-grey (neutral fallback)
};

export const EXTRA_COLORS = ['#00897B', '#FFB300', '#29B6F6', '#AB47BC', '#7E57C2', '#FF7043'];

export function getTypeColor(typeKey) {
  if (TYPE_COLORS[typeKey]) return TYPE_COLORS[typeKey];
  let hash = 0;
  for (let i = 0; i < typeKey.length; i++) hash = ((hash << 5) - hash + typeKey.charCodeAt(i)) | 0;
  return EXTRA_COLORS[Math.abs(hash) % EXTRA_COLORS.length];
}

export const CHART_COLORS = ['#00C4B4', '#F5A623', '#4FC3F7', '#BA68C8', '#5C6BC0', '#F4845F', '#00897B', '#FFB300'];
export const NET_WORTH_COLOR = '#3B82F6';   // hero line — bold electric blue
export const POSITIVE_COLOR  = '#3B9EFF';   // gains — bright blue (NOT green)
export const NEGATIVE_COLOR  = '#E8A838';   // losses — golden amber (NOT red)

export function getBreakdownColor(key, breakdown, index) {
  if (breakdown === 'type') return getTypeColor(key);
  return CHART_COLORS[index % CHART_COLORS.length];
}

export function abbreviateNumber(value) {
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(0);
}

const CATEGORY_COLORS = {
  Life: 'badge-primary',
  Health: 'badge-success',
  Vehicle: 'badge-warning',
  Property: 'badge-info',
  Other: 'badge-muted',
};

export default function InsuranceCategoryBadge({ category }) {
  return <span className={`badge ${CATEGORY_COLORS[category] || 'badge-muted'}`}>{category}</span>;
}

/**
 * Skeleton — pulsing placeholder for loading states.
 */

export function Skeleton({ width, height, borderRadius, className = '', style = {} }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius, ...style }}
    />
  );
}

export function SkeletonCard() {
  return <div className="skeleton skeleton-card" />;
}

export function SkeletonChart({ height = 220 }) {
  return <div className="skeleton skeleton-chart" style={{ height }} />;
}

export function SkeletonText({ lines = 3, width }) {
  return (
    <div style={{ width }}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton skeleton-text" />
      ))}
    </div>
  );
}

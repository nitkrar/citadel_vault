import { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Settings, Clock, AlertTriangle, MoreVertical } from 'lucide-react';
import { Line as CJSLine, Bar as CJSBar } from 'react-chartjs-2';
import { Chart as ChartJS } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(zoomPlugin);

import Modal from '../Modal';
import SegmentedControl from '../SegmentedControl';
import api from '../../api/client';
import { fmtCurrency, MASKED, apiData } from '../../lib/checks';
import { buildRateMap, buildSymbolMap, recalculateSnapshot } from '../../lib/portfolioAggregator';
import * as workerDispatcher from '../../lib/workerDispatcher';
import {
  CHART_COLORS, NET_WORTH_COLOR, POSITIVE_COLOR, NEGATIVE_COLOR,
  getBreakdownColor, abbreviateNumber,
} from '../../lib/chartColors';
import { AAD_SNAPSHOT_ENTRY } from '../../lib/crypto';

/**
 * Cross-chart hover sync plugin (instance-level, not global).
 * When hovering chart A, highlights the matching date on chart B.
 */
function createSyncPlugin(peerRef, tooltipModeRef) {
  return {
    id: 'crossChartSync',
    afterEvent(chart, args) {
      const peer = peerRef.current;
      if (!peer || chart === peer) return;
      // Only sync highlights in combined mode; skip tooltip sync to avoid double popovers
      if (tooltipModeRef.current !== 'index') return;
      const { event } = args;

      if (event.type === 'mousemove') {
        const elements = chart.getElementsAtEventForMode(event, 'index', { intersect: false }, false);
        if (elements.length > 0) {
          const date = chart.data.labels[elements[0].index];
          const peerIndex = peer.data.labels?.indexOf(date);
          if (peerIndex >= 0) {
            const peerElements = peer.data.datasets.map((_, dsIdx) => ({
              datasetIndex: dsIdx,
              index: peerIndex,
            }));
            peer.setActiveElements(peerElements);
            peer.update('none');
          }
        }
      } else if (event.type === 'mouseout') {
        peer.setActiveElements([]);
        peer.update('none');
      }
    },
  };
}

function getGroupTotals(summary, breakdown) {
  if (breakdown === 'none') return {};
  if (breakdown === 'type') return summary.by_type;
  if (breakdown === 'country') return summary.by_country;
  if (breakdown === 'account') return summary.by_account;
  if (breakdown === 'currency') return summary.by_currency;
  if (breakdown === 'asset') {
    const byAsset = {};
    for (const e of (summary.entries || [])) {
      const key = String(e.entry_id);
      if (!key || key === 'undefined') continue;
      if (!byAsset[key]) byAsset[key] = { total: 0, count: 0, label: e.name || 'Unnamed' };
      byAsset[key].total += e.displayValue;
      byAsset[key].count++;
    }
    return byAsset;
  }
  return {};
}

export default function PerformanceTab({ decrypt, fmtD, hideAmounts, currencies, countries, displayCurrency, baseCurrency, snapshotPrompt, setSnapshotPrompt, doSaveSnapshot, snapshotSaving, decryptedCache, portfolio, isMobile }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnap, setLoadingSnap] = useState(true);
  const [rateMode, setRateMode] = useState('current'); // 'current' | 'snapshot'
  const [historicalRatesCache, setHistoricalRatesCache] = useState({}); // date → rateMap
  const [loadingRates, setLoadingRates] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [expandedTypes, setExpandedTypes] = useState({});
  const [snapshotGroupBy, setSnapshotGroupBy] = useState('type');
  const [filterType, setFilterType] = useState('all');       // asset class filter
  const [filterCountry, setFilterCountry] = useState('all'); // country filter
  const [breakdown, setBreakdown] = useState(() => sessionStorage.getItem('pv_portfolio_breakdown') || 'none');
  const [dateRange, setDateRange] = useState('all'); // 'all' | '3m' | '6m' | '1y' | 'ytd'
  const [showPercent, setShowPercent] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [showRateSettings, setShowRateSettings] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [yoyMode, setYoyMode] = useState(false);
  const [tooltipMode, setTooltipMode] = useState('index'); // 'index' = combined, 'nearest' = single
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [showToolbarOverflow, setShowToolbarOverflow] = useState(false);
  const heroChartRef = useRef(null);
  const deltaChartRef = useRef(null);

  // Build current rate map from live currencies
  const currentRateMap = useMemo(() => buildRateMap(currencies || []), [currencies]);

  // Build currency symbol map
  const symbolMap = useMemo(() => buildSymbolMap(currencies || []), [currencies]);

  // Build country code → name map
  const countryMap = useMemo(() => {
    const map = {};
    for (const c of (countries || [])) map[c.code] = c.name;
    return map;
  }, [countries]);

  const SNAPSHOT_PAGE_SIZE = 50;

  const loadSnapshots = async (cursor = null, append = false) => {
    if (!append) setLoadingSnap(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', SNAPSHOT_PAGE_SIZE);
      if (cursor) params.set('before', cursor);

      const { data: resp } = await api.get(`/snapshots.php?${params}`);
      const body = apiData({ data: resp });
      // Handle both paginated (object) and legacy (array) responses
      const raw = Array.isArray(body) ? body : (body?.snapshots || []);
      const paginationMeta = Array.isArray(body) ? { has_more: false } : body;

      const decrypted = [];
      for (const s of raw) {
        if (!s.entries || s.entries.length === 0) continue;
        const entryBlobs = s.entries.map(e => e.encrypted_data);
        const decryptedEntries = await workerDispatcher.decryptBatch(entryBlobs, null, AAD_SNAPSHOT_ENTRY);
        const entries = [];
        for (let j = 0; j < decryptedEntries.length; j++) {
          if (decryptedEntries[j]) {
            entries.push({ ...decryptedEntries[j], entry_id: s.entries[j].entry_id });
          }
        }
        // Backfill entries missing country/linked_account or with "Unknown Account".
        // Resolves from decryptedCache (live vault data). If vault entry was deleted,
        // sets explicit nulls. Persists fixes back to server so backfill is one-time.
        const entriesToUpdate = [];
        for (let j = 0; j < entries.length; j++) {
          const entry = entries[j];
          const needsCountry = entry.country === undefined;
          const needsAccount = entry.linked_account === undefined
            || entry.linked_account?.name === 'Unknown Account';

          if (needsCountry || needsAccount) {
            const vaultEntry = decryptedCache?.[entry.entry_id];
            if (vaultEntry) {
              if (needsCountry) entry.country = vaultEntry.country || null;
              if (needsAccount) {
                const acctId = vaultEntry.linked_account_id;
                entry.linked_account = acctId
                  ? { id: acctId, name: decryptedCache?.[acctId]?.title || 'Unknown Account' }
                  : null;
              }
            } else {
              if (needsCountry) entry.country = null;
              if (needsAccount) entry.linked_account = null;
            }
            entriesToUpdate.push(j);
          }
        }

        // Persist backfilled entries to server
        if (entriesToUpdate.length > 0) {
          try {
            const blobsToEncrypt = entriesToUpdate.map(j => {
              const { entry_id, ...blob } = entries[j];
              return blob;
            });
            const encryptedBlobs = await workerDispatcher.encryptBatch(blobsToEncrypt, null, AAD_SNAPSHOT_ENTRY);
            const updatePayload = entriesToUpdate.map((j, idx) => ({
              entry_id: entries[j].entry_id,
              encrypted_data: encryptedBlobs[idx],
            }));
            await api.put('/snapshots.php', { snapshot_id: s.id, entries: updatePayload });
          } catch { /* backfill save failed — display still corrected in-memory */ }
        }

        decrypted.push({ ...s, _entries: entries });
      }
      if (append) {
        setSnapshots(prev => [...decrypted, ...prev]); // prepend older data
      } else {
        setSnapshots(decrypted);
      }
      setHasMore(paginationMeta.has_more || false);
      setNextCursor(paginationMeta.next_cursor || null);
    } catch { /* silent */ }
    setLoadingSnap(false);
    setLoadingMore(false);
  };

  // Auto-load snapshots on mount
  useEffect(() => { loadSnapshots(); }, []);

  // Fetch historical rates for a specific date (cached)
  const fetchHistoricalRates = async (date) => {
    if (historicalRatesCache[date]) return historicalRatesCache[date];
    setLoadingRates(true);
    try {
      const { data: resp } = await api.get(`/reference.php?resource=historical-rates&date=${date}`);
      const ratesData = apiData({ data: resp });
      if (ratesData?.rates) {
        const rateMap = {};
        for (const [code, rate] of Object.entries(ratesData.rates)) {
          rateMap[code] = rate;
        }
        setHistoricalRatesCache(prev => ({ ...prev, [date]: rateMap }));
        setLoadingRates(false);
        return rateMap;
      }
    } catch { /* fallback to current */ }
    setLoadingRates(false);
    return null;
  };

  // Preload historical rates when switching to snapshot mode
  const handleRateModeChange = async (mode) => {
    setRateMode(mode);
    if (mode === 'snapshot') {
      const dates = [...new Set(snapshots.map(s => s.snapshot_date))];
      for (const date of dates) {
        if (!historicalRatesCache[date]) {
          await fetchHistoricalRates(date);
        }
      }
    }
  };

  // Compute summary for a v3 snapshot using recalculateSnapshot
  const getSnapshotSummary = (snapshot) => {
    if (!snapshot._entries || snapshot._entries.length === 0) return null;
    const rateMap = rateMode === 'snapshot'
      ? (historicalRatesCache[snapshot.snapshot_date] || currentRateMap)
      : currentRateMap;
    return recalculateSnapshot(snapshot._entries, rateMap, displayCurrency);
  };

  const hasSnapshots = snapshots.some(s => s._entries && s._entries.length > 0);

  // ── All useMemo hooks BEFORE early returns (React Rules of Hooks) ──

  // Filter snapshots by date range
  const filteredSnapshots = useMemo(() => {
    if (dateRange === 'all') return snapshots;
    const now = new Date();
    let cutoff;
    if (dateRange === '3m') { cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3); }
    else if (dateRange === '6m') { cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 6); }
    else if (dateRange === '1y') { cutoff = new Date(now); cutoff.setFullYear(cutoff.getFullYear() - 1); }
    else if (dateRange === 'ytd') { cutoff = new Date(now.getFullYear(), 0, 1); }
    if (!cutoff) return snapshots;
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return snapshots.filter(s => s.snapshot_date >= cutoffStr);
  }, [snapshots, dateRange]);

  // Single useMemo for all snapshot summaries — all chart data derives from this
  const snapshotSummaryMap = useMemo(() => {
    const map = new Map();
    for (let idx = 0; idx < filteredSnapshots.length; idx++) {
      const snap = filteredSnapshots[idx];
      if (!snap._entries || snap._entries.length === 0) continue;
      const snapRateMap = rateMode === 'snapshot'
        ? (historicalRatesCache[snap.snapshot_date] || currentRateMap)
        : currentRateMap;
      const summary = recalculateSnapshot(snap._entries, snapRateMap, displayCurrency);
      map.set(snap.id ?? idx, { date: snap.snapshot_date, ...summary });
    }
    return map;
  }, [filteredSnapshots, rateMode, historicalRatesCache, currentRateMap, displayCurrency]);

  // Collect all unique asset class keys across all snapshots (for filter dropdown)
  const allTypes = useMemo(() => {
    const types = new Map();
    for (const summary of snapshotSummaryMap.values()) {
      for (const [key, val] of Object.entries(summary.by_type || {})) {
        if (!types.has(key)) types.set(key, val.label || key);
      }
    }
    return types;
  }, [snapshotSummaryMap]);

  // Collect all unique country keys across all snapshots (for filter dropdown)
  const allCountries = useMemo(() => {
    const ctries = new Map();
    for (const summary of snapshotSummaryMap.values()) {
      for (const [key, val] of Object.entries(summary.by_country || {})) {
        if (!ctries.has(key)) ctries.set(key, countryMap[key] || val.label || key);
      }
    }
    return ctries;
  }, [snapshotSummaryMap, countryMap]);

  // Auto-reset filters when selected option is no longer available
  useEffect(() => {
    if (filterType !== 'all' && !allTypes.has(filterType)) setFilterType('all');
  }, [allTypes, filterType]);
  useEffect(() => {
    if (filterCountry !== 'all' && !allCountries.has(filterCountry)) setFilterCountry('all');
  }, [allCountries, filterCountry]);

  // Cross-chart hover sync plugins (instance-level, uses refs)
  const tooltipModeRef = useRef(tooltipMode);
  tooltipModeRef.current = tooltipMode;
  const heroSyncPlugin = useMemo(() => createSyncPlugin(deltaChartRef, tooltipModeRef), []);
  const deltaSyncPlugin = useMemo(() => createSyncPlugin(heroChartRef, tooltipModeRef), []);

  // Reset zoom when chart context changes
  useEffect(() => {
    if (heroChartRef.current && isZoomed) {
      heroChartRef.current.resetZoom();
      setIsZoomed(false);
    }
  }, [dateRange, breakdown, filterType, filterCountry, showPercent, rateMode]);

  // Re-aggregate snapshots with independent filters applied
  const filteredSummaryMap = useMemo(() => {
    if (filterType === 'all' && filterCountry === 'all') return snapshotSummaryMap;
    const map = new Map();
    for (const [key, summary] of snapshotSummaryMap) {
      const filtered = (summary.entries || []).filter(e => {
        if (filterType !== 'all') {
          const typeKey = (e.subtype || e.entry_type || e.template_name || 'other').toLowerCase();
          if (typeKey !== filterType) return false;
        }
        if (filterCountry !== 'all') {
          if ((e.country || 'Unknown') !== filterCountry) return false;
        }
        return true;
      });
      if (filtered.length === 0) {
        map.set(key, { date: summary.date, total_assets: 0, total_liabilities: 0, net_worth: 0, asset_count: 0, by_type: {}, by_currency: {}, by_country: {}, by_account: {}, entries: [] });
      } else {
        let totalAssets = 0, totalLiabilities = 0;
        const byType = {}, byCurrency = {}, byCountry = {}, byAccount = {};
        for (const e of filtered) {
          const v = e.displayValue;
          if (e.is_liability) totalLiabilities += Math.abs(v);
          else totalAssets += v;
          const tk = (e.subtype || e.entry_type || e.template_name || 'other').toLowerCase();
          if (!byType[tk]) byType[tk] = { total: 0, count: 0, label: e.template_name || tk };
          byType[tk].total += v; byType[tk].count++;
          const curr = e.currency || displayCurrency;
          if (!byCurrency[curr]) byCurrency[curr] = { total: 0, count: 0, label: curr };
          byCurrency[curr].total += v; byCurrency[curr].count++;
          const ctry = e.country || 'Unknown';
          if (!byCountry[ctry]) byCountry[ctry] = { total: 0, count: 0, label: ctry };
          byCountry[ctry].total += v; byCountry[ctry].count++;
          const acctKey = e.linked_account?.id ? String(e.linked_account.id) : '_unlinked';
          if (!byAccount[acctKey]) byAccount[acctKey] = { total: 0, count: 0, label: e.linked_account?.name || 'Not linked to an account' };
          byAccount[acctKey].total += v; byAccount[acctKey].count++;
        }
        map.set(key, { date: summary.date, total_assets: totalAssets, total_liabilities: totalLiabilities, net_worth: totalAssets - totalLiabilities, asset_count: filtered.length, by_type: byType, by_currency: byCurrency, by_country: byCountry, by_account: byAccount, entries: filtered });
      }
    }
    return map;
  }, [snapshotSummaryMap, filterType, filterCountry, displayCurrency]);

  // Collect all unique group keys with labels from filteredSummaryMap
  const allGroupKeys = useMemo(() => {
    const keys = new Map();
    if (breakdown === 'none') { keys.set('__net_worth__', 'Net Worth'); return keys; }
    for (const summary of filteredSummaryMap.values()) {
      let source;
      if (breakdown === 'type') source = summary.by_type;
      else if (breakdown === 'country') source = summary.by_country;
      else if (breakdown === 'account') source = summary.by_account;
      else if (breakdown === 'currency') source = summary.by_currency;
      else if (breakdown === 'asset') {
        for (const e of (summary.entries || [])) {
          if (e.entry_id && !keys.has(String(e.entry_id))) {
            keys.set(String(e.entry_id), e.name || 'Unnamed');
          }
        }
        continue;
      }
      if (source) {
        for (const [key, val] of Object.entries(source)) {
          if (!keys.has(key)) {
            let label = val.label || key;
            if (breakdown === 'currency') {
              const sym = symbolMap[key];
              if (sym && sym !== key) label = `${sym} ${key}`;
            } else if (breakdown === 'country') {
              label = countryMap[key] || label;
            }
            keys.set(key, label);
          }
        }
      }
    }
    return keys;
  }, [filteredSummaryMap, breakdown, symbolMap, countryMap]);

  // Chart data: date + netWorth + byGroup totals per snapshot
  const chartData = useMemo(() =>
    [...filteredSummaryMap.values()].map(s => ({
      date: s.date,
      netWorth: s.net_worth,
      byGroup: breakdown === 'none'
        ? { __net_worth__: s.net_worth }
        : Object.fromEntries(
            Object.entries(getGroupTotals(s, breakdown)).map(([k, v]) => [k, v.total])
          ),
    })).sort((a, b) => a.date.localeCompare(b.date)),
  [filteredSummaryMap, breakdown]);

  // Percentage data: each group as % of sum of absolute group totals
  const percentageData = useMemo(() =>
    [...filteredSummaryMap.values()].map(s => {
      const groups = getGroupTotals(s, breakdown);
      const keys = Object.keys(groups);
      if (keys.length === 0) return { date: s.date, groups: { __net_worth__: 100 } };
      const absSum = keys.reduce((acc, k) => acc + Math.abs(groups[k].total), 0);
      if (absSum === 0) return { date: s.date, groups: Object.fromEntries(keys.map(k => [k, 0])) };
      return {
        date: s.date,
        groups: Object.fromEntries(
          keys.map(k => [k, (Math.abs(groups[k].total) / absSum) * 100])
        ),
      };
    }).sort((a, b) => a.date.localeCompare(b.date)),
  [filteredSummaryMap, breakdown]);

  // Delta data: consecutive diffs per group — absolute + percentage (first snapshot omitted)
  const deltaData = useMemo(() => {
    const data = [...filteredSummaryMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    return data.slice(1).map((s, i) => {
      const prev = data[i];
      const delta = s.net_worth - prev.net_worth;
      const pctDelta = prev.net_worth !== 0 ? (delta / Math.abs(prev.net_worth)) * 100 : 0;
      // Per-group deltas for breakdown-aware bar chart
      const byGroup = {};
      if (breakdown === 'none') {
        byGroup.__net_worth__ = { delta, pctDelta };
      } else {
        const currGroups = getGroupTotals(s, breakdown);
        const prevGroups = getGroupTotals(prev, breakdown);
        for (const key of new Set([...Object.keys(currGroups), ...Object.keys(prevGroups)])) {
          const curr = currGroups[key]?.total || 0;
          const prv = prevGroups[key]?.total || 0;
          byGroup[key] = { delta: curr - prv, pctDelta: prv !== 0 ? ((curr - prv) / Math.abs(prv)) * 100 : 0 };
        }
      }
      return { date: s.date, delta, pctDelta, byGroup };
    });
  }, [filteredSummaryMap, breakdown]);

  // Year-over-year comparison data
  const yoyData = useMemo(() => {
    if (!yoyMode || chartData.length === 0) return null;

    const allDates = chartData.map(d => new Date(d.date));
    const maxDate = new Date(Math.max(...allDates));
    const currentYear = maxDate.getFullYear();
    const prevYear = currentYear - 1;

    // Current year: from chartData (already date-range filtered)
    const currentYearData = chartData.filter(d => new Date(d.date).getFullYear() === currentYear);

    // Previous year: from ALL summaries (unfiltered by date range)
    const allSummaries = [...filteredSummaryMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const prevYearData = allSummaries
      .filter(s => new Date(s.date).getFullYear() === prevYear)
      .map(s => {
        const orig = new Date(s.date);
        const mapped = new Date(currentYear, orig.getMonth(), orig.getDate());
        return {
          date: mapped.toISOString().split('T')[0],
          originalDate: s.date,
          netWorth: s.net_worth,
          byGroup: breakdown === 'none'
            ? { __net_worth__: s.net_worth }
            : Object.fromEntries(
                Object.entries(getGroupTotals(s, breakdown)).map(([k, v]) => [k, v.total])
              ),
        };
      });

    return { currentYearData, prevYearData, currentYear, prevYear };
  }, [yoyMode, chartData, filteredSummaryMap, breakdown]);

  // YoY chart datasets
  const heroYoYData = useMemo(() => {
    if (!yoyData) return null;
    const { currentYearData, prevYearData, currentYear, prevYear } = yoyData;

    // Merge all x-axis dates (mapped to current year)
    const allDates = [...new Set([
      ...currentYearData.map(d => d.date),
      ...prevYearData.map(d => d.date),
    ])].sort();

    const datasets = [];
    const hasActiveFilter = filterType !== 'all' || filterCountry !== 'all';

    // Net Worth lines (only in 'none' breakdown, no active filter)
    if (breakdown === 'none' && !hasActiveFilter) {
      datasets.push({
        label: `Net Worth (${currentYear})`,
        data: allDates.map(date => { const pt = currentYearData.find(d => d.date === date); return pt ? pt.netWorth : null; }),
        borderColor: NET_WORTH_COLOR,
        backgroundColor: NET_WORTH_COLOR + '33',
        borderWidth: 3, pointRadius: 4, tension: 0.3, fill: false, borderDash: [], spanGaps: true, order: 0,
      });
      datasets.push({
        label: `Net Worth (${prevYear})`,
        data: allDates.map(date => { const pt = prevYearData.find(d => d.date === date); return pt ? pt.netWorth : null; }),
        borderColor: NET_WORTH_COLOR,
        backgroundColor: NET_WORTH_COLOR + '15',
        borderWidth: 2, pointRadius: 3, tension: 0.3, fill: false, borderDash: [6, 3], spanGaps: true, order: 1,
      });
    }

    // Per-group lines
    const visibleKeys = [...allGroupKeys.keys()];
    visibleKeys.forEach((key, idx) => {
      const color = getBreakdownColor(key, breakdown, idx);
      // Current year (solid)
      datasets.push({
        label: `${allGroupKeys.get(key)} (${currentYear})`,
        data: allDates.map(date => { const pt = currentYearData.find(d => d.date === date); return pt ? (pt.byGroup[key] || 0) : null; }),
        borderColor: color, backgroundColor: color + '33',
        borderWidth: 1.5, pointRadius: 3, tension: 0.3, fill: false, borderDash: [], spanGaps: true, order: idx + 2,
      });
      // Previous year (dashed)
      datasets.push({
        label: `${allGroupKeys.get(key)} (${prevYear})`,
        data: allDates.map(date => { const pt = prevYearData.find(d => d.date === date); return pt ? (pt.byGroup[key] || 0) : null; }),
        borderColor: color + 'AA', backgroundColor: color + '15',
        borderWidth: 1, pointRadius: 2, tension: 0.3, fill: false, borderDash: [6, 3], spanGaps: true, order: idx + 2 + visibleKeys.length,
      });
    });

    return { labels: allDates, datasets };
  }, [yoyData, allGroupKeys, breakdown, filterType, filterCountry]);

  // ── Early returns (after all hooks) ──

  if (loadingSnap) {
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  if (snapshots.length === 0) {
    return (
      <div className="empty-state">
        <Clock size={40} className="empty-icon" />
        <h3>No snapshots</h3>
        <p>Save a snapshot to track your portfolio over time.</p>
      </div>
    );
  }

  // ── Chart.js options (read CSS vars for dark mode) ──
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim() || '#6b7280';
  const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#e5e7eb';

  // All group keys are visible (filters already narrowed the data)
  const visibleGroupKeys = [...allGroupKeys.keys()];
  const hasActiveFilter = filterType !== 'all' || filterCountry !== 'all';
  const filterDesc = [
    filterType !== 'all' ? allTypes.get(filterType) : null,
    filterCountry !== 'all' ? allCountries.get(filterCountry) : null,
  ].filter(Boolean).join(' + ');

  // Hero line chart datasets (normal mode)
  const heroLineData = {
    labels: chartData.map(d => d.date),
    datasets: [
      ...(breakdown === 'none' && !hasActiveFilter ? [{
        label: 'Net Worth',
        data: chartData.map(d => d.netWorth),
        borderColor: NET_WORTH_COLOR,
        backgroundColor: NET_WORTH_COLOR + '33',
        borderWidth: 3,
        pointRadius: 4,
        tension: 0.3,
        fill: false,
        order: 0,
      }] : []),
      ...visibleGroupKeys.map((key, idx) => ({
        label: allGroupKeys.get(key) || key,
        data: chartData.map(d => d.byGroup[key] || 0),
        borderColor: getBreakdownColor(key, breakdown, idx),
        backgroundColor: getBreakdownColor(key, breakdown, idx) + '33',
        borderWidth: 1.5,
        pointRadius: 3,
        tension: 0.3,
        fill: false,
        order: idx + 1,
      })),
    ],
  };

  // Hero stacked area datasets (percent mode)
  const heroPercentData = {
    labels: percentageData.map(d => d.date),
    datasets: visibleGroupKeys.map((key, idx) => ({
      label: allGroupKeys.get(key) || key,
      data: percentageData.map(d => d.groups[key] || 0),
      borderColor: getBreakdownColor(key, breakdown, idx),
      backgroundColor: getBreakdownColor(key, breakdown, idx) + '99',
      borderWidth: 1.5,
      pointRadius: 3,
      tension: 0.3,
      fill: true,
      order: idx + 1,
    })),
  };

  const heroOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: tooltipMode, intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'day', tooltipFormat: 'MMM d, yyyy' },
        grid: { color: borderColor },
        ticks: { color: textColor, font: { size: 12 } },
      },
      y: {
        stacked: showPercent || undefined,
        ...(showPercent ? { max: 100 } : {}),
        grid: { color: borderColor },
        ticks: {
          color: textColor,
          font: { size: 12 },
          callback: v => hideAmounts ? '***' : showPercent ? v.toFixed(0) + '%' : abbreviateNumber(v),
        },
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: textColor, font: { size: 12 }, usePointStyle: true },
      },
      tooltip: {
        callbacks: {
          label: ctx => hideAmounts
            ? `${ctx.dataset.label}: ${MASKED}`
            : showPercent
              ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
              : `${ctx.dataset.label}: ${fmtCurrency(ctx.parsed.y)}`,
        },
      },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x',
        },
        zoom: {
          drag: {
            enabled: true,
            backgroundColor: 'rgba(13, 148, 136, 0.15)',
            borderColor: 'rgba(13, 148, 136, 0.6)',
            borderWidth: 1,
          },
          pinch: {
            enabled: true,
          },
          mode: 'x',
          onZoom: () => setIsZoomed(true),
        },
        limits: {
          x: { minRange: 2 * 86400000 },  // minimum 2 days visible
        },
      },
    },
  };

  // Delta bar chart — per-group bars when breakdown active, or single net worth bar
  const deltaChartData = {
    labels: deltaData.map(d => d.date),
    datasets: visibleGroupKeys.length > 1
      // Multiple groups — stacked bars per group
      ? visibleGroupKeys.map((key, idx) => ({
          label: allGroupKeys.get(key) || key,
          data: deltaData.map(d => {
            const g = d.byGroup[key];
            return showPercent ? (g?.pctDelta || 0) : (g?.delta || 0);
          }),
          backgroundColor: getBreakdownColor(key, breakdown, idx),
          borderRadius: 2,
          stack: 'delta',
        }))
      // Single group or fallback — single bar with positive/negative coloring
      : visibleGroupKeys.length === 1
        ? [{
            label: allGroupKeys.get(visibleGroupKeys[0]) || visibleGroupKeys[0],
            data: deltaData.map(d => {
              const g = d.byGroup[visibleGroupKeys[0]];
              return showPercent ? (g?.pctDelta || 0) : (g?.delta || 0);
            }),
            backgroundColor: deltaData.map(d => {
              const v = showPercent ? (d.byGroup[visibleGroupKeys[0]]?.pctDelta || 0) : (d.byGroup[visibleGroupKeys[0]]?.delta || 0);
              return v >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
            }),
            borderRadius: 4,
          }]
        : [{
            label: showPercent ? '% Change' : 'Period Change',
            data: deltaData.map(d => showPercent ? d.pctDelta : d.delta),
            backgroundColor: deltaData.map(d => (showPercent ? d.pctDelta : d.delta) >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR),
            borderRadius: 4,
          }],
  };

  const deltaOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: tooltipMode, intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'day', tooltipFormat: 'MMM d, yyyy' },
        grid: { color: borderColor },
        ticks: { color: textColor, font: { size: 12 } },
      },
      y: {
        grid: { color: borderColor },
        ticks: {
          color: textColor,
          font: { size: 12 },
          callback: v => hideAmounts ? '***' : showPercent ? v.toFixed(1) + '%' : abbreviateNumber(v),
        },
      },
    },
    plugins: {
      legend: { display: visibleGroupKeys.length > 1, position: 'bottom', labels: { color: textColor, font: { size: 11 }, usePointStyle: true } },
      tooltip: {
        callbacks: {
          label: ctx => hideAmounts
            ? `${ctx.dataset.label}: ${MASKED}`
            : showPercent
              ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
              : `${ctx.dataset.label}: ${fmtCurrency(ctx.parsed.y)}`,
        },
      },
      zoom: {
        pan: { enabled: true, mode: 'x' },
        zoom: {
          drag: {
            enabled: true,
            backgroundColor: 'rgba(13, 148, 136, 0.15)',
            borderColor: 'rgba(13, 148, 136, 0.6)',
            borderWidth: 1,
          },
          pinch: { enabled: true },
          mode: 'x',
          onZoom: () => setIsZoomed(true),
        },
        limits: { x: { minRange: 2 * 86400000 } },
      },
    },
  };

  const currencyToggleLabel = symbolMap[displayCurrency] || displayCurrency;

  return (
    <>
      {/* Zone 1 — Toolbar */}
      {isMobile ? (
        <div className="card mb-4" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflow: 'hidden' }}>
          {/* Breakdown dropdown (always visible) */}
          <select
            className="form-control"
            aria-label="Breakdown"
            style={{ width: 'auto', minWidth: 0, flex: '0 1 auto', fontSize: 13 }}
            value={breakdown}
            onChange={e => { const v = e.target.value; setBreakdown(v); sessionStorage.setItem('pv_portfolio_breakdown', v); }}
          >
            <option value="none">None</option>
            <option value="type">Asset Type</option>
            <option value="country">Country</option>
            <option value="account">Account</option>
            <option value="currency">Currency</option>
            <option value="asset">Asset</option>
          </select>

          {/* Values / % toggle (always visible) */}
          <SegmentedControl
            options={[{ value: 'values', label: 'Val' }, { value: 'percent', label: '%' }]}
            value={showPercent ? 'percent' : 'values'}
            onChange={v => { if (!yoyMode) setShowPercent(v === 'percent'); }}
          />

          {/* Active filter indicator */}
          {hasActiveFilter && (
            <span style={{ fontSize: 11, color: 'var(--color-primary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              Filtered
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Overflow menu */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowToolbarOverflow(v => !v)} aria-label="More options">
              <MoreVertical size={18} />
            </button>
            {showToolbarOverflow && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 900 }} onClick={() => setShowToolbarOverflow(false)} />
                <div style={{
                  position: 'fixed', right: 16, zIndex: 901,
                  background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: 220, overflow: 'hidden', padding: '8px 0',
                }}>
                  {/* Asset class filter */}
                  {allTypes.size > 1 && (
                    <div style={{ padding: '6px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>Asset Type</span>
                      <select className="form-control" aria-label="Asset class filter"
                        style={{ width: '100%', fontSize: 13, marginTop: 4 }}
                        value={filterType} onChange={e => setFilterType(e.target.value)}>
                        <option value="all">All</option>
                        {[...allTypes.entries()].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    </div>
                  )}
                  {/* Country filter */}
                  {allCountries.size > 1 && (
                    <div style={{ padding: '6px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>Country</span>
                      <select className="form-control" aria-label="Country filter"
                        style={{ width: '100%', fontSize: 13, marginTop: 4 }}
                        value={filterCountry} onChange={e => setFilterCountry(e.target.value)}>
                        <option value="all">All</option>
                        {[...allCountries.entries()].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    </div>
                  )}
                  {/* Clear filters */}
                  {hasActiveFilter && (
                    <button className="btn btn-ghost btn-sm"
                      style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px', fontSize: 12 }}
                      onClick={() => { setFilterType('all'); setFilterCountry('all'); setShowToolbarOverflow(false); }}>
                      Clear filters
                    </button>
                  )}
                  {(allTypes.size > 1 || allCountries.size > 1) && <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />}
                  {/* YoY toggle */}
                  <button className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px',
                      background: yoyMode ? 'var(--hover-bg)' : undefined }}
                    disabled={showPercent}
                    onClick={() => {
                      const next = !yoyMode;
                      setYoyMode(next);
                      if (next && showPercent) setShowPercent(false);
                      setShowToolbarOverflow(false);
                    }}>
                    Year-over-Year {yoyMode ? '(on)' : ''}
                  </button>
                  {/* Tooltip mode */}
                  <div style={{ padding: '6px 14px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>Tooltip</span>
                    <div style={{ marginTop: 4 }}>
                      <SegmentedControl
                        options={[{ value: 'index', label: 'Combined' }, { value: 'nearest', label: 'Single' }]}
                        value={tooltipMode}
                        onChange={v => { setTooltipMode(v); setShowToolbarOverflow(false); }}
                      />
                    </div>
                  </div>
                  {/* Rate mode */}
                  <div style={{ padding: '6px 14px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>Rate Mode</span>
                    <div style={{ marginTop: 4 }}>
                      <SegmentedControl
                        options={[{ value: 'current', label: 'Current' }, { value: 'snapshot', label: loadingRates ? 'Loading...' : 'Snapshot' }]}
                        value={rateMode}
                        onChange={v => { handleRateModeChange(v); setShowToolbarOverflow(false); }}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="card mb-4" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Breakdown dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Breakdown:</span>
            <select
              className="form-control"
              aria-label="Breakdown"
              style={{ width: 'auto', minWidth: 140, fontSize: 13 }}
              value={breakdown}
              onChange={e => {
                const v = e.target.value;
                setBreakdown(v);
                sessionStorage.setItem('pv_portfolio_breakdown', v);
              }}
            >
              <option value="none">None</option>
              <option value="type">Asset Type</option>
              <option value="country">Country</option>
              <option value="account">Account</option>
              <option value="currency">Currency</option>
              <option value="asset">Asset</option>
            </select>
          </div>

          {/* Independent asset class filter */}
          {allTypes.size > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Asset Type:</span>
              <select
                className="form-control"
                aria-label="Asset class filter"
                style={{ width: 'auto', minWidth: 120, fontSize: 13, padding: '2px 24px 2px 8px' }}
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
              >
                <option value="all">All</option>
                {[...allTypes.entries()].map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Independent country filter */}
          {allCountries.size > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Country:</span>
              <select
                className="form-control"
                aria-label="Country filter"
                style={{ width: 'auto', minWidth: 120, fontSize: 13, padding: '2px 24px 2px 8px' }}
                value={filterCountry}
                onChange={e => setFilterCountry(e.target.value)}
              >
                <option value="all">All</option>
                {[...allCountries.entries()].map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Clear filters button */}
          {hasActiveFilter && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => { setFilterType('all'); setFilterCountry('all'); }}>
              Clear filters
            </button>
          )}

          {/* View mode toggle */}
          <SegmentedControl
            options={[{ value: 'values', label: 'Values' }, { value: 'percent', label: '% Allocation' }]}
            value={showPercent ? 'percent' : 'values'}
            onChange={v => { if (!yoyMode) setShowPercent(v === 'percent'); }}
          />

          {/* Year-over-year toggle */}
          <button
            className={`btn btn-sm ${yoyMode ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              const next = !yoyMode;
              setYoyMode(next);
              if (next && showPercent) setShowPercent(false);
            }}
            disabled={showPercent}
            title="Compare with previous year"
            style={{ fontSize: 12 }}
          >
            YoY
          </button>

          {/* Tooltip mode toggle */}
          <SegmentedControl
            options={[{ value: 'index', label: 'Combined' }, { value: 'nearest', label: 'Single' }]}
            value={tooltipMode}
            onChange={setTooltipMode}
          />

          {/* Rate mode — gear icon popover */}
          <div style={{ position: 'relative', marginLeft: 'auto' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowRateSettings(prev => !prev)} title="Rate settings">
              <Settings size={16} />
            </button>
            {showRateSettings && (
              <div className="card" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, padding: '10px 14px', zIndex: 20, minWidth: 180, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Rate Mode</span>
                <SegmentedControl
                  options={[{ value: 'current', label: 'Current' }, { value: 'snapshot', label: loadingRates ? 'Loading...' : 'Snapshot' }]}
                  value={rateMode}
                  onChange={v => { handleRateModeChange(v); setShowRateSettings(false); }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Zone 2 — Hero Chart (with date range inside) */}
      {chartData.length >= 1 && (
        <div className="card mb-4" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              {yoyMode
                ? `Year-over-Year${filterDesc ? ` — ${filterDesc}` : ''}`
                : showPercent
                  ? 'Allocation Over Time'
                  : filterDesc ? `${filterDesc} — Portfolio Over Time` : 'Portfolio Over Time'}
              {yoyMode && yoyData?.prevYearData.length === 0 && (
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                  (no previous year data)
                </span>
              )}
            </h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isZoomed && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { heroChartRef.current?.resetZoom(); setIsZoomed(false); }}
                  style={{ fontSize: 12 }}
                >
                  Reset Zoom
                </button>
              )}
            <SegmentedControl
              options={[
                { value: 'all', label: 'All' },
                { value: '3m', label: '3M' },
                { value: '6m', label: '6M' },
                { value: '1y', label: '1Y' },
                { value: 'ytd', label: 'YTD' },
              ]}
              value={dateRange}
              onChange={setDateRange}
            />
            </div>
          </div>
          <div style={{ minHeight: 300, height: '40vh', maxHeight: 500 }}>
            <CJSLine
              ref={heroChartRef}
              data={yoyMode && heroYoYData ? heroYoYData : (showPercent ? heroPercentData : heroLineData)}
              options={heroOptions}
              plugins={[heroSyncPlugin]}
            />
          </div>
        </div>
      )}

      {/* Zone 3 — Delta Bar Chart */}
      {deltaData.length > 0 && (
        <div className="card mb-4" style={{ padding: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{showPercent ? '% Change Between Snapshots' : 'Period Change'}</h4>
          <div style={{ height: 250 }}>
            <CJSBar ref={deltaChartRef} data={deltaChartData} options={deltaOptions} plugins={[deltaSyncPlugin]} />
          </div>
        </div>
      )}

      {/* Zone 4 — Collapsible Snapshot Table */}
      <div className="card">
        <div
          style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setTableExpanded(e => !e)}
        >
          {tableExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Snapshots ({[...snapshotSummaryMap.values()].length})
          </span>
        </div>
        {tableExpanded && (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Net Worth</th>
                  <th style={{ textAlign: 'right' }}>Assets</th>
                  <th style={{ textAlign: 'right' }}>Liabilities</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredSnapshots].reverse().map((s, i) => {
                  const snapKey = s.id ?? (filteredSnapshots.length - 1 - i);
                  const summary = filteredSummaryMap.get(snapKey);
                  if (!summary) return null;
                  return (
                    <tr key={snapKey} style={{ cursor: 'pointer' }} onClick={() => { setSelectedSnapshot(s); setExpandedTypes({}); }}>
                      <td>{s.snapshot_date}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(summary.net_worth)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtD(summary.total_assets)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtD(summary.total_liabilities)}</td>
                      <td style={{ textAlign: 'right' }}>{summary.asset_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div style={{ padding: '8px 16px 12px' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => loadSnapshots(nextCursor, true)}
              disabled={loadingMore}
              style={{ fontSize: 12 }}
            >
              {loadingMore ? 'Loading...' : 'Load older snapshots'}
            </button>
          </div>
        )}
      </div>

      {/* Snapshot stale price prompt */}
      {snapshotPrompt && (
        <div className="modal-overlay" onClick={() => setSnapshotPrompt(null)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Prices May Be Outdated</h3>
              <button className="modal-close-btn" onClick={() => setSnapshotPrompt(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>Some stock/crypto prices may not have been saved to your entries.</span>
              </div>
              <p className="text-muted" style={{ fontSize: 13 }}>The snapshot will capture the values currently stored in your vault entries. To get the latest prices, cancel and run Refresh All first.</p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-outline" onClick={() => setSnapshotPrompt(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doSaveSnapshot} disabled={snapshotSaving}>
                {snapshotSaving ? 'Saving...' : 'Save with current values'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Detail Modal */}
      <Modal isOpen={!!selectedSnapshot} onClose={() => setSelectedSnapshot(null)} title={`Snapshot — ${selectedSnapshot?.snapshot_date || ''}`} size="lg">
        {selectedSnapshot && (() => {
          const summary = getSnapshotSummary(selectedSnapshot);
          if (!summary) return <p className="text-muted">No entry data available for this snapshot.</p>;

          // Build groups based on snapshotGroupBy mode
          const groups = {};
          for (const entry of summary.entries) {
            let key, label, isLiability;
            if (snapshotGroupBy === 'account') {
              const acctId = entry.linked_account?.id;
              key = acctId ? String(acctId) : '_unlinked';
              label = entry.linked_account?.name || 'Not linked to an account';
              isLiability = entry.is_liability;
            } else {
              key = entry.template_name || entry.subtype || 'Other';
              label = key;
              isLiability = entry.is_liability;
            }
            if (!groups[key]) groups[key] = { label, entries: [], total: 0, isLiability };
            groups[key].entries.push(entry);
            groups[key].total += entry.displayValue || 0;
          }

          return (
            <>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
                {[
                  { label: 'Net Worth', value: summary.net_worth, color: 'var(--color-primary)' },
                  { label: 'Assets', value: summary.total_assets, color: 'var(--success)' },
                  { label: 'Liabilities', value: summary.total_liabilities, color: 'var(--danger)' },
                  { label: 'Entries', value: summary.asset_count, raw: true },
                ].map(c => (
                  <div key={c.label} style={{
                    background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 16px',
                    textAlign: 'center', border: '1px solid var(--border)',
                  }}>
                    <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>{c.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: c.color }}>
                      {c.raw ? c.value : (hideAmounts ? MASKED : fmtD(c.value))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Group-by toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>Group By:</span>
                <SegmentedControl
                  options={[{ value: 'type', label: 'Type' }, { value: 'account', label: 'Account' }]}
                  value={snapshotGroupBy}
                  onChange={v => { setSnapshotGroupBy(v); setExpandedTypes({}); }}
                />
              </div>

              {/* Collapsible sections */}
              {Object.entries(groups).map(([key, group]) => {
                const isOpen = !!expandedTypes[key];
                return (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setExpandedTypes(prev => ({ ...prev, [key]: !prev[key] }))}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px', borderRadius: 6, background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="font-medium">{group.label}</span>
                        <span className="text-muted" style={{ fontSize: 12 }}>({group.entries.length})</span>
                      </span>
                      <span style={{ fontWeight: 500, fontSize: 13, color: group.isLiability ? 'var(--danger)' : undefined }}>
                        {hideAmounts ? MASKED : fmtD(group.total)}
                      </span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '4px 0 0 0' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              {snapshotGroupBy === 'account' && <th>Type</th>}
                              <th>Currency</th>
                              <th style={{ textAlign: 'right' }}>Value ({displayCurrency})</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.entries.map((e, j) => (
                              <tr key={j}>
                                <td className="font-medium">{e.name}</td>
                                {snapshotGroupBy === 'account' && (
                                  <td><span className="badge badge-primary">{e.template_name || e.subtype || '--'}</span></td>
                                )}
                                <td className="text-muted">{e.currency || '--'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 500, color: e.is_liability ? 'var(--danger)' : undefined }}>
                                  {hideAmounts ? MASKED : fmtD(e.displayValue)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          );
        })()}
      </Modal>
    </>
  );
}

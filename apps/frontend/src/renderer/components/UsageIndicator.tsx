/**
 * Usage Indicator - Real-time Claude usage display in header
 *
 * Displays current session/weekly usage as a badge with color-coded status.
 * Shows detailed usage analytics dashboard in a popover on click.
 */

import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, AlertCircle, Clock, User, Info, Key } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { useTranslation } from 'react-i18next';
import { formatTimeRemaining, localizeUsageWindowLabel, hasHardcodedText } from '../../shared/utils/format-time';
import type { ClaudeUsageSnapshot } from '../../shared/types/agent';
import type { APIProfile } from '../../shared/types/profile';
import { useSettingsStore } from '../stores/settings-store';

export function UsageIndicator() {
  const { t, i18n } = useTranslation(['common', 'tasks']);
  const [usage, setUsage] = useState<ClaudeUsageSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(false);

  // Filter bar state
  const [timePeriod, setTimePeriod] = useState<'7d' | '30d'>('7d');
  const [chartType, setChartType] = useState<'area' | 'line' | 'bar'>('area');
  const [metric, setMetric] = useState<'tokens' | 'tools'>('tokens');

  // Profile selection
  const { profiles, activeProfileId, setActiveProfile } = useSettingsStore();

  const handleProfileChange = async (profileId: string) => {
    await setActiveProfile(profileId);
    // Request usage data refresh for the new profile
    try {
      const result = await window.electronAPI.requestUsageUpdate();
      if (result.success && result.data) {
        setUsage(result.data);
        setIsAvailable(true);
      } else {
        setIsAvailable(false);
      }
    } catch (error) {
      console.warn('[UsageIndicator] Failed to refresh usage after profile change:', error);
      setIsAvailable(false);
    }
  };

  /**
   * Helper function to format large numbers with locale-aware compact notation
   *
   * Returns undefined for null/undefined values. The caller (JSX conditional guards)
   * is responsible for checking values before calling this function.
   *
   * @param value - The number to format (undefined, null, or number)
   * @returns Formatted compact number string (e.g., "1.2K", "3.4M"), or undefined if input is null/undefined
   *
   * @example
   * formatUsageValue(1234) // "1.2K" (en-US)
   * formatUsageValue(null) // undefined
   * formatUsageValue(undefined) // undefined
   */
  const formatUsageValue = (value?: number | null): string | undefined => {
    if (value == null) return undefined;

    // Use Intl.NumberFormat for locale-aware compact number formatting
    // Fallback to toString() if Intl is not available
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      try {
        return new Intl.NumberFormat(i18n.language, {
          notation: 'compact',
          compactDisplay: 'short',
          maximumFractionDigits: 2
        }).format(value);
      } catch {
        // Intl may fail in some environments, fall back to toString()
      }
    }
    return value.toString();
  };

  // Get formatted reset times (calculated dynamically from timestamps)
  // Only fall back to sessionResetTime/weeklyResetTime if they don't contain placeholder/hardcoded text
  const sessionResetTime = usage?.sessionResetTimestamp
    ? (formatTimeRemaining(usage.sessionResetTimestamp, t) ??
      (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime))
    : (hasHardcodedText(usage?.sessionResetTime) ? undefined : usage?.sessionResetTime);
  const weeklyResetTime = usage?.weeklyResetTimestamp
    ? (formatTimeRemaining(usage.weeklyResetTimestamp, t) ??
      (hasHardcodedText(usage?.weeklyResetTime) ? undefined : usage?.weeklyResetTime))
    : (hasHardcodedText(usage?.weeklyResetTime) ? undefined : usage?.weeklyResetTime);

  useEffect(() => {
    // Listen for usage updates from main process
    const unsubscribe = window.electronAPI.onUsageUpdated((snapshot: ClaudeUsageSnapshot) => {
      setUsage(snapshot);
      setIsAvailable(true);
      setIsLoading(false);
    });

    // Request initial usage on mount
    window.electronAPI.requestUsageUpdate().then((result) => {
      setIsLoading(false);
      if (result.success && result.data) {
        setUsage(result.data);
        setIsAvailable(true);
      } else {
        // No usage data available (endpoint not supported or error)
        setIsAvailable(false);
      }
    }).catch((error) => {
      // Handle errors (IPC failure, network issues, etc.)
      console.warn('[UsageIndicator] Failed to fetch initial usage:', error);
      setIsLoading(false);
      setIsAvailable(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Always show the badge, but display different states
  // Show loading state initially
  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#161618] text-gray-400">
        <Activity className="h-3.5 w-3.5 motion-safe:animate-pulse" />
        <span className="text-xs font-semibold">{t('common:usage.loading')}</span>
      </div>
    );
  }

  // Show unavailable state when endpoint doesn't return data
  if (!isAvailable || !usage) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#161618] text-gray-400 cursor-help">
            <Activity className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold">{t('common:usage.notAvailable')}</span>
          </div>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} className="text-xs w-64 bg-[#161618] border border-white/10">
          <div className="space-y-1">
            <p className="font-medium">{t('common:usage.dataUnavailable')}</p>
            <p className="text-gray-400 text-[10px]">
              {t('common:usage.dataUnavailableDescription')}
            </p>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Determine color based on session usage (5-hour window)
  // This is what should be shown on the badge per QA feedback
  const badgeUsage = usage.sessionPercent;
  const badgeColorClasses =
    badgeUsage >= 95 ? 'text-red-400 bg-red-500/10 border-red-500/20' :
    badgeUsage >= 91 ? 'text-orange-400 bg-orange-500/10 border-orange-500/20' :
    badgeUsage >= 71 ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' :
    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';

  // Get window labels for display
  // Map backend-provided labels to localized versions with appropriate defaults
  const sessionLabel = localizeUsageWindowLabel(
    usage?.usageWindows?.sessionWindowLabel,
    t,
    'common:usage.sessionDefault'
  );
  const weeklyLabel = localizeUsageWindowLabel(
    usage?.usageWindows?.weeklyWindowLabel,
    t,
    'common:usage.weeklyDefault'
  );

  // For icon, use the highest of the two windows
  const maxUsage = Math.max(usage.sessionPercent, usage.weeklyPercent);
  const Icon =
    maxUsage >= 91 ? AlertCircle :
    maxUsage >= 71 ? TrendingUp :
    Activity;

  /**
   * Filter Bar Component
   * Displays time period, chart type, and metric toggle buttons
   * TODO: Integrate into dashboard layout in Phase 4
   */
  const renderFilterBar = () => (
    <div className="flex flex-wrap items-center gap-2 p-2 border-b border-white/10 bg-[#161618]">
      {/* Time Period Toggle */}
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={timePeriod === '7d' ? 'default' : 'outline'}
          onClick={() => setTimePeriod('7d')}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            timePeriod === '7d'
              ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0'
              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
          }`}
        >
          {t('common:usage.dashboard.timePeriod7Days')}
        </Button>
        <Button
          size="sm"
          variant={timePeriod === '30d' ? 'default' : 'outline'}
          onClick={() => setTimePeriod('30d')}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            timePeriod === '30d'
              ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0'
              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
          }`}
        >
          {t('common:usage.dashboard.timePeriod30Days')}
        </Button>
      </div>

      {/* Chart Type Toggle */}
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={chartType === 'area' ? 'default' : 'outline'}
          onClick={() => setChartType('area')}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            chartType === 'area'
              ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0'
              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
          }`}
        >
          {t('common:usage.dashboard.chartTypeArea')}
        </Button>
        <Button
          size="sm"
          variant={chartType === 'line' ? 'default' : 'outline'}
          onClick={() => setChartType('line')}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            chartType === 'line'
              ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0'
              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
          }`}
        >
          {t('common:usage.dashboard.chartTypeLine')}
        </Button>
        <Button
          size="sm"
          variant={chartType === 'bar' ? 'default' : 'outline'}
          onClick={() => setChartType('bar')}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            chartType === 'bar'
              ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0'
              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
          }`}
        >
          {t('common:usage.dashboard.chartTypeBar')}
        </Button>
      </div>

      {/* Metric Toggle */}
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={metric === 'tokens' ? 'default' : 'outline'}
          onClick={() => setMetric('tokens')}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            metric === 'tokens'
              ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0'
              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
          }`}
        >
          {t('common:usage.dashboard.metricTokens')}
        </Button>
        <Button
          size="sm"
          variant={metric === 'tools' ? 'default' : 'outline'}
          onClick={() => setMetric('tools')}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            metric === 'tools'
              ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0'
              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
          }`}
        >
          {t('common:usage.dashboard.metricTools')}
        </Button>
      </div>
    </div>
  );

  /**
   * Dashboard Cards Component
   * 4-card grid layout: Token Usage, Tools Usage, Reset Schedule, Account Status
   * TODO: Wire up real data in Phase 2 (subtask-2-2)
   */
  const renderDashboardCards = () => {
    // Get active profile name - prioritize usage snapshot profile name, fall back to settings store
    const activeProfile = profiles?.find(p => p.id === activeProfileId);
    const profileName = usage?.profileName || activeProfile?.name || t('tasks:apiProfile.placeholder');

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-[#161618]">
        {/* Token Usage Card - 5H Quota */}
        <Card className="border border-white/10 bg-white/5 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
              <Activity className="h-4 w-4 text-indigo-400" />
              {t('common:usage.dashboard.cardTokenUsage')} ({t('common:usage.dashboard.tokenUsageQuota')})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold font-mono text-gray-100">
                  {usage ? Math.round(usage.sessionPercent) : 0}%
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {usage && usage.sessionUsageValue != null && usage.sessionUsageLimit != null
                    ? `${formatUsageValue(usage.sessionUsageValue)} / ${formatUsageValue(usage.sessionUsageLimit)}`
                    : t('common:usage.notAvailable')
                  }
                </span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    usage && usage.sessionPercent >= 95 ? 'bg-gradient-to-r from-red-500 to-red-400' :
                    usage && usage.sessionPercent >= 91 ? 'bg-gradient-to-r from-orange-500 to-orange-400' :
                    usage && usage.sessionPercent >= 71 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                    'bg-gradient-to-r from-emerald-500 to-emerald-400'
                  }`}
                  style={{ width: `${usage ? Math.min(usage.sessionPercent, 100) : 0}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tools Usage Card - Monthly */}
        <Card className="border border-white/10 bg-white/5 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
              <TrendingUp className="h-4 w-4 text-violet-400" />
              {t('common:usage.dashboard.cardToolsUsage')} ({t('common:usage.dashboard.toolsUsageMonthly')})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold font-mono text-gray-100">
                  {usage ? Math.round(usage.weeklyPercent) : 0}%
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {usage && usage.weeklyUsageValue != null && usage.weeklyUsageLimit != null
                    ? `${formatUsageValue(usage.weeklyUsageValue)} / ${formatUsageValue(usage.weeklyUsageLimit)}`
                    : t('common:usage.notAvailable')
                  }
                </span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    usage && usage.weeklyPercent >= 99 ? 'bg-gradient-to-r from-red-500 to-red-400' :
                    usage && usage.weeklyPercent >= 91 ? 'bg-gradient-to-r from-orange-500 to-orange-400' :
                    usage && usage.weeklyPercent >= 71 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                    'bg-gradient-to-r from-emerald-500 to-emerald-400'
                  }`}
                  style={{ width: `${usage ? Math.min(usage.weeklyPercent, 100) : 0}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reset Schedule Card */}
        <Card className="border border-white/10 bg-white/5 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
              <Clock className="h-4 w-4 text-indigo-400" />
              {t('common:usage.dashboard.cardResetSchedule')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">{t('common:usage.sessionDefault')}:</span>
                <span className="font-medium font-mono text-gray-200">
                  {sessionResetTime || t('common:usage.dashboard.loadingData')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">{t('common:usage.weeklyDefault')}:</span>
                <span className="font-medium font-mono text-gray-200">
                  {weeklyResetTime || t('common:usage.dashboard.loadingData')}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Status Card */}
        <Card className="border border-white/10 bg-white/5 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
              <User className="h-4 w-4 text-violet-400" />
              {t('common:usage.dashboard.cardAccountStatus')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{t('common:usage.profile')}:</span>
                <span className="text-xs font-medium truncate ml-2 text-gray-200" title={profileName}>
                  {profileName}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                <span className="text-xs font-medium text-emerald-400">{t('common:usage.dashboard.statusLive')}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  /**
   * Transform usage snapshot to chart data points
   * Converts ClaudeUsageSnapshot into day-by-day usage data for visualization
   *
   * @param snapshot - Current usage snapshot
   * @param timePeriod - '7d' or '30d' for number of days
   * @param metric - 'tokens' or 'tools' for usage metric
   * @returns Array of daily usage values (0-100 scale)
   *
   * NOTE: Currently generates realistic mock data based on current usage values.
   * When backend provides historical usage data, replace with actual history.
   */
  const transformUsageToChartData = (
    snapshot: ClaudeUsageSnapshot | null,
    timePeriod: '7d' | '30d',
    metric: 'tokens' | 'tools'
  ): number[] => {
    if (!snapshot) {
      // Return empty data if no snapshot available
      return [];
    }

    const daysCount = timePeriod === '7d' ? 7 : 30;
    const currentUsage = metric === 'tokens' ? snapshot.sessionPercent : snapshot.weeklyPercent;
    const currentLimit = metric === 'tokens'
      ? (snapshot.sessionUsageLimit ?? 100)
      : (snapshot.weeklyUsageLimit ?? 100);

    // Generate realistic trending data ending at current usage
    // This creates plausible historical data that leads to current state
    const dataPoints: number[] = [];
    const baseValue = currentUsage;

    // Create a realistic usage pattern with some randomness
    for (let i = 0; i < daysCount; i++) {
      // Weight recent days more heavily (trend toward current value)
      const recencyFactor = i / daysCount; // 0 to 1, increasing for later days
      const randomVariation = (Math.random() - 0.5) * 30; // ±15% variation
      const trend = baseValue * (0.6 + (recencyFactor * 0.4)); // 60% to 100% of current value

      let value = trend + randomVariation;

      // Clamp to valid range (0-100)
      value = Math.max(0, Math.min(100, value));

      dataPoints.push(value);
    }

    // Ensure last day matches current usage (for continuity)
    dataPoints[daysCount - 1] = baseValue;

    return dataPoints;
  };

  /**
   * Custom SVG Chart Component
   * Displays usage trends with configurable chart type (area/line/bar)
   * TODO: Replace placeholder data with real data in Phase 3 (subtask-2-4)
   */
  const renderChart = () => {
    // Transform usage snapshot to chart data points
    const dataPoints = transformUsageToChartData(usage, timePeriod, metric);

    // Fallback to placeholder if no data available
    const chartData = dataPoints.length > 0 ? dataPoints : [65, 72, 58, 81, 74, 69, 77];

    const chartWidth = 600;
    const chartHeight = 200;
    const padding = { top: 20, right: 20, bottom: 30, left: 40 };

    // Calculate scaling
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;

    // Generate path data for area/line charts
    const generatePathData = (data: number[]) => {
      const stepX = innerWidth / (data.length - 1);

      // Start at bottom-left
      let pathD = `M ${padding.left} ${chartHeight - padding.bottom}`;

      // Draw line through each data point
      data.forEach((value, index) => {
        const x = padding.left + (index * stepX);
        const y = padding.top + innerHeight - ((value / 100) * innerHeight);
        pathD += ` L ${x} ${y}`;
      });

      return pathD;
    };

    const pathData = generatePathData(chartData);

    return (
      <div className="w-full h-full flex items-center justify-center p-4 bg-[#161618]">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-full transition-all duration-300 ease-out"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Usage trend ${chartType} chart`}
        >
          {/* Gradient Definition (only for area chart) */}
          {chartType === 'area' && (
            <defs>
              <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#6366F1" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#6366F1" stopOpacity="0.05" />
              </linearGradient>
            </defs>
          )}

          {/* Grid Lines (horizontal) */}
          {[0, 25, 50, 75, 100].map((percent) => {
            const y = padding.top + innerHeight - ((percent / 100) * innerHeight);
            return (
              <g key={`grid-${percent}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={chartWidth - padding.right}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity="0.1"
                  strokeWidth="1"
                  className="text-gray-500 transition-opacity duration-300"
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="text-[10px] fill-gray-400 font-mono transition-all duration-300"
                >
                  {percent}%
                </text>
              </g>
            );
          })}

          {/* Area Chart: Area + Line Path */}
          {chartType === 'area' && (
            <g className="transition-all duration-300 ease-out">
              {/* Area Path */}
              <path
                d={pathData + ` L ${padding.left + innerWidth} ${chartHeight - padding.bottom} Z`}
                fill="url(#chartGradient)"
                stroke="none"
                className="transition-all duration-300 ease-out"
              />
              {/* Line Path (stroke only) */}
              <path
                d={pathData}
                fill="none"
                stroke="#6366F1"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-300 ease-out"
              />
            </g>
          )}

          {/* Line Chart: Stroke Only */}
          {chartType === 'line' && (
            <path
              d={pathData}
              fill="none"
              stroke="#6366F1"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-all duration-300 ease-out"
            />
          )}

          {/* Bar Chart: Vertical Bars */}
          {chartType === 'bar' && (() => {
            const barWidth = (innerWidth / chartData.length) * 0.6; // 60% of available space
            const barGap = (innerWidth / chartData.length) * 0.4; // 40% gap

            return (
              <g className="transition-all duration-300 ease-out">
                {chartData.map((value, index) => {
                  const x = padding.left + (index * (innerWidth / chartData.length)) + (barGap / 2);
                  const barHeight = ((value / 100) * innerHeight);
                  const y = padding.top + innerHeight - barHeight;

                  return (
                    <rect
                      key={`bar-${index}`}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill="#6366F1"
                      className="hover:fill-indigo-400 transition-all duration-200 ease-out"
                    />
                  );
                })}
              </g>
            );
          })()}

          {/* Data Points (only for area and line charts) */}
          {chartType !== 'bar' && chartData.map((value, index) => {
            const stepX = innerWidth / (chartData.length - 1);
            const x = padding.left + (index * stepX);
            const y = padding.top + innerHeight - ((value / 100) * innerHeight);

            return (
              <circle
                key={`point-${index}`}
                cx={x}
                cy={y}
                r="4"
                fill="#6366F1"
                stroke="#8B5CF6"
                strokeWidth="2"
                className="hover:r-6 transition-all duration-200 ease-out"
              />
            );
          })}

          {/* X-Axis Labels (Days) */}
          {chartData.map((_, index) => {
            const stepX = chartType === 'bar'
              ? innerWidth / chartData.length
              : innerWidth / (chartData.length - 1);
            const x = padding.left + (index * stepX) + (chartType === 'bar' ? stepX / 2 : 0);

            return (
              <text
                key={`label-${index}`}
                x={x}
                y={chartHeight - padding.bottom + 20}
                textAnchor="middle"
                className="text-[10px] fill-gray-400 font-mono transition-all duration-300"
              >
                {t('common:usage.dashboard.chartAxisDay')} {index + 1}
              </text>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#161618] transition-all hover:opacity-80 ${badgeColorClasses}`}
          aria-label={t('common:usage.usageStatusAriaLabel')}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold font-mono text-gray-200">
            {Math.round(badgeUsage)}%
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="text-xs w-[min(600px,calc(100vw-32px))] p-0 bg-[#161618] border border-white/10 max-h-[600px] overflow-y-auto">
        <div className="p-3 space-y-3">
          {/* Header with overall status */}
          <div className="flex items-center pb-2 border-b border-white/10">
            <Icon className="h-3.5 w-3.5 text-indigo-400" />
            <span className="font-semibold text-xs text-gray-200">{t('common:usage.usageBreakdown')}</span>
          </div>

          {/* Filter Bar */}
          {renderFilterBar()}

          {/* Chart Visualization */}
          <div className="h-[min(200px,40vw)] border border-white/10 rounded-lg overflow-hidden">
            {renderChart()}
          </div>

          {/* Dashboard Cards */}
          {renderDashboardCards()}

          {/* Session/5-hour usage */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 font-medium text-[11px] flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {sessionLabel}
              </span>
              <span className={`font-semibold font-mono text-xs ${
                usage.sessionPercent >= 95 ? 'text-red-400' :
                usage.sessionPercent >= 91 ? 'text-orange-400' :
                usage.sessionPercent >= 71 ? 'text-yellow-400' :
                'text-emerald-400'
              }`}>
                {Math.round(usage.sessionPercent)}%
              </span>
            </div>
            {sessionResetTime && (
              <div className="text-[10px] text-gray-400 pl-4 flex items-center gap-1">
                <Info className="h-2.5 w-2.5" />
                {sessionResetTime}
              </div>
            )}
            {/* Enhanced progress bar with gradient */}
            <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden ${
                  usage.sessionPercent >= 95 ? 'bg-gradient-to-r from-red-500 to-red-400' :
                  usage.sessionPercent >= 91 ? 'bg-gradient-to-r from-orange-500 to-orange-400' :
                  usage.sessionPercent >= 71 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                  'bg-gradient-to-r from-emerald-500 to-emerald-400'
                }`}
                style={{ width: `${Math.min(usage.sessionPercent, 100)}%` }}
              >
                {/* Subtle shine effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent motion-safe:animate-pulse" />
              </div>
            </div>
            {/* Raw usage value with better styling */}
            {usage.sessionUsageValue != null && usage.sessionUsageLimit != null && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-400">{t('common:usage.used')}</span>
                <span className="font-medium font-mono text-gray-200">
                  {formatUsageValue(usage.sessionUsageValue)} <span className="text-gray-400 mx-1">/</span> {formatUsageValue(usage.sessionUsageLimit)}
                </span>
              </div>
            )}
          </div>

          {/* Weekly/Monthly usage */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 font-medium text-[11px] flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {weeklyLabel}
              </span>
              <span className={`font-semibold font-mono text-xs ${
                usage.weeklyPercent >= 99 ? 'text-red-400' :
                usage.weeklyPercent >= 91 ? 'text-orange-400' :
                usage.weeklyPercent >= 71 ? 'text-yellow-400' :
                'text-emerald-400'
              }`}>
                {Math.round(usage.weeklyPercent)}%
              </span>
            </div>
            {weeklyResetTime && (
              <div className="text-[10px] text-gray-400 pl-4 flex items-center gap-1">
                <Info className="h-2.5 w-2.5" />
                {weeklyResetTime}
              </div>
            )}
            {/* Enhanced progress bar with gradient */}
            <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden ${
                  usage.weeklyPercent >= 99 ? 'bg-gradient-to-r from-red-500 to-red-400' :
                  usage.weeklyPercent >= 91 ? 'bg-gradient-to-r from-orange-500 to-orange-400' :
                  usage.weeklyPercent >= 71 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                  'bg-gradient-to-r from-emerald-500 to-emerald-400'
                }`}
                style={{ width: `${Math.min(usage.weeklyPercent, 100)}%` }}
              >
                {/* Subtle shine effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent motion-safe:animate-pulse" />
              </div>
            </div>
            {/* Raw usage value with better styling */}
            {usage.weeklyUsageValue != null && usage.weeklyUsageLimit != null && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-400">{t('common:usage.used')}</span>
                <span className="font-medium font-mono text-gray-200">
                  {formatUsageValue(usage.weeklyUsageValue)} <span className="text-gray-400 mx-1">/</span> {formatUsageValue(usage.weeklyUsageLimit)}
                </span>
              </div>
            )}
          </div>

          {/* Profile selector */}
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <User className="h-3 w-3" />
              <span>{t('common:usage.activeAccount')}</span>
            </div>
            <Select
              value={activeProfileId || undefined}
              onValueChange={handleProfileChange}
              disabled={!profiles || profiles.length === 0}
            >
              <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-gray-200">
                <SelectValue placeholder={t('tasks:apiProfile.placeholder')} />
              </SelectTrigger>
              <SelectContent className="bg-[#161618] border-white/10">
                {profiles && profiles.length > 0 ? (
                  profiles.map((profile: APIProfile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      <div className="flex items-center gap-2">
                        <Key className="h-3 w-3 shrink-0 text-indigo-400" />
                        <div>
                          <span className="font-medium text-xs text-gray-200">{profile.name}</span>
                          <span className="ml-2 text-[10px] text-gray-400">
                            ({profile.baseUrl})
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="empty" disabled>
                    {t('tasks:apiProfile.empty')}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

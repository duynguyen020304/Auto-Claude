/**
 * Usage Indicator - Real-time Claude usage display in header
 *
 * Displays current session/weekly usage as a badge with color-coded status.
 * Shows detailed breakdown on hover.
 */

import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, AlertCircle, Clock, User, ChevronRight, Info, Key } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import { Button } from './ui/button';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
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
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-muted/50 text-muted-foreground">
        <Activity className="h-3.5 w-3.5 motion-safe:animate-pulse" />
        <span className="text-xs font-semibold">{t('common:usage.loading')}</span>
      </div>
    );
  }

  // Show unavailable state when endpoint doesn't return data
  if (!isAvailable || !usage) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-muted/50 text-muted-foreground cursor-help">
              <Activity className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">{t('common:usage.notAvailable')}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs w-64">
            <div className="space-y-1">
              <p className="font-medium">{t('common:usage.dataUnavailable')}</p>
              <p className="text-muted-foreground text-[10px]">
                {t('common:usage.dataUnavailableDescription')}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Determine color based on session usage (5-hour window)
  // This is what should be shown on the badge per QA feedback
  const badgeUsage = usage.sessionPercent;
  const badgeColorClasses =
    badgeUsage >= 95 ? 'text-red-500 bg-red-500/10 border-red-500/20' :
    badgeUsage >= 91 ? 'text-orange-500 bg-orange-500/10 border-orange-500/20' :
    badgeUsage >= 71 ? 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20' :
    'text-green-500 bg-green-500/10 border-green-500/20';

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
    <div className="flex items-center gap-2 p-2 border-b border-white/10">
      {/* Time Period Toggle */}
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={timePeriod === '7d' ? 'default' : 'outline'}
          onClick={() => setTimePeriod('7d')}
          className="h-7 px-3 text-xs"
        >
          7 Days
        </Button>
        <Button
          size="sm"
          variant={timePeriod === '30d' ? 'default' : 'outline'}
          onClick={() => setTimePeriod('30d')}
          className="h-7 px-3 text-xs"
        >
          30 Days
        </Button>
      </div>

      {/* Chart Type Toggle */}
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={chartType === 'area' ? 'default' : 'outline'}
          onClick={() => setChartType('area')}
          className="h-7 px-3 text-xs"
        >
          Area
        </Button>
        <Button
          size="sm"
          variant={chartType === 'line' ? 'default' : 'outline'}
          onClick={() => setChartType('line')}
          className="h-7 px-3 text-xs"
        >
          Line
        </Button>
        <Button
          size="sm"
          variant={chartType === 'bar' ? 'default' : 'outline'}
          onClick={() => setChartType('bar')}
          className="h-7 px-3 text-xs"
        >
          Bar
        </Button>
      </div>

      {/* Metric Toggle */}
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={metric === 'tokens' ? 'default' : 'outline'}
          onClick={() => setMetric('tokens')}
          className="h-7 px-3 text-xs"
        >
          Tokens
        </Button>
        <Button
          size="sm"
          variant={metric === 'tools' ? 'default' : 'outline'}
          onClick={() => setMetric('tools')}
          className="h-7 px-3 text-xs"
        >
          Tools
        </Button>
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all hover:opacity-80 ${badgeColorClasses}`}
            aria-label={t('common:usage.usageStatusAriaLabel')}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold font-mono">
              {Math.round(badgeUsage)}%
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs w-72 p-0">
          <div className="p-3 space-y-3">
            {/* Header with overall status */}
            <div className="flex items-center pb-2 border-b">
              <Icon className="h-3.5 w-3.5" />
              <span className="font-semibold text-xs">{t('common:usage.usageBreakdown')}</span>
            </div>

            {/* Session/5-hour usage */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium text-[11px] flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {sessionLabel}
                </span>
                <span className={`font-semibold tabular-nums text-xs ${
                  usage.sessionPercent >= 95 ? 'text-red-500' :
                  usage.sessionPercent >= 91 ? 'text-orange-500' :
                  usage.sessionPercent >= 71 ? 'text-yellow-600' :
                  'text-green-600'
                }`}>
                  {Math.round(usage.sessionPercent)}%
                </span>
              </div>
              {sessionResetTime && (
                <div className="text-[10px] text-muted-foreground pl-4 flex items-center gap-1">
                  <Info className="h-2.5 w-2.5" />
                  {sessionResetTime}
                </div>
              )}
              {/* Enhanced progress bar with gradient */}
              <div className="h-2 bg-muted rounded-full overflow-hidden shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden ${
                    usage.sessionPercent >= 95 ? 'bg-gradient-to-r from-red-600 to-red-500' :
                    usage.sessionPercent >= 91 ? 'bg-gradient-to-r from-orange-600 to-orange-500' :
                    usage.sessionPercent >= 71 ? 'bg-gradient-to-r from-yellow-600 to-yellow-500' :
                    'bg-gradient-to-r from-green-600 to-green-500'
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
                  <span className="text-muted-foreground">{t('common:usage.used')}</span>
                  <span className="font-medium tabular-nums">
                    {formatUsageValue(usage.sessionUsageValue)} <span className="text-muted-foreground mx-1">/</span> {formatUsageValue(usage.sessionUsageLimit)}
                  </span>
                </div>
              )}
            </div>

            {/* Weekly/Monthly usage */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium text-[11px] flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {weeklyLabel}
                </span>
                <span className={`font-semibold tabular-nums text-xs ${
                  usage.weeklyPercent >= 99 ? 'text-red-500' :
                  usage.weeklyPercent >= 91 ? 'text-orange-500' :
                  usage.weeklyPercent >= 71 ? 'text-yellow-600' :
                  'text-green-600'
                }`}>
                  {Math.round(usage.weeklyPercent)}%
                </span>
              </div>
              {weeklyResetTime && (
                <div className="text-[10px] text-muted-foreground pl-4 flex items-center gap-1">
                  <Info className="h-2.5 w-2.5" />
                  {weeklyResetTime}
                </div>
              )}
              {/* Enhanced progress bar with gradient */}
              <div className="h-2 bg-muted rounded-full overflow-hidden shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden ${
                    usage.weeklyPercent >= 99 ? 'bg-gradient-to-r from-red-600 to-red-500' :
                    usage.weeklyPercent >= 91 ? 'bg-gradient-to-r from-orange-600 to-orange-500' :
                    usage.weeklyPercent >= 71 ? 'bg-gradient-to-r from-yellow-600 to-yellow-500' :
                    'bg-gradient-to-r from-green-600 to-green-500'
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
                  <span className="text-muted-foreground">{t('common:usage.used')}</span>
                  <span className="font-medium tabular-nums">
                    {formatUsageValue(usage.weeklyUsageValue)} <span className="text-muted-foreground mx-1">/</span> {formatUsageValue(usage.weeklyUsageLimit)}
                  </span>
                </div>
              )}
            </div>

            {/* Profile selector */}
            <div className="pt-2 border-t space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <User className="h-3 w-3" />
                <span>{t('common:usage.activeAccount')}</span>
              </div>
              <Select
                value={activeProfileId || undefined}
                onValueChange={handleProfileChange}
                disabled={!profiles || profiles.length === 0}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t('tasks:apiProfile.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles && profiles.length > 0 ? (
                    profiles.map((profile: APIProfile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        <div className="flex items-center gap-2">
                          <Key className="h-3 w-3 shrink-0" />
                          <div>
                            <span className="font-medium text-xs">{profile.name}</span>
                            <span className="ml-2 text-[10px] text-muted-foreground">
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
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

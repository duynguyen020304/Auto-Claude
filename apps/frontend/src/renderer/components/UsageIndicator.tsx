/**
 * Usage Indicator - Real-time Claude usage display in header
 *
 * Displays current session/weekly usage as a badge with color-coded status.
 * Shows detailed usage analytics dashboard in a popover on click.
 */

import React, { useState, useEffect } from "react";
import {
  Activity,
  TrendingUp,
  AlertCircle,
  Clock,
  User,
  Key,
  Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { useTranslation } from "react-i18next";
import {
  formatTimeRemaining,
  formatTimeAgo,
  localizeUsageWindowLabel,
  hasHardcodedText,
} from "../../shared/utils/format-time";
import type {
  ClaudeUsageSnapshot,
  DailyUsageData,
} from "../../shared/types/agent";
import type { APIProfile } from "../../shared/types/profile";
import { detectProvider } from "../../shared/utils/provider-detection";
import { useSettingsStore } from "../stores/settings-store";

export function UsageIndicator() {
  const { t, i18n } = useTranslation(["common", "tasks"]);
  const [usage, setUsage] = useState<ClaudeUsageSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(false);

  // Filter bar state
  const [timePeriod, setTimePeriod] = useState<"7d" | "30d">("7d");
  const [chartType, setChartType] = useState<"area" | "line" | "bar">("area");
  const [metric, setMetric] = useState<"tokens" | "tools">("tokens");

  // Profile selection state
  const { profiles, activeProfileId, setActiveProfile } = useSettingsStore();
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Historical usage state
  const [historicalUsage, setHistoricalUsage] = useState<{
    data7d: DailyUsageData[] | null;
    data30d: DailyUsageData[] | null;
    isLoading: boolean;
    error: string | null;
  }>({
    data7d: null,
    data30d: null,
    isLoading: false,
    error: null,
  });

  // Chart hover state
  const [hoveredPoint, setHoveredPoint] = useState<{
    index: number;
    value: number;
    label: string;
  } | null>(null);

  const handleProfileChange = async (profileId: string) => {
    setIsSwitchingProfile(true);
    setProfileError(null);

    try {
      // Invalidate cache for previous profile when switching
      if (activeProfileId) {
        useSettingsStore.getState().invalidateUsageCache(activeProfileId);
        useSettingsStore
          .getState()
          .invalidateHistoricalUsageCache(activeProfileId);
        setHistoricalUsage({
          data7d: null,
          data30d: null,
          isLoading: false,
          error: null,
        });
      }

      await setActiveProfile(profileId);

      // Request usage data refresh for the new profile
      const result = await window.electronAPI.requestUsageUpdate();

      if (result.success && result.data) {
        setUsage(result.data);
        setIsAvailable(true);

        // Cache the new profile's usage data
        useSettingsStore.getState().setCachedUsage(profileId, result.data);
      } else {
        // Profile switched but no usage data available
        setUsage(null);
        setIsAvailable(false);
      }
    } catch (error) {
      // Profile switching failed - revert and show error
      console.warn("[UsageIndicator] Failed to switch profile:", error);
      setProfileError(t("common:usage.dashboard.profileSwitchFailed"));
      setIsAvailable(false);

      // Revert to previous profile after a short delay
      setTimeout(() => {
        if (activeProfileId) {
          setActiveProfile(activeProfileId).catch(() => {
            // If revert also fails, just clear the error
            setProfileError(null);
          });
        }
        setProfileError(null);
      }, 2000);
    } finally {
      setIsSwitchingProfile(false);
    }
  };

  /**
   * Helper function to format large numbers with locale-aware compact notation
   */
  const formatUsageValue = (value?: number | null): string | undefined => {
    if (value == null) return undefined;

    // Use Intl.NumberFormat for locale-aware compact number formatting
    // Fallback to toString() if Intl is not available
    if (typeof Intl !== "undefined" && Intl.NumberFormat) {
      try {
        return new Intl.NumberFormat(i18n.language, {
          notation: "compact",
          compactDisplay: "short",
          maximumFractionDigits: 2,
        }).format(value);
      } catch {
        // Intl may fail in some environments, fall back to toString()
      }
    }
    return value.toString();
  };

  // Get formatted reset times (calculated dynamically from timestamps)
  const sessionResetTime = usage?.sessionResetTimestamp
    ? (formatTimeRemaining(usage.sessionResetTimestamp, t) ??
      (hasHardcodedText(usage?.sessionResetTime)
        ? undefined
        : usage?.sessionResetTime))
    : hasHardcodedText(usage?.sessionResetTime)
      ? undefined
      : usage?.sessionResetTime;
  const weeklyResetTime = usage?.weeklyResetTimestamp
    ? (formatTimeRemaining(usage.weeklyResetTimestamp, t) ??
      (hasHardcodedText(usage?.weeklyResetTime)
        ? undefined
        : usage?.weeklyResetTime))
    : hasHardcodedText(usage?.weeklyResetTime)
      ? undefined
      : usage?.weeklyResetTime;

  useEffect(() => {
    // Listen for usage updates from main process
    const unsubscribe = window.electronAPI.onUsageUpdated(
      (snapshot: ClaudeUsageSnapshot) => {
        setUsage(snapshot);
        setIsAvailable(true);
        setIsLoading(false);

        // Update cache when fresh data arrives
        if (activeProfileId) {
          useSettingsStore.getState().setCachedUsage(activeProfileId, snapshot);
        }
      },
    );

    // Cache-first: Check for cached data before fetching
    const loadUsageData = async () => {
      // Check cache first if we have an active profile
      if (activeProfileId) {
        const cached = useSettingsStore
          .getState()
          .getCachedUsage(activeProfileId);
        if (cached) {
          console.log("[UsageIndicator] Cache hit - using cached data");
          setUsage(cached);
          setIsAvailable(true);
          setIsLoading(false);
        } else {
          console.log("[UsageIndicator] Cache miss - showing loading state");
          setIsLoading(true);
        }
      } else {
        setIsLoading(true);
      }

      // Request fresh data in background
      try {
        const result = await window.electronAPI.requestUsageUpdate();

        // Only update loading state if we didn't have cached data
        if (activeProfileId) {
          const hadCache =
            useSettingsStore.getState().getCachedUsage(activeProfileId) !==
            null;
          if (!hadCache) {
            setIsLoading(false);
          }
        } else {
          setIsLoading(false);
        }

        if (result.success && result.data) {
          setUsage(result.data);
          setIsAvailable(true);

          // Cache the fresh data
          if (activeProfileId) {
            useSettingsStore
              .getState()
              .setCachedUsage(activeProfileId, result.data);
          }
        } else {
          // No usage data available (endpoint not supported or error)
          if (!usage) {
            setIsAvailable(false);
          }
        }
      } catch (error) {
        // Handle errors (IPC failure, network issues, etc.)
        console.warn("[UsageIndicator] Failed to fetch usage data:", error);

        // Only update loading state if we didn't have cached data
        if (activeProfileId) {
          const hadCache =
            useSettingsStore.getState().getCachedUsage(activeProfileId) !==
            null;
          if (!hadCache) {
            setIsLoading(false);
            setIsAvailable(false);
          }
        } else {
          setIsLoading(false);
          setIsAvailable(false);
        }
      }
    };

    loadUsageData();

    return () => {
      unsubscribe();
    };
  }, [activeProfileId]);

  // Fetch historical usage data when profile changes or component mounts
  useEffect(() => {
    const fetchHistoricalUsage = async () => {
      if (!activeProfileId) return;

      // Get active profile to check provider
      const activeProfile = profiles?.find((p) => p.id === activeProfileId);
      if (!activeProfile) return;

      // Check if provider is z.ai (only z.ai supports historical usage)
      const provider = detectProvider(activeProfile.baseUrl);
      if (provider !== "zai") {
        console.log(
          "[UsageIndicator] Historical usage not supported for provider:",
          provider,
        );
        setHistoricalUsage((prev) => ({
          ...prev,
          isLoading: false,
          error: null, // Not an error, just not supported
        }));
        return;
      }

      // Check cache first
      const cached7d = useSettingsStore
        .getState()
        .getCachedHistoricalUsage(activeProfileId, "7d");
      const cached30d = useSettingsStore
        .getState()
        .getCachedHistoricalUsage(activeProfileId, "30d");

      if (cached7d && cached30d) {
        console.log("[UsageIndicator] Historical usage cache hit");
        setHistoricalUsage({
          data7d: cached7d,
          data30d: cached30d,
          isLoading: false,
          error: null,
        });
        return;
      }

      console.log(
        "[UsageIndicator] Historical usage cache miss - fetching from API",
      );
      setHistoricalUsage((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const [result7d, result30d] = await Promise.all([
          cached7d
            ? { success: true, data: cached7d }
            : window.electronAPI.requestHistoricalUsage(7),
          cached30d
            ? { success: true, data: cached30d }
            : window.electronAPI.requestHistoricalUsage(30),
        ]);

        const data7d = result7d.success ? result7d.data : null;
        const data30d = result30d.success ? result30d.data : null;

        const errorMessages = [result7d, result30d]
          .map((result) => (!result.success ? result.error : null))
          .filter((message): message is string => Boolean(message));

        if (!data7d && !data30d) {
          if (errorMessages.length > 0) {
            console.warn(
              "[UsageIndicator] Historical usage request failed:",
              errorMessages.join("; "),
            );
            setHistoricalUsage({
              data7d: null,
              data30d: null,
              isLoading: false,
              error: errorMessages.join("; "),
            });
            return;
          }

          // No data but no explicit error; treat as empty state rather than failure.
          setHistoricalUsage({
            data7d: null,
            data30d: null,
            isLoading: false,
            error: null,
          });
          return;
        }

        // Cache successful results
        if (data7d)
          useSettingsStore
            .getState()
            .setCachedHistoricalUsage(activeProfileId, "7d", data7d);
        if (data30d)
          useSettingsStore
            .getState()
            .setCachedHistoricalUsage(activeProfileId, "30d", data30d);

        setHistoricalUsage({
          data7d,
          data30d,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        console.error(
          "[UsageIndicator] Failed to fetch historical usage:",
          error,
        );
        setHistoricalUsage({
          data7d: null,
          data30d: null,
          isLoading: false,
          error: t("common:usage.dashboard.historicalDataError"),
        });
      }
    };

    fetchHistoricalUsage();
  }, [activeProfileId, profiles, t]);

  // Show loading state
  if (isLoading) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#161618] text-gray-400"
        role="status"
        aria-live="polite"
        aria-label={t("common:usage.loading")}
      >
        <Activity
          className="h-3.5 w-3.5 motion-safe:animate-pulse"
          aria-hidden="true"
        />
        <span className="text-xs font-semibold">
          {t("common:usage.loading")}
        </span>
      </div>
    );
  }

  // Show unavailable state - with better messaging based on cause
  if (!isAvailable || !usage) {
    // Check if it's a re-auth issue (better UX than generic "not supported")
    const needsReauth = activeProfileNeedsReauth;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#161618] text-gray-400 cursor-help transition-all hover:opacity-80"
            aria-label={t("common:usage.notAvailable")}
            aria-haspopup="dialog"
          >
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs font-semibold">
              {t("common:usage.notAvailable")}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="text-xs w-64 bg-[#161618] border border-white/10"
          role="dialog"
          aria-modal="false"
        >
          <div className="space-y-1">
            <p className="font-medium">{t("common:usage.dataUnavailable")}</p>
            <p className="text-gray-400 text-[10px]">
              {t("common:usage.dataUnavailableDescription")}
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
    badgeUsage >= 95
      ? "text-red-400 bg-red-500/10 border-red-500/20"
      : badgeUsage >= 91
        ? "text-orange-400 bg-orange-500/10 border-orange-500/20"
        : badgeUsage >= 71
          ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
          : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";

  const sessionLabel = localizeUsageWindowLabel(
    usage?.usageWindows?.sessionWindowLabel,
    t,
    "common:usage.sessionDefault",
  );
  const weeklyLabel = localizeUsageWindowLabel(
    usage?.usageWindows?.weeklyWindowLabel,
    t,
    "common:usage.weeklyDefault",
  );

  const maxUsage = Math.max(usage.sessionPercent, usage.weeklyPercent);
  const Icon =
    maxUsage >= 91 ? AlertCircle : maxUsage >= 71 ? TrendingUp : Activity;

  /**
   * Filter Bar Component
   * Displays time period, chart type, and metric toggle buttons
   * TODO: Integrate into dashboard layout in Phase 4
   */
  const renderFilterBar = () => (
    <div
      className="flex flex-wrap items-center gap-2 p-2 border-b border-white/10 bg-[#161618]"
      role="toolbar"
      aria-label={t("common:usage.dashboard.ariaLabel.filterTimePeriod")}
    >
      {/* Time Period Toggle */}
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label={t("common:usage.dashboard.filterTimePeriod")}
      >
        <Button
          size="sm"
          variant={timePeriod === "7d" ? "default" : "outline"}
          onClick={() => setTimePeriod("7d")}
          aria-pressed={timePeriod === "7d"}
          aria-label={t("common:usage.dashboard.timePeriod7Days")}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            timePeriod === "7d"
              ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0"
              : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
          }`}
        >
          {t("common:usage.dashboard.timePeriod7Days")}
        </Button>
        <Button
          size="sm"
          variant={timePeriod === "30d" ? "default" : "outline"}
          onClick={() => setTimePeriod("30d")}
          aria-pressed={timePeriod === "30d"}
          aria-label={t("common:usage.dashboard.timePeriod30Days")}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            timePeriod === "30d"
              ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0"
              : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
          }`}
        >
          {t("common:usage.dashboard.timePeriod30Days")}
        </Button>
      </div>

      {/* Chart Type Toggle */}
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label={t("common:usage.dashboard.filterChartType")}
      >
        <Button
          size="sm"
          variant={chartType === "area" ? "default" : "outline"}
          onClick={() => setChartType("area")}
          aria-pressed={chartType === "area"}
          aria-label={t("common:usage.dashboard.chartTypeArea")}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            chartType === "area"
              ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0"
              : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
          }`}
        >
          {t("common:usage.dashboard.chartTypeArea")}
        </Button>
        <Button
          size="sm"
          variant={chartType === "line" ? "default" : "outline"}
          onClick={() => setChartType("line")}
          aria-pressed={chartType === "line"}
          aria-label={t("common:usage.dashboard.chartTypeLine")}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            chartType === "line"
              ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0"
              : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
          }`}
        >
          {t("common:usage.dashboard.chartTypeLine")}
        </Button>
        <Button
          size="sm"
          variant={chartType === "bar" ? "default" : "outline"}
          onClick={() => setChartType("bar")}
          aria-pressed={chartType === "bar"}
          aria-label={t("common:usage.dashboard.chartTypeBar")}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            chartType === "bar"
              ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0"
              : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
          }`}
        >
          {t("common:usage.dashboard.chartTypeBar")}
        </Button>
      </div>

      {/* Metric Toggle */}
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label={t("common:usage.dashboard.filterMetric")}
      >
        <Button
          size="sm"
          variant={metric === "tokens" ? "default" : "outline"}
          onClick={() => setMetric("tokens")}
          aria-pressed={metric === "tokens"}
          aria-label={t("common:usage.dashboard.metricTokens")}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            metric === "tokens"
              ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0"
              : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
          }`}
        >
          {t("common:usage.dashboard.metricTokens")}
        </Button>
        <Button
          size="sm"
          variant={metric === "tools" ? "default" : "outline"}
          onClick={() => setMetric("tools")}
          aria-pressed={metric === "tools"}
          aria-label={t("common:usage.dashboard.metricTools")}
          className={`h-7 px-3 text-xs font-mono transition-all duration-200 ${
            metric === "tools"
              ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white border-0"
              : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
          }`}
        >
          {t("common:usage.dashboard.metricTools")}
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
    const activeProfile = profiles?.find((p) => p.id === activeProfileId);
    const profileName =
      usage?.profileName ||
      activeProfile?.name ||
      t("tasks:apiProfile.placeholder");

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-[#161618]">
        {/* Token Usage Card - 5H Quota */}
        <Card
          className="border border-white/10 bg-white/5 backdrop-blur-sm"
          aria-label={t("common:usage.dashboard.ariaLabel.tokenUsageCard")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
              <Activity
                className="h-4 w-4 text-indigo-400"
                aria-hidden="true"
              />
              {t("common:usage.dashboard.cardTokenUsage")} (
              {t("common:usage.dashboard.tokenUsageQuota")})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold font-mono text-gray-100">
                  {usage ? Math.round(usage.sessionPercent) : 0}%
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {usage &&
                  usage.sessionUsageValue != null &&
                  usage.sessionUsageLimit != null
                    ? `${formatUsageValue(usage.sessionUsageValue)} / ${formatUsageValue(usage.sessionUsageLimit)}`
                    : t("common:usage.notAvailable")}
                </span>
              </div>
              <div
                className="h-2 bg-white/5 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={usage ? Math.round(usage.sessionPercent) : 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${t("common:usage.dashboard.cardTokenUsage")}: ${usage ? Math.round(usage.sessionPercent) : 0}%`}
              >
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    usage && usage.sessionPercent >= 95
                      ? "bg-gradient-to-r from-red-500 to-red-400"
                      : usage && usage.sessionPercent >= 91
                        ? "bg-gradient-to-r from-orange-500 to-orange-400"
                        : usage && usage.sessionPercent >= 71
                          ? "bg-gradient-to-r from-yellow-500 to-yellow-400"
                          : "bg-gradient-to-r from-emerald-500 to-emerald-400"
                  }`}
                  style={{
                    width: `${usage ? Math.min(usage.sessionPercent, 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tools Usage Card - Monthly */}
        <Card
          className="border border-white/10 bg-white/5 backdrop-blur-sm"
          aria-label={t("common:usage.dashboard.ariaLabel.toolsUsageCard")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
              <TrendingUp
                className="h-4 w-4 text-violet-400"
                aria-hidden="true"
              />
              {t("common:usage.dashboard.cardToolsUsage")} (
              {t("common:usage.dashboard.toolsUsageMonthly")})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold font-mono text-gray-100">
                  {usage ? Math.round(usage.weeklyPercent) : 0}%
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {usage &&
                  usage.weeklyUsageValue != null &&
                  usage.weeklyUsageLimit != null
                    ? `${formatUsageValue(usage.weeklyUsageValue)} / ${formatUsageValue(usage.weeklyUsageLimit)}`
                    : t("common:usage.notAvailable")}
                </span>
              </div>
              <div
                className="h-2 bg-white/5 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={usage ? Math.round(usage.weeklyPercent) : 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${t("common:usage.dashboard.cardToolsUsage")}: ${usage ? Math.round(usage.weeklyPercent) : 0}%`}
              >
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    usage && usage.weeklyPercent >= 99
                      ? "bg-gradient-to-r from-red-500 to-red-400"
                      : usage && usage.weeklyPercent >= 91
                        ? "bg-gradient-to-r from-orange-500 to-orange-400"
                        : usage && usage.weeklyPercent >= 71
                          ? "bg-gradient-to-r from-yellow-500 to-yellow-400"
                          : "bg-gradient-to-r from-emerald-500 to-emerald-400"
                  }`}
                  style={{
                    width: `${usage ? Math.min(usage.weeklyPercent, 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reset Schedule Card */}
        <Card
          className="border border-white/10 bg-white/5 backdrop-blur-sm"
          aria-label={t("common:usage.dashboard.ariaLabel.resetScheduleCard")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
              <Clock className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              {t("common:usage.dashboard.cardResetSchedule")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">
                  {t("common:usage.sessionDefault")}:
                </span>
                <span className="font-medium font-mono text-gray-200">
                  {sessionResetTime || t("common:usage.dashboard.loadingData")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">
                  {t("common:usage.weeklyDefault")}:
                </span>
                <span className="font-medium font-mono text-gray-200">
                  {weeklyResetTime || t("common:usage.dashboard.loadingData")}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Status Card */}
        <Card
          className="border border-white/10 bg-white/5 backdrop-blur-sm"
          aria-label={t("common:usage.dashboard.ariaLabel.accountStatusCard")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-gray-200">
              <User className="h-4 w-4 text-violet-400" aria-hidden="true" />
              {t("common:usage.dashboard.cardAccountStatus")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {t("common:usage.profile")}:
                </span>
                <span
                  className="text-xs font-medium truncate ml-2 text-gray-200"
                  title={profileName}
                >
                  {profileName}
                </span>
              </div>
              <div
                className="flex items-center gap-1.5"
                role="status"
                aria-live="polite"
              >
                <div
                  className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse"
                  aria-hidden="true"
                />
                <span className="text-xs font-medium text-emerald-400">
                  {t("common:usage.dashboard.statusLive")}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  /**
   * Transform historical usage data to chart data points
   * Uses real historical data from API (for z.ai provider)
   *
   * @param timePeriod - '7d' or '30d' for number of days
   * @param metric - 'tokens' or 'tools' for usage metric
   * @returns Object with values, labels, and hourly data for tooltips
   */
  const transformUsageToChartData = (
    timePeriod: "7d" | "30d",
    metric: "tokens" | "tools",
  ): { values: number[]; labels: string[] } => {
    const history =
      timePeriod === "7d" ? historicalUsage.data7d : historicalUsage.data30d;

    if (!history || history.length === 0) {
      return { values: [], labels: [] };
    }

    return {
      values: history.map((day) =>
        metric === "tokens" ? day.tokensUsage : day.toolsUsage,
      ),
      labels: history.map((day) => day.dayLabel),
    };
  };

  /**
   * Custom SVG Chart Component
   * Displays usage trends with configurable chart type (area/line/bar)
   */
  const renderChart = () => {
    // Transform historical usage data to chart data points
    const chartData = transformUsageToChartData(timePeriod, metric);
    const dataPoints = chartData.values;
    const labels = chartData.labels;

    // Show empty state if no data available
    if (!dataPoints || dataPoints.length === 0) {
      const activeProfile = profiles?.find((p) => p.id === activeProfileId);
      const provider = activeProfile
        ? detectProvider(activeProfile.baseUrl)
        : null;

      // Show friendly message for non-z.ai providers
      if (provider && provider !== "zai") {
        return (
          <div
            className="text-center py-8 space-y-3"
            role="status"
            aria-live="polite"
          >
            <Info
              className="h-8 w-8 text-gray-500 mx-auto"
              aria-hidden="true"
            />
            <p className="text-sm text-gray-300">
              {t("common:usage.dashboard.historicalNotSupported", {
                provider: t(`common:providers.${provider}`),
              })}
            </p>
            <p className="text-xs text-gray-400">
              {t("common:usage.dashboard.historicalOnlyZai")}
            </p>
          </div>
        );
      }

      // Show error state if there's an error
      if (historicalUsage.error) {
        return (
          <div
            className="text-center py-8 space-y-3"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle
              className="h-8 w-8 text-yellow-500 mx-auto"
              aria-hidden="true"
            />
            <p className="text-sm text-gray-300">{historicalUsage.error}</p>
            <button
              onClick={() => {
                // Refetch historical usage by resetting state
                setHistoricalUsage((prev) => ({
                  ...prev,
                  error: null,
                  isLoading: true,
                }));
              }}
              className="text-xs text-violet-400 hover:text-violet-300 underline"
            >
              {t("common:usage.dashboard.retry")}
            </button>
          </div>
        );
      }

      // Default empty state
      return (
        <div
          className="w-full h-full flex items-center justify-center p-4 bg-[#161618]"
          role="region"
          aria-label={t("common:usage.dashboard.ariaLabel.chartVisualization")}
        >
          <div className="text-center space-y-2">
            <Activity
              className="h-8 w-8 text-gray-600 mx-auto"
              aria-hidden="true"
            />
            <p className="text-sm text-gray-400">
              {t("common:usage.dashboard.chartEmptyState")}
            </p>
            <p className="text-xs text-gray-500">
              {t("common:usage.dashboard.chartNoDataMessage")}
            </p>
          </div>
        </div>
      );
    }

    const chartWidth = 600;
    const chartHeight = 200;
    const padding = { top: 20, right: 20, bottom: 30, left: 40 };

    // Calculate scaling
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;

    const maxValue = Math.max(...dataPoints, 0);
    const normalizedMax = maxValue > 0 ? maxValue : 1;

    const formatChartValue = (value: number): string => {
      const formatted = formatUsageValue(value);
      return formatted ?? value.toString();
    };

    // Generate path data for area/line charts
    const generatePathData = (data: number[]) => {
      const stepX = innerWidth / (data.length - 1);

      // Start at bottom-left
      let pathD = `M ${padding.left} ${chartHeight - padding.bottom}`;

      // Draw line through each data point
      data.forEach((value, index) => {
        const x = padding.left + index * stepX;
        const y =
          padding.top + innerHeight - (value / normalizedMax) * innerHeight;
        pathD += ` L ${x} ${y}`;
      });

      return pathD;
    };

    const pathData = generatePathData(dataPoints);

    return (
      <div
        className="w-full h-full flex items-center justify-center p-4 bg-[#161618]"
        role="region"
        aria-label={t("common:usage.dashboard.ariaLabel.chartVisualization")}
      >
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-full transition-all duration-300 ease-out"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${t("common:usage.dashboard.ariaLabel.chartVisualization")}: ${t(`common:usage.dashboard.chartType${chartType.charAt(0).toUpperCase() + chartType.slice(1)}`)}`}
        >
          {/* Gradient Definition (only for area chart) */}
          {chartType === "area" && (
            <defs>
              <linearGradient
                id="chartGradient"
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#6366F1" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#6366F1" stopOpacity="0.05" />
              </linearGradient>
            </defs>
          )}

          {/* Grid Lines (horizontal) */}
          {Array.from({ length: 5 }, (_, index) => {
            const ratio = index / 4;
            const value = Math.round(normalizedMax * ratio * 100) / 100;
            const y = padding.top + innerHeight - ratio * innerHeight;
            return (
              <g key={`grid-${ratio}`}>
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
                  {formatChartValue(value)}
                </text>
              </g>
            );
          })}

          {/* Area Chart: Area + Line Path */}
          {chartType === "area" && (
            <g className="transition-all duration-300 ease-out">
              {/* Area Path */}
              <path
                d={
                  pathData +
                  ` L ${padding.left + innerWidth} ${chartHeight - padding.bottom} Z`
                }
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
          {chartType === "line" && (
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
          {chartType === "bar" &&
            (() => {
              const barWidth = (innerWidth / dataPoints.length) * 0.6; // 60% of available space
              const barGap = (innerWidth / dataPoints.length) * 0.4; // 40% gap

              return (
                <g className="transition-all duration-300 ease-out">
                  {dataPoints.map((value, index) => {
                    const x =
                      padding.left +
                      index * (innerWidth / dataPoints.length) +
                      barGap / 2;
                    const barHeight = (value / normalizedMax) * innerHeight;
                    const y = padding.top + innerHeight - barHeight;
                    const label = labels[index] || `Day ${index + 1}`;

                    return (
                      <rect
                        key={`bar-${index}`}
                        x={x}
                        y={y}
                        width={barWidth}
                        height={barHeight}
                        fill="#6366F1"
                        className="hover:fill-indigo-400 cursor-pointer transition-all duration-200 ease-out"
                        onMouseEnter={() =>
                          setHoveredPoint({ index, value, label })
                        }
                        onMouseLeave={() => setHoveredPoint(null)}
                      />
                    );
                  })}
                </g>
              );
            })()}

          {/* Data Points (only for area and line charts) */}
          {chartType !== "bar" &&
            dataPoints.map((value, index) => {
              const stepX = innerWidth / (dataPoints.length - 1);
              const x = padding.left + index * stepX;
              const y =
                padding.top +
                innerHeight -
                (value / normalizedMax) * innerHeight;
              const label = labels[index] || `Day ${index + 1}`;

              return (
                <circle
                  key={`point-${index}`}
                  cx={x}
                  cy={y}
                  r="4"
                  fill="#6366F1"
                  stroke="#8B5CF6"
                  strokeWidth="2"
                  className="hover:r-6 cursor-pointer transition-all duration-200 ease-out"
                  onMouseEnter={() => setHoveredPoint({ index, value, label })}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              );
            })}

          {/* X-Axis Labels (Calendar Dates) */}
          {labels.map((label, index) => {
            const stepX =
              chartType === "bar"
                ? innerWidth / dataPoints.length
                : innerWidth / (dataPoints.length - 1);
            const x =
              padding.left +
              index * stepX +
              (chartType === "bar" ? stepX / 2 : 0);

            return (
              <text
                key={`label-${index}`}
                x={x}
                y={chartHeight - padding.bottom + 20}
                textAnchor="middle"
                className="text-[10px] fill-gray-400 font-mono transition-all duration-300"
              >
                {label}
              </text>
            );
          })}

          {/* Hover Tooltip */}
          {hoveredPoint && (
            <g>
              <rect
                x={padding.left + innerWidth / 2 - 60}
                y={padding.top + 10}
                width="120"
                height="40"
                rx="4"
                fill="#1a1a1c"
                stroke="#6366F1"
                strokeWidth="1"
                opacity="0.95"
              />
              <text
                x={padding.left + innerWidth / 2}
                y={padding.top + 26}
                textAnchor="middle"
                className="text-[10px] fill-gray-300 font-medium"
              >
                {hoveredPoint.label}
              </text>
              <text
                x={padding.left + innerWidth / 2}
                y={padding.top + 42}
                textAnchor="middle"
                className="text-[10px] fill-violet-400 font-mono"
              >
                {metric === "tokens"
                  ? t("common:usage.dashboard.hoverTokenUsage", {
                      count: formatChartValue(hoveredPoint.value),
                    })
                  : t("common:usage.dashboard.hoverToolUsage", {
                      count: formatChartValue(hoveredPoint.value),
                    })}
              </text>
            </g>
          )}
        </svg>
      </div>
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 bg-[#161618] transition-all hover:opacity-80 ${badgeColorClasses}`}
          aria-label={t("common:usage.usageStatusAriaLabel")}
          aria-haspopup="dialog"
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-xs font-semibold font-mono text-gray-200">
            {Math.round(badgeUsage)}%
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="text-xs w-[min(600px,calc(100vw-32px))] p-0 bg-[#161618] border border-white/10 max-h-[600px] overflow-y-auto"
      >
        <div className="p-3 space-y-3">
          {/* Header with overall status */}
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Icon
                className="h-3.5 w-3.5 text-indigo-400"
                aria-hidden="true"
              />
              <span className="font-semibold text-xs text-gray-200">
                {t("common:usage.usageBreakdown")}
              </span>
            </div>
            {/* Last updated timestamp */}
            {usage?.fetchedAt && (
              <div className="text-[10px] text-gray-400">
                {t("common:usage.dashboard.lastUpdated")}:{" "}
                <span className="font-medium text-gray-300">
                  {formatTimeAgo(usage.fetchedAt, t) ||
                    t("common:usage.notAvailable")}
                </span>
              </div>
            )}
          </div>

          {/* Filter Bar */}
          {renderFilterBar()}

          {/* Chart Visualization */}
          <div className="h-[min(200px,40vw)] border border-white/10 rounded-lg overflow-hidden">
            {renderChart()}
          </div>

          {/* Dashboard Cards */}
          {renderDashboardCards()}

          {/* Profile selector */}
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <User className="h-3 w-3" aria-hidden="true" />
                <span>{t("common:usage.activeAccount")}</span>
              </div>
              {isSwitchingProfile && (
                <div
                  className="flex items-center gap-1 text-[10px] text-indigo-400"
                  role="status"
                  aria-live="polite"
                >
                  <Activity
                    className="h-3 w-3 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                  <span>{t("common:usage.dashboard.profileSwitching")}</span>
                </div>
              )}
            </div>
            {profileError && (
              <div
                className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1"
                role="alert"
                aria-live="assertive"
              >
                {profileError}
              </div>
            )}
            <Select
              value={activeProfileId || undefined}
              onValueChange={handleProfileChange}
              disabled={
                !profiles || profiles.length === 0 || isSwitchingProfile
              }
              aria-label={t("common:usage.dashboard.ariaLabel.profileDropdown")}
              aria-busy={isSwitchingProfile}
            >
              <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-gray-200">
                <SelectValue placeholder={t("tasks:apiProfile.placeholder")} />
              </SelectTrigger>
              <SelectContent className="bg-[#161618] border-white/10">
                {profiles && profiles.length > 0 ? (
                  profiles.map((profile: APIProfile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      <div className="flex items-center gap-2">
                        <Key
                          className="h-3 w-3 shrink-0 text-indigo-400"
                          aria-hidden="true"
                        />
                        <div>
                          <span className="font-medium text-xs text-gray-200">
                            {profile.name}
                          </span>
                          <span className="ml-2 text-[10px] text-gray-400">
                            ({profile.baseUrl})
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="empty" disabled>
                    {t("common:usage.dashboard.noProfilesConfigured")}
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

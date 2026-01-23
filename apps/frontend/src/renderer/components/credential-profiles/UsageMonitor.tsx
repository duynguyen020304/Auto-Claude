/**
 * UsageMonitor - Real-time usage monitoring for credential profiles and pools
 *
 * Displays task counts vs. limits for profiles and pools with color-coded progress bars.
 * Supports real-time updates through polling.
 *
 * NOTE: Actual task counting will be implemented in phase-8 (IPC handlers).
 * Currently shows placeholder values that will be replaced with backend data.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Activity, TrendingUp, AlertCircle, RefreshCw } from "lucide-react";
import { useSettingsStore } from "../../stores/settings-store";
import { useTaskStore } from "../../stores/task-store";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";

/**
 * Usage statistics interface
 */
interface UsageStats {
  current: number;
  limit: number;
  percentage: number;
}

export function UsageMonitor() {
  const { t } = useTranslation();
  const { credentialProfiles, pools } = useSettingsStore();
  const { tasks } = useTaskStore();

  const [activeTab, setActiveTab] = useState<"profiles" | "pools">("profiles");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  /**
   * Calculate usage for a credential profile
   * TODO: Replace with backend data in phase-8 (IPC handlers)
   *
   * For now, counts tasks that reference this profile via apiProfileId
   */
  const getProfileUsage = (profileId: string): UsageStats => {
    // Count tasks using this profile
    const currentTasks = tasks.filter(
      (task) => task.metadata?.apiProfileId === profileId,
    ).length;

    // Get limit from profile metadata (only for API profiles)
    const profile = credentialProfiles.find((p) => p.id === profileId);
    const limit = profile?.metadata?.usage_limit
      ? parseInt(profile.metadata.usage_limit, 10)
      : 0;

    // OAuth profiles have no limits (limit = 0 means unlimited)
    if (limit === 0) {
      return {
        current: currentTasks,
        limit: 0,
        percentage: 0,
      };
    }

    const percentage = limit > 0 ? (currentTasks / limit) * 100 : 0;

    return {
      current: currentTasks,
      limit,
      percentage,
    };
  };

  /**
   * Calculate usage for a pool
   * TODO: Replace with backend data in phase-8 (IPC handlers)
   *
   * For now, counts tasks that reference this pool (when pool selection is implemented)
   * NOTE: Pool selection will be added in subtask-7-1 (TaskProfileSelector)
   */
  const getPoolUsage = (poolId: string): UsageStats => {
    // TODO: Count tasks using this pool
    // Pool selection not yet implemented in tasks (subtask-7-1)
    const currentTasks = 0;

    const pool = pools.find((p) => p.id === poolId);
    const limit = pool?.limit ?? 0;

    // limit = 0 means unlimited
    if (limit === 0) {
      return {
        current: currentTasks,
        limit: 0,
        percentage: 0,
      };
    }

    const percentage = limit > 0 ? (currentTasks / limit) * 100 : 0;

    return {
      current: currentTasks,
      limit,
      percentage,
    };
  };

  /**
   * Get color classes based on usage percentage
   */
  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) {
      return {
        bar: "bg-red-500",
        text: "text-red-500",
        icon: AlertCircle,
        label: "critical",
      };
    }
    if (percentage >= 70) {
      return {
        bar: "bg-yellow-500",
        text: "text-yellow-600",
        icon: TrendingUp,
        label: "warning",
      };
    }
    return {
      bar: "bg-green-500",
      text: "text-green-600",
      icon: Activity,
      label: "healthy",
    };
  };

  /**
   * Manual refresh handler
   */
  const handleRefresh = () => {
    setIsRefreshing(true);
    setLastUpdate(new Date());

    // TODO: Call IPC handler to refresh usage data in phase-8
    setTimeout(() => {
      setIsRefreshing(false);
    }, 500);
  };

  /**
   * Auto-refresh every 10 seconds
   */
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdate(new Date());
      // Data updates automatically via store subscriptions
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {t("settings:usageMonitor.title")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("settings:usageMonitor.description")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")}
          />
          {t("settings:usageMonitor.refresh")}
        </Button>
      </div>

      {/* Last update timestamp */}
      <div className="text-xs text-muted-foreground">
        {t("settings:usageMonitor.lastUpdate", {
          time: lastUpdate.toLocaleTimeString(),
        })}
      </div>

      {/* Tabs for Profiles vs Pools */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "profiles" | "pools")}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="profiles">
            {t("settings:usageMonitor.tabs.profiles")}
          </TabsTrigger>
          <TabsTrigger value="pools">
            {t("settings:usageMonitor.tabs.pools")}
          </TabsTrigger>
        </TabsList>

        {/* Profiles Tab */}
        <TabsContent value="profiles" className="space-y-3 mt-4">
          {credentialProfiles.length === 0 ? (
            <div className="text-center py-8 px-4 border border-dashed rounded-lg">
              <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {t("settings:usageMonitor.profiles.empty")}
              </p>
            </div>
          ) : (
            credentialProfiles.map((profile) => {
              const usage = getProfileUsage(profile.id);
              const colors = getUsageColor(usage.percentage);
              const Icon = colors.icon;
              const isOAuth = profile.type === "oauth";

              return (
                <div key={profile.id} className="p-4 rounded-lg border bg-card">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-4 w-4", colors.text)} />
                        <h4 className="font-medium truncate">{profile.name}</h4>
                        {/* Profile type badge */}
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium",
                            isOAuth
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                          )}
                        >
                          {isOAuth
                            ? t("settings:profiles.type.oauth")
                            : t("settings:profiles.type.apiKey")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        {/* Pools Tab */}
        <TabsContent value="pools" className="space-y-3 mt-4">
          {pools.length === 0 ? (
            <div className="text-center py-8 px-4 border border-dashed rounded-lg">
              <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {t("settings:usageMonitor.pools.empty")}
              </p>
            </div>
          ) : (
            pools.map((pool) => {
              const usage = getPoolUsage(pool.id);
              const colors = getUsageColor(usage.percentage);
              const Icon = colors.icon;

              // Count profiles in pool
              const profileCount = pool.profile_ids.length;

              return (
                <div key={pool.id} className="p-4 rounded-lg border bg-card">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-4 w-4", colors.text)} />
                        <h4 className="font-medium truncate">{pool.name}</h4>
                        {/* Profile count badge */}
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                          {profileCount === 1
                            ? t("settings:pools.profileCount.single", {
                                count: profileCount,
                              })
                            : t("settings:pools.profileCount.multiple", {
                                count: profileCount,
                              })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SettingsSection } from './SettingsSection';
import type { AppSettings } from '../../../shared/types';

interface InsightsConcurrencySettingsProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

/**
 * Insights concurrency settings component
 * Configure concurrent session limits, queueing, and rate limiting
 */
export function InsightsConcurrencySettings({
  settings,
  onSettingsChange
}: InsightsConcurrencySettingsProps) {
  const { t } = useTranslation('settings');

  // Use defaults if not set
  const maxConcurrentSessions = settings.maxConcurrentSessions ?? 1;
  const maxSessionsPerProject = settings.maxSessionsPerProject ?? 2;
  const rateLimitCount = settings.rateLimitCount ?? 10;
  const rateLimitWindowMs = settings.rateLimitWindowMs ?? 60000;
  const defaultSessionPriority = settings.defaultSessionPriority ?? 'normal';

  // Priority options
  const sessionPriorities = [
    { value: 'low', label: t('insightsConcurrency.priorityLow') },
    { value: 'normal', label: t('insightsConcurrency.priorityNormal') },
    { value: 'high', label: t('insightsConcurrency.priorityHigh') },
    { value: 'urgent', label: t('insightsConcurrency.priorityUrgent') },
  ] as const;

  return (
    <SettingsSection
      title={t('insightsConcurrency.title')}
      description={t('insightsConcurrency.description')}
    >
      <div className="space-y-6">
        {/* Max Concurrent Sessions */}
        <div className="space-y-3">
          <Label htmlFor="maxConcurrentSessions" className="text-sm font-medium text-foreground">
            {t('insightsConcurrency.maxConcurrentSessions')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('insightsConcurrency.maxConcurrentSessionsDescription')}
          </p>
          <Input
            id="maxConcurrentSessions"
            type="number"
            min="1"
            max="10"
            className="w-full max-w-md"
            value={maxConcurrentSessions}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              if (!isNaN(value) && value >= 1) {
                onSettingsChange({ ...settings, maxConcurrentSessions: value });
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t('insightsConcurrency.maxConcurrentSessionsHint')}
          </p>
        </div>

        {/* Max Sessions Per Project */}
        <div className="space-y-3">
          <Label htmlFor="maxSessionsPerProject" className="text-sm font-medium text-foreground">
            {t('insightsConcurrency.maxSessionsPerProject')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('insightsConcurrency.maxSessionsPerProjectDescription')}
          </p>
          <Input
            id="maxSessionsPerProject"
            type="number"
            min="1"
            max="10"
            className="w-full max-w-md"
            value={maxSessionsPerProject}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              if (!isNaN(value) && value >= 1) {
                onSettingsChange({ ...settings, maxSessionsPerProject: value });
              }
            }}
          />
        </div>

        {/* Default Session Priority */}
        <div className="space-y-3">
          <Label htmlFor="defaultSessionPriority" className="text-sm font-medium text-foreground">
            {t('insightsConcurrency.defaultSessionPriority')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('insightsConcurrency.defaultSessionPriorityDescription')}
          </p>
          <Select
            value={defaultSessionPriority}
            onValueChange={(value: 'low' | 'normal' | 'high' | 'urgent') =>
              onSettingsChange({ ...settings, defaultSessionPriority: value })
            }
          >
            <SelectTrigger id="defaultSessionPriority" className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SESSION_PRIORITIES.map((priority) => (
                <SelectItem key={priority.value} value={priority.value}>
                  {priority.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Divider */}
        <div className="pt-4 border-t border-border">
          <div className="space-y-1">
            <Label className="text-sm font-medium text-foreground">
              {t('insightsConcurrency.rateLimiting')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('insightsConcurrency.rateLimitingDescription')}
            </p>
          </div>
        </div>

        {/* Rate Limit Count */}
        <div className="space-y-3">
          <Label htmlFor="rateLimitCount" className="text-sm font-medium text-foreground">
            {t('insightsConcurrency.rateLimitCount')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('insightsConcurrency.rateLimitCountDescription')}
          </p>
          <Input
            id="rateLimitCount"
            type="number"
            min="1"
            max="100"
            className="w-full max-w-md"
            value={rateLimitCount}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              if (!isNaN(value) && value >= 1) {
                onSettingsChange({ ...settings, rateLimitCount: value });
              }
            }}
          />
        </div>

        {/* Rate Limit Window */}
        <div className="space-y-3">
          <Label htmlFor="rateLimitWindowMs" className="text-sm font-medium text-foreground">
            {t('insightsConcurrency.rateLimitWindowMs')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('insightsConcurrency.rateLimitWindowMsDescription')}
          </p>
          <Input
            id="rateLimitWindowMs"
            type="number"
            min="1000"
            step="1000"
            className="w-full max-w-md"
            value={rateLimitWindowMs}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              if (!isNaN(value) && value >= 1000) {
                onSettingsChange({ ...settings, rateLimitWindowMs: value });
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t('insightsConcurrency.rateLimitWindowMsHint', { minutes: (rateLimitWindowMs / 60000).toFixed(1) })}
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

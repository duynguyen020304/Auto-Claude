/**
 * RotationStrategySelector - Reusable component for selecting credential rotation strategy
 *
 * Provides a dropdown for selecting from 4 rotation modes (manual, round_robin, usage_based, rate_limit_aware).
 * Shows a threshold input field (0.0-1.0) when rate_limit_aware mode is selected.
 *
 * Used in ProfileFormDialog for credential profile configuration.
 */
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Input } from '../ui/input';
import type { RotationMode } from '@shared/types/credential-profile';
import { cn } from '../../lib/utils';

interface RotationStrategySelectorProps {
  /** Currently selected rotation mode */
  rotationMode: RotationMode;
  /** Called when rotation mode changes */
  onRotationModeChange: (mode: RotationMode) => void;
  /** Rate limit threshold value (0.0-1.0) */
  rateLimitThreshold: number;
  /** Called when rate limit threshold changes */
  onRateLimitThresholdChange: (threshold: number) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Error message for threshold field */
  thresholdError?: string | null;
}

const rotationModeDescriptions: Record<RotationMode, string> = {
  manual: 'Manually select which credential to use.',
  round_robin: 'Rotate through credentials in order.',
  usage_based: 'Use credential with lowest usage.',
  rate_limit_aware: 'Rotate based on rate limit thresholds.'
};

export function RotationStrategySelector({
  rotationMode,
  onRotationModeChange,
  rateLimitThreshold,
  onRateLimitThresholdChange,
  disabled = false,
  thresholdError
}: RotationStrategySelectorProps) {
  const { t } = useTranslation(['settings', 'common']);

  const handleRotationModeChange = (mode: string) => {
    onRotationModeChange(mode as RotationMode);
  };

  const handleThresholdChange = (value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      onRateLimitThresholdChange(numValue);
    }
  };

  // Show threshold field only for rate_limit_aware mode
  const showThreshold = rotationMode === 'rate_limit_aware';

  return (
    <div className="space-y-4">
      {/* Rotation mode selector */}
      <div className="space-y-2">
        <Label htmlFor="rotation-mode" className="text-sm font-medium text-foreground">
          Rotation Mode
        </Label>
        <Select
          value={rotationMode}
          onValueChange={handleRotationModeChange}
          disabled={disabled}
        >
          <SelectTrigger id="rotation-mode" className="h-10">
            <SelectValue placeholder="Select rotation mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">
              <div className="flex items-center gap-2">
                <span className="font-medium">Manual</span>
              </div>
            </SelectItem>
            <SelectItem value="round_robin">
              <div className="flex items-center gap-2">
                <span className="font-medium">Round Robin</span>
              </div>
            </SelectItem>
            <SelectItem value="usage_based">
              <div className="flex items-center gap-2">
                <span className="font-medium">Usage Based</span>
              </div>
            </SelectItem>
            <SelectItem value="rate_limit_aware">
              <div className="flex items-center gap-2">
                <span className="font-medium">Rate Limit Aware</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground flex items-start gap-1">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{rotationModeDescriptions[rotationMode]}</span>
        </p>
      </div>

      {/* Rate limit threshold (rate_limit_aware mode only) */}
      {showThreshold && (
        <div className="space-y-2">
          <Label htmlFor="rate-limit-threshold" className="text-sm font-medium text-foreground">
            Rate Limit Threshold <span className="text-destructive">*</span>
          </Label>
          <Input
            id="rate-limit-threshold"
            type="number"
            min="0"
            max="1"
            step="0.1"
            placeholder="e.g., 0.8"
            value={rateLimitThreshold}
            onChange={(e) => handleThresholdChange(e.target.value)}
            disabled={disabled}
            className={cn(thresholdError && 'border-destructive')}
          />
          {thresholdError && (
            <p className="text-sm text-destructive">{thresholdError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Threshold (0.0-1.0) for switching credentials when rate limit is approached.
          </p>
        </div>
      )}
    </div>
  );
}

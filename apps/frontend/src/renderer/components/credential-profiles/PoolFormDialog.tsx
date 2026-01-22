/**
 * PoolFormDialog - Dialog for creating/editing credential pools
 *
 * Allows users to configure pools that group multiple credential profiles
 * with rotation strategies and usage limits.
 *
 * Features:
 * - Required fields: Name, Profiles (at least one), Limit, Rotation Config
 * - Profile multi-select supports both API and OAuth profiles
 * - Limit field: 0 = unlimited, positive number = max concurrent profiles
 * - Rotation configuration: mode, rate limit threshold, max retries, retry delay
 * - Form validation with error display
 * - Save button triggers store action (create or update)
 * - Close button cancels without saving
 * - Edit mode: pre-populates form with existing pool data
 */
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { useSettingsStore } from '../../stores/settings-store';
import { useToast } from '../../hooks/use-toast';
import type { Pool, PoolFormData, RotationMode } from '@shared/types/credential-profile';

interface PoolFormDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Optional callback when pool is successfully saved */
  onSaved?: () => void;
  /** Optional pool for edit mode (undefined = create mode) */
  pool?: Pool;
}

export function PoolFormDialog({ open, onOpenChange, onSaved, pool }: PoolFormDialogProps) {
  const { t } = useTranslation();
  const {
    savePool,
    updatePoolAsync,
    poolsLoading,
    poolsError,
    credentialProfiles
  } = useSettingsStore();
  const { toast } = useToast();

  // Edit mode detection: pool prop determines mode
  const isEditMode = !!pool;

  // Form state
  const [name, setName] = useState('');
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [limit, setLimit] = useState<number>(0);
  const [rotationMode, setRotationMode] = useState<RotationMode>('manual');
  const [rateLimitThreshold, setRateLimitThreshold] = useState<number>(0.8);
  const [maxRetries, setMaxRetries] = useState<number>(3);
  const [retryDelaySeconds, setRetryDelaySeconds] = useState<number>(1);

  // Validation errors
  const [nameError, setNameError] = useState<string | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [retriesError, setRetriesError] = useState<string | null>(null);
  const [delayError, setDelayError] = useState<string | null>(null);

  // Reset form and pre-populate when dialog opens
  useEffect(() => {
    if (open) {
      if (isEditMode && pool) {
        // Pre-populate form with existing pool data
        setName(pool.name);
        setSelectedProfileIds(pool.profile_ids);
        setLimit(pool.limit);
        setRotationMode(pool.rotation_config.mode);
        setRateLimitThreshold(pool.rotation_config.rate_limit_threshold);
        setMaxRetries(pool.rotation_config.max_retries);
        setRetryDelaySeconds(pool.rotation_config.retry_delay_seconds);
      } else {
        // Reset to empty form for create mode
        setName('');
        setSelectedProfileIds([]);
        setLimit(0);
        setRotationMode('manual');
        setRateLimitThreshold(0.8);
        setMaxRetries(3);
        setRetryDelaySeconds(1);
      }
      // Clear validation errors
      setNameError(null);
      setProfilesError(null);
      setLimitError(null);
      setThresholdError(null);
      setRetriesError(null);
      setDelayError(null);
    }
  }, [open, isEditMode, pool]);

  // Validate form
  const validateForm = (): boolean => {
    let isValid = true;

    // Name validation
    if (!name.trim()) {
      setNameError('Name is required');
      isValid = false;
    } else {
      setNameError(null);
    }

    // Profile IDs validation
    if (selectedProfileIds.length === 0) {
      setProfilesError('At least one profile is required');
      isValid = false;
    } else {
      setProfilesError(null);
    }

    // Limit validation
    if (limit === undefined || limit === null) {
      setLimitError('Limit is required');
      isValid = false;
    } else if (limit < 0) {
      setLimitError('Limit must be a non-negative number');
      isValid = false;
    } else {
      setLimitError(null);
    }

    // Rate limit threshold validation (required for rate_limit_aware mode)
    if (rotationMode === 'rate_limit_aware') {
      if (rateLimitThreshold === undefined || rateLimitThreshold === null) {
        setThresholdError('Rate limit threshold is required for rate-limit-aware mode');
        isValid = false;
      } else if (rateLimitThreshold < 0 || rateLimitThreshold > 1) {
        setThresholdError('Rate limit threshold must be between 0 and 1');
        isValid = false;
      } else {
        setThresholdError(null);
      }
    } else {
      setThresholdError(null);
    }

    // Max retries validation
    if (maxRetries === undefined || maxRetries === null) {
      setRetriesError('Max retries is required');
      isValid = false;
    } else if (maxRetries < 0) {
      setRetriesError('Max retries must be a non-negative number');
      isValid = false;
    } else {
      setRetriesError(null);
    }

    // Retry delay validation
    if (retryDelaySeconds === undefined || retryDelaySeconds === null) {
      setDelayError('Retry delay is required');
      isValid = false;
    } else if (retryDelaySeconds < 0) {
      setDelayError('Retry delay must be a non-negative number');
      isValid = false;
    } else {
      setDelayError(null);
    }

    return isValid;
  };

  // Handle save
  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    // Build rotation config object
    const rotationConfig = {
      mode: rotationMode,
      credential_pool: selectedProfileIds,
      rate_limit_threshold: rateLimitThreshold,
      max_retries: maxRetries,
      retry_delay_seconds: retryDelaySeconds
    };

    if (isEditMode && pool) {
      // Update existing pool
      const updatedPool: Pool = {
        ...pool,
        name: name.trim(),
        profile_ids: selectedProfileIds,
        limit,
        rotation_config: rotationConfig
      };
      const success = await updatePoolAsync(updatedPool);
      if (success) {
        toast({
          title: 'Pool updated',
          description: `Pool "${name.trim()}" has been updated successfully.`,
        });
        onOpenChange(false);
        onSaved?.();
      }
    } else {
      // Create new pool
      const poolData: Pool = {
        id: '', // Will be generated by backend
        name: name.trim(),
        profile_ids: selectedProfileIds,
        limit,
        rotation_config: rotationConfig
      };

      const success = await savePool(poolData);
      if (success) {
        toast({
          title: 'Pool created',
          description: `Pool "${name.trim()}" has been created successfully.`,
        });
        onOpenChange(false);
        onSaved?.();
      }
    }
  };

  // Handle profile checkbox change
  const handleProfileToggle = (profileId: string) => {
    setSelectedProfileIds((prev) =>
      prev.includes(profileId)
        ? prev.filter((id) => id !== profileId)
        : [...prev, profileId]
    );
    // Clear error when user makes a selection
    if (profilesError) {
      setProfilesError(null);
    }
  };

  // Check if rate limit threshold field should be shown (only for rate_limit_aware mode)
  const showThreshold = rotationMode === 'rate_limit_aware';

  // Group profiles by type
  const apiProfiles = credentialProfiles.filter((p) => p.type === 'api_key');
  const oauthProfiles = credentialProfiles.filter((p) => p.type === 'oauth');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,600px)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Credential Pool' : 'Create Credential Pool'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the credential pool configuration below.'
              : 'Configure a new pool to group and rotate credential profiles.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name field (required) */}
          <div className="space-y-2">
            <Label htmlFor="pool-name">
              Pool Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pool-name"
              placeholder="e.g., Production Pool"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={nameError ? 'border-destructive' : ''}
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>

          {/* Profile multi-select (required) */}
          <div className="space-y-2">
            <Label>
              Profiles <span className="text-destructive">*</span>
            </Label>
            <div className="space-y-3 max-h-48 overflow-y-auto border rounded-md p-3">
              {apiProfiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">API Key Profiles</p>
                  {apiProfiles.map((profile) => (
                    <div key={profile.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`profile-${profile.id}`}
                        checked={selectedProfileIds.includes(profile.id)}
                        onCheckedChange={() => handleProfileToggle(profile.id)}
                      />
                      <Label
                        htmlFor={`profile-${profile.id}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {profile.name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              {oauthProfiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">OAuth Profiles</p>
                  {oauthProfiles.map((profile) => (
                    <div key={profile.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`profile-${profile.id}`}
                        checked={selectedProfileIds.includes(profile.id)}
                        onCheckedChange={() => handleProfileToggle(profile.id)}
                      />
                      <Label
                        htmlFor={`profile-${profile.id}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {profile.name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              {credentialProfiles.length === 0 && (
                <p className="text-sm text-muted-foreground">No credential profiles available. Create a profile first.</p>
              )}
            </div>
            {profilesError && <p className="text-sm text-destructive">{profilesError}</p>}
            <p className="text-xs text-muted-foreground">
              Selected: {selectedProfileIds.length} profile{selectedProfileIds.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Limit field (required) */}
          <div className="space-y-2">
            <Label htmlFor="pool-limit">
              Concurrent Limit <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pool-limit"
              type="number"
              min="0"
              placeholder="e.g., 0"
              value={limit}
              onChange={(e) => setLimit(e.target.value ? parseInt(e.target.value, 10) : 0)}
              className={limitError ? 'border-destructive' : ''}
            />
            {limitError && <p className="text-sm text-destructive">{limitError}</p>}
            <p className="text-xs text-muted-foreground">
              {limit === 0
                ? 'No limit - use all selected profiles'
                : `Maximum ${limit} profile${limit !== 1 ? 's' : ''} to use concurrently`}
            </p>
          </div>

          {/* Rotation mode selector */}
          <div className="space-y-2">
            <Label htmlFor="rotation-mode">Rotation Mode</Label>
            <Select
              value={rotationMode}
              onValueChange={(value) => setRotationMode(value as RotationMode)}
            >
              <SelectTrigger id="rotation-mode">
                <SelectValue placeholder="Select rotation mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="round_robin">Round Robin</SelectItem>
                <SelectItem value="usage_based">Usage Based</SelectItem>
                <SelectItem value="rate_limit_aware">Rate Limit Aware</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {rotationMode === 'manual' && 'Manually select which credential to use.'}
              {rotationMode === 'round_robin' && 'Rotate through credentials in order.'}
              {rotationMode === 'usage_based' && 'Use credential with lowest usage.'}
              {rotationMode === 'rate_limit_aware' && 'Rotate based on rate limit thresholds.'}
            </p>
          </div>

          {/* Rate limit threshold (rate_limit_aware mode only) */}
          {showThreshold && (
            <div className="space-y-2">
              <Label htmlFor="rate-limit-threshold">
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
                onChange={(e) => setRateLimitThreshold(parseFloat(e.target.value))}
                className={thresholdError ? 'border-destructive' : ''}
              />
              {thresholdError && <p className="text-sm text-destructive">{thresholdError}</p>}
              <p className="text-xs text-muted-foreground">
                Threshold (0.0-1.0) for switching credentials when rate limit is approached.
              </p>
            </div>
          )}

          {/* Max retries field */}
          <div className="space-y-2">
            <Label htmlFor="max-retries">
              Max Retries <span className="text-destructive">*</span>
            </Label>
            <Input
              id="max-retries"
              type="number"
              min="0"
              placeholder="e.g., 3"
              value={maxRetries}
              onChange={(e) => setMaxRetries(e.target.value ? parseInt(e.target.value, 10) : 0)}
              className={retriesError ? 'border-destructive' : ''}
            />
            {retriesError && <p className="text-sm text-destructive">{retriesError}</p>}
            <p className="text-xs text-muted-foreground">
              Maximum number of retry attempts when swapping credentials.
            </p>
          </div>

          {/* Retry delay field */}
          <div className="space-y-2">
            <Label htmlFor="retry-delay">
              Retry Delay (seconds) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="retry-delay"
              type="number"
              min="0"
              placeholder="e.g., 1"
              value={retryDelaySeconds}
              onChange={(e) => setRetryDelaySeconds(e.target.value ? parseInt(e.target.value, 10) : 0)}
              className={delayError ? 'border-destructive' : ''}
            />
            {delayError && <p className="text-sm text-destructive">{delayError}</p>}
            <p className="text-xs text-muted-foreground">
              Delay between retry attempts in seconds.
            </p>
          </div>

          {/* General error display */}
          {poolsError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{poolsError}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={poolsLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={poolsLoading}
          >
            {poolsLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Pool'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

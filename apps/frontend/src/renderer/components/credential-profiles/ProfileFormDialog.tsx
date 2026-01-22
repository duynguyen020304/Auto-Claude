/**
 * ProfileFormDialog - Dialog for creating/editing credential profiles
 *
 * Allows users to configure credential profiles with two types:
 * - OAuth profiles (no usage limits)
 * - API Key profiles (require numeric usage limits)
 *
 * Features:
 * - Required fields: Name, Type (OAuth/API), Credential Value
 * - API profiles: Usage limit (numeric), rotation mode
 * - OAuth profiles: No usage limit, rotation mode optional
 * - Form validation with error display
 * - Save button triggers store action (create or update)
 * - Close button cancels without saving
 * - Edit mode: pre-populates form with existing profile data
 * - Edit mode: credential masked with "Change" button
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
import { useSettingsStore } from '../../stores/settings-store';
import { useToast } from '../../hooks/use-toast';
import type { CredentialProfile, CredentialProfileFormData, CredentialType, RotationMode } from '@shared/types/credential-profile';

interface ProfileFormDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Optional callback when profile is successfully saved */
  onSaved?: () => void;
  /** Optional profile for edit mode (undefined = create mode) */
  profile?: CredentialProfile;
}

const maskCredential = (credential: string): string => {
  if (credential.length <= 8) {
    return '*'.repeat(credential.length);
  }
  return `${credential.slice(0, 4)}${'*'.repeat(credential.length - 8)}${credential.slice(-4)}`;
};

export function ProfileFormDialog({ open, onOpenChange, onSaved, profile }: ProfileFormDialogProps) {
  const { t } = useTranslation();
  const {
    saveCredentialProfile,
    updateCredentialProfileAsync,
    credentialProfilesLoading,
    credentialProfilesError
  } = useSettingsStore();
  const { toast } = useToast();

  // Edit mode detection: profile prop determines mode
  const isEditMode = !!profile;

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<CredentialType>('api_key');
  const [credentialValue, setCredentialValue] = useState('');
  const [usageLimit, setUsageLimit] = useState<number | undefined>(undefined);
  const [rotationMode, setRotationMode] = useState<RotationMode>('manual');
  const [rateLimitThreshold, setRateLimitThreshold] = useState<number>(0.8);

  // Credential value change state (for edit mode)
  const [isChangingCredential, setIsChangingCredential] = useState(false);

  // Validation errors
  const [nameError, setNameError] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [usageLimitError, setUsageLimitError] = useState<string | null>(null);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  // Reset form and pre-populate when dialog opens
  useEffect(() => {
    if (open) {
      if (isEditMode && profile) {
        // Pre-populate form with existing profile data
        setName(profile.name);
        setType(profile.type);
        setCredentialValue(''); // Start empty - masked display shown instead
        setUsageLimit(profile.metadata?.usage_limit ? parseInt(profile.metadata.usage_limit, 10) : undefined);
        setRotationMode((profile.metadata?.rotation_mode as RotationMode) || 'manual');
        setRateLimitThreshold(profile.metadata?.rate_limit_threshold ? parseFloat(profile.metadata.rate_limit_threshold) : 0.8);
        setIsChangingCredential(false);
      } else {
        // Reset to empty form for create mode
        setName('');
        setType('api_key');
        setCredentialValue('');
        setUsageLimit(undefined);
        setRotationMode('manual');
        setRateLimitThreshold(0.8);
        setIsChangingCredential(false);
      }
      // Clear validation errors
      setNameError(null);
      setCredentialError(null);
      setUsageLimitError(null);
      setThresholdError(null);
    }
  }, [open, isEditMode, profile]);

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

    // Credential value validation (only in create mode or when changing in edit mode)
    if (!isEditMode || isChangingCredential) {
      if (!credentialValue.trim()) {
        setCredentialError('Credential value is required');
        isValid = false;
      } else {
        setCredentialError(null);
      }
    } else {
      setCredentialError(null);
    }

    // Usage limit validation (required for API profiles)
    if (type === 'api_key') {
      if (usageLimit === undefined || usageLimit === null) {
        setUsageLimitError('Usage limit is required for API profiles');
        isValid = false;
      } else if (usageLimit < 0) {
        setUsageLimitError('Usage limit must be a non-negative number');
        isValid = false;
      } else {
        setUsageLimitError(null);
      }
    } else {
      setUsageLimitError(null);
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

    return isValid;
  };

  // Handle save
  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    // Build metadata object
    const metadata: Record<string, string> = {
      rotation_mode: rotationMode,
      ...(rotationMode === 'rate_limit_aware' && { rate_limit_threshold: rateLimitThreshold.toString() }),
      ...(type === 'api_key' && usageLimit !== undefined && { usage_limit: usageLimit.toString() })
    };

    if (isEditMode && profile) {
      // Update existing profile
      const updatedProfile: CredentialProfile = {
        ...profile,
        name: name.trim(),
        type,
        // Only update credential value if user is changing it
        ...(isChangingCredential && { credential_value: credentialValue.trim() }),
        metadata: Object.keys(metadata).length > 0 ? metadata : null
      };
      const success = await updateCredentialProfileAsync(updatedProfile);
      if (success) {
        toast({
          title: 'Profile updated',
          description: `Profile "${name.trim()}" has been updated successfully.`,
        });
        onOpenChange(false);
        onSaved?.();
      }
    } else {
      // Create new profile
      const profileData: CredentialProfileFormData = {
        type,
        name: name.trim(),
        credential_value: credentialValue.trim(),
        usage_limit: type === 'api_key' ? usageLimit : undefined,
        rotation_mode: rotationMode,
        rate_limit_threshold: rotationMode === 'rate_limit_aware' ? rateLimitThreshold : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined
      };

      const success = await saveCredentialProfile(profileData);
      if (success) {
        toast({
          title: 'Profile created',
          description: `Profile "${name.trim()}" has been created successfully.`,
        });
        onOpenChange(false);
        onSaved?.();
      }
    }
  };

  // Check if usage limit field should be shown (only for API profiles)
  const showUsageLimit = type === 'api_key';

  // Check if rate limit threshold field should be shown (only for rate_limit_aware mode)
  const showThreshold = rotationMode === 'rate_limit_aware';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,600px)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Credential Profile' : 'Create Credential Profile'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the credential profile configuration below.'
              : 'Configure a new credential profile for API or OAuth authentication.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name field (required) */}
          <div className="space-y-2">
            <Label htmlFor="profile-name">
              Profile Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="profile-name"
              placeholder="e.g., Production API Key"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={nameError ? 'border-destructive' : ''}
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>

          {/* Type selector (required) */}
          <div className="space-y-2">
            <Label htmlFor="profile-type">
              Profile Type <span className="text-destructive">*</span>
            </Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as CredentialType)}
              disabled={isEditMode} // Don't allow changing type in edit mode
            >
              <SelectTrigger id="profile-type">
                <SelectValue placeholder="Select profile type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api_key">API Key</SelectItem>
                <SelectItem value="oauth">OAuth</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {type === 'api_key'
                ? 'API Key profiles require usage limits and support rotation strategies.'
                : 'OAuth profiles do not have usage limits.'}
            </p>
          </div>

          {/* Credential value field (required) */}
          <div className="space-y-2">
            <Label htmlFor="credential-value">
              Credential Value <span className="text-destructive">*</span>
            </Label>
            {isEditMode && !isChangingCredential && profile ? (
              // Edit mode: show masked credential
              <div className="flex items-center gap-2">
                <Input
                  id="credential-value"
                  value={maskCredential(profile.credential_value)}
                  disabled
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsChangingCredential(true)}
                >
                  Change
                </Button>
              </div>
            ) : (
              // Create mode or changing credential: show password input
              <>
                <Input
                  id="credential-value"
                  type="password"
                  placeholder={type === 'api_key' ? 'sk-ant-...' : 'OAuth token'}
                  value={credentialValue}
                  onChange={(e) => setCredentialValue(e.target.value)}
                  className={credentialError ? 'border-destructive' : ''}
                />
                {isEditMode && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsChangingCredential(false);
                      setCredentialValue('');
                      setCredentialError(null);
                    }}
                  >
                    Cancel Change
                  </Button>
                )}
              </>
            )}
            {credentialError && <p className="text-sm text-destructive">{credentialError}</p>}
          </div>

          {/* Usage limit field (API profiles only) */}
          {showUsageLimit && (
            <div className="space-y-2">
              <Label htmlFor="usage-limit">
                Usage Limit <span className="text-destructive">*</span>
              </Label>
              <Input
                id="usage-limit"
                type="number"
                min="0"
                placeholder="e.g., 100"
                value={usageLimit ?? ''}
                onChange={(e) => setUsageLimit(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                className={usageLimitError ? 'border-destructive' : ''}
              />
              {usageLimitError && <p className="text-sm text-destructive">{usageLimitError}</p>}
              <p className="text-xs text-muted-foreground">
                Maximum number of requests allowed for this profile.
              </p>
            </div>
          )}

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

          {/* General error display */}
          {credentialProfilesError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{credentialProfilesError}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={credentialProfilesLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={credentialProfilesLoading}
          >
            {credentialProfilesLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Profile'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

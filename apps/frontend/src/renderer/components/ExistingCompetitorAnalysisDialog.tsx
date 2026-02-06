import { Globe, RefreshCw, TrendingUp, CheckCircle, Key } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useSettingsStore } from '../stores/settings-store';
import { useTranslation } from 'react-i18next';

interface ExistingCompetitorAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUseExisting: () => void;
  onRunNew: () => void;
  onSkip: () => void;
  analysisDate?: Date;
  selectedProfileId: string | undefined;
  onProfileChange: (profileId: string | undefined) => void;
}

export function ExistingCompetitorAnalysisDialog({
  open,
  onOpenChange,
  onUseExisting,
  onRunNew,
  onSkip,
  analysisDate,
  selectedProfileId,
  onProfileChange,
}: ExistingCompetitorAnalysisDialogProps) {
  const { t } = useTranslation(['roadmap', 'common']);
  const { profiles } = useSettingsStore();
  const handleUseExisting = () => {
    onUseExisting();
    onOpenChange(false);
  };

  const handleRunNew = () => {
    onRunNew();
    onOpenChange(false);
  };

  const handleSkip = () => {
    onSkip();
    onOpenChange(false);
  };

  const formatDate = (date?: Date) => {
    if (!date) return 'recently';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[500px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-foreground">
            <TrendingUp className="h-5 w-5 text-primary" />
            Competitor Analysis Options
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            This project has an existing competitor analysis from {formatDate(analysisDate)}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-4 space-y-3">
          {/* API Profile Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t('roadmap:profileSelector.label')}</label>
            <Select
              value={selectedProfileId ?? 'auto'}
              onValueChange={(value) => onProfileChange(value === 'auto' ? undefined : value)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={t('roadmap:profileSelector.chooseProfile')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 shrink-0" />
                    <span className="font-medium">{t('roadmap:profileSelector.useActiveProfile')}</span>
                  </div>
                </SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 shrink-0" />
                      <div>
                        <span className="font-medium">{profile.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({profile.baseUrl})
                        </span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Option 1: Use existing (recommended) */}
          <button
            onClick={handleUseExisting}
            className="w-full rounded-lg bg-primary/10 border border-primary/30 p-4 text-left hover:bg-primary/20 transition-colors"
          >
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  Use existing analysis
                  <span className="text-xs text-primary font-normal">(Recommended)</span>
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Reuse the competitor insights you already have. Faster and no additional web searches.
                </p>
              </div>
            </div>
          </button>

          {/* Option 2: Run new analysis */}
          <button
            onClick={handleRunNew}
            className="w-full rounded-lg bg-muted/50 border border-border p-4 text-left hover:bg-muted transition-colors"
          >
            <div className="flex items-start gap-3">
              <RefreshCw className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-foreground">
                  Run new analysis
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Perform fresh web searches to get updated competitor information. Takes longer.
                </p>
              </div>
            </div>
          </button>

          {/* Option 3: Skip */}
          <button
            onClick={handleSkip}
            className="w-full rounded-lg bg-muted/30 border border-border/50 p-4 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <Globe className="h-5 w-5 text-muted-foreground/60 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Skip competitor analysis
                </h4>
                <p className="text-xs text-muted-foreground/80 mt-1">
                  Generate roadmap without any competitor insights.
                </p>
              </div>
            </div>
          </button>
        </div>

        <AlertDialogFooter className="sm:justify-start">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

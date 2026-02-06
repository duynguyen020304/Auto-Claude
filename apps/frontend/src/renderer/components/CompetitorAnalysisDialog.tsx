import { Search, Globe, AlertTriangle, TrendingUp, Key, RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useSettingsStore } from '../stores/settings-store';
import { useTranslation } from 'react-i18next';

interface CompetitorAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onDecline: () => void;
  selectedProfileId: string | undefined;
  onProfileChange: (profileId: string | undefined) => void;
}

export function CompetitorAnalysisDialog({
  open,
  onOpenChange,
  onAccept,
  onDecline,
  selectedProfileId,
  onProfileChange,
}: CompetitorAnalysisDialogProps) {
  const { t } = useTranslation(['roadmap', 'common']);
  const { profiles, activeProfileId } = useSettingsStore();
  const handleAccept = () => {
    onAccept();
    onOpenChange(false);
  };

  const handleDecline = () => {
    onDecline();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[500px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-foreground">
            <TrendingUp className="h-5 w-5 text-primary" />
            Enable Competitor Analysis?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            Enhance your roadmap with insights from competitor products
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-4 space-y-4">
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
          {/* What it does */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
            <h4 className="text-sm font-medium text-foreground mb-2">
              What competitor analysis does:
            </h4>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <Search className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                <span>Identifies 3-5 main competitors based on your project type</span>
              </li>
              <li className="flex items-start gap-2">
                <Globe className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                <span>
                  Searches app stores, forums, and social media for user feedback and pain points
                </span>
              </li>
              <li className="flex items-start gap-2">
                <TrendingUp className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
                <span>
                  Suggests features that address gaps in competitor products
                </span>
              </li>
            </ul>
          </div>

          {/* Privacy notice */}
          <div className="rounded-lg bg-warning/10 border border-warning/30 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-foreground">
                  Web searches will be performed
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  This feature will perform web searches to gather competitor information.
                  Your project name and type will be used in search queries.
                  No code or sensitive data is shared.
                </p>
              </div>
            </div>
          </div>

          {/* Optional info */}
          <p className="text-xs text-muted-foreground">
            You can generate a roadmap without competitor analysis if you prefer.
            The roadmap will still be based on your project structure and best practices.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleDecline}>
            No, Skip Analysis
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleAccept}>
            Yes, Enable Analysis
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

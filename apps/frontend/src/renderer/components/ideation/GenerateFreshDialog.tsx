import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

interface GenerateFreshDialogProps {
  open: boolean;
  isProcessing: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * Confirmation dialog for generating fresh ideas (deletes all existing ideas)
 */
export function GenerateFreshDialog({
  open,
  isProcessing,
  error,
  onOpenChange,
  onConfirm
}: GenerateFreshDialogProps) {
  const { t } = useTranslation(['dialogs', 'common']);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {error ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : (
              <Sparkles className="h-5 w-5 text-primary" />
            )}
            {error ? t('dialogs:generateFresh.errorTitle') : t('dialogs:generateFresh.title')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-3">
              {error ? (
                <p className="text-destructive">{error}</p>
              ) : (
                <>
                  <p>
                    {t('dialogs:generateFresh.description')}
                  </p>
                  <p>
                    {t('dialogs:generateFresh.willDelete')}
                  </p>
                </>
              )}
              {!error && (
                <p className="text-amber-600 dark:text-amber-500">
                  {t('dialogs:generateFresh.warning')}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isProcessing}>{t('common:buttons.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isProcessing}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('dialogs:generateFresh.generating')}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {t('dialogs:generateFresh.confirm')}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

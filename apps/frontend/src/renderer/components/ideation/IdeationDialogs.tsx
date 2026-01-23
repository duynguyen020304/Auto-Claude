import { CheckCircle2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import {
  IDEATION_TYPE_LABELS,
  IDEATION_TYPE_DESCRIPTIONS,
  IDEATION_TYPE_COLORS
} from '../../../shared/constants';
import type { IdeationType, IdeationConfig } from '../../../shared/types';
import { TypeIcon } from './TypeIcon';
import { ALL_IDEATION_TYPES } from './constants';

interface IdeationDialogsProps {
  showConfigDialog: boolean;
  showAddMoreDialog: boolean;
  config: IdeationConfig;
  typesToAdd: IdeationType[];
  availableTypesToAdd: IdeationType[];
  onToggleIdeationType: (type: IdeationType) => void;
  onToggleTypeToAdd: (type: IdeationType) => void;
  onSetConfig: (config: Partial<IdeationConfig>) => void;
  onCloseConfigDialog: () => void;
  onCloseAddMoreDialog: () => void;
  onConfirmAddMore: () => void;
}

export function IdeationDialogs({
  showConfigDialog,
  showAddMoreDialog,
  config,
  typesToAdd,
  availableTypesToAdd,
  onToggleIdeationType,
  onToggleTypeToAdd,
  onSetConfig,
  onCloseConfigDialog,
  onCloseAddMoreDialog,
  onConfirmAddMore
}: IdeationDialogsProps) {
  const { t } = useTranslation(['ideation', 'common']);

  return (
    <>
      {/* Configuration Dialog */}
      <Dialog open={showConfigDialog} onOpenChange={onCloseConfigDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ideation:dialogs.configTitle')}</DialogTitle>
            <DialogDescription>
              {t('ideation:dialogs.configDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4 max-h-96 overflow-y-auto">
            <div className="space-y-3">
              <h4 className="text-sm font-medium">{t('ideation:dialogs.typesSection')}</h4>
              {ALL_IDEATION_TYPES.map((type) => (
                <div
                  key={type}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-md ${IDEATION_TYPE_COLORS[type]}`}>
                      <TypeIcon type={type} />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{IDEATION_TYPE_LABELS[type]}</div>
                      <div className="text-xs text-muted-foreground">
                        {IDEATION_TYPE_DESCRIPTIONS[type]}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={config.enabledTypes.includes(type)}
                    onCheckedChange={() => onToggleIdeationType(type)}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">{t('ideation:dialogs.maxIdeas')}</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t('ideation:dialogs.maxIdeasDescription')}</span>
                  <span className="text-sm font-medium">{config.maxIdeasPerType}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={config.maxIdeasPerType}
                  onChange={(e) => onSetConfig({ maxIdeasPerType: parseInt(e.target.value, 10) })}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>20</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">{t('ideation:dialogs.contextSources')}</h4>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('ideation:dialogs.includeRoadmap')}</span>
                <Switch
                  checked={config.includeRoadmapContext}
                  onCheckedChange={(checked) => onSetConfig({ includeRoadmapContext: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('ideation:dialogs.includeKanban')}</span>
                <Switch
                  checked={config.includeKanbanContext}
                  onCheckedChange={(checked) => onSetConfig({ includeKanbanContext: checked })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseConfigDialog}>
              {t('ideation:dialogs.closeButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add More Ideas Dialog */}
      <Dialog open={showAddMoreDialog} onOpenChange={onCloseAddMoreDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ideation:dialogs.addMoreTitle')}</DialogTitle>
            <DialogDescription>
              {t('ideation:dialogs.addMoreDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3 max-h-96 overflow-y-auto">
            {availableTypesToAdd.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-success" />
                <p>{t('ideation:dialogs.allGenerated')}</p>
                <p className="text-sm mt-1">{t('ideation:dialogs.regenerateHint')}</p>
              </div>
            ) : (
              availableTypesToAdd.map((type) => (
                <div
                  key={type}
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                    typesToAdd.includes(type)
                      ? 'bg-primary/10 border border-primary'
                      : 'bg-muted/50 hover:bg-muted'
                  }`}
                  onClick={() => onToggleTypeToAdd(type)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-md ${IDEATION_TYPE_COLORS[type]}`}>
                      <TypeIcon type={type} />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{IDEATION_TYPE_LABELS[type]}</div>
                      <div className="text-xs text-muted-foreground">
                        {IDEATION_TYPE_DESCRIPTIONS[type]}
                      </div>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    typesToAdd.includes(type)
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground'
                  }`}>
                    {typesToAdd.includes(type) && (
                      <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {typesToAdd.length > 0 && t('ideation:dialogs.selectedCount', { count: typesToAdd.length })}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCloseAddMoreDialog}>
                {t('ideation:dialogs.cancelButton')}
              </Button>
              <Button
                onClick={onConfirmAddMore}
                disabled={typesToAdd.length === 0}
              >
                <Plus className="h-4 w-4 mr-1" />
                {typesToAdd.length > 0 ? t('ideation:dialogs.generateTypes', { count: typesToAdd.length }) : t('ideation:dialogs.generateIdeas')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

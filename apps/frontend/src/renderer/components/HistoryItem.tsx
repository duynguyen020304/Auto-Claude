import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn, formatRelativeTime } from '../lib/utils';
import type {
  ChatHistory,
  IdeationHistory,
  RoadmapHistory,
  RepoHistory,
} from '../../shared/types/auth';

/**
 * History item type discriminator
 */
type HistoryItemType =
  | { type: 'chat'; data: ChatHistory }
  | { type: 'ideation'; data: IdeationHistory }
  | { type: 'roadmap'; data: RoadmapHistory }
  | { type: 'repo'; data: RepoHistory };

/**
 * Props for HistoryItem component
 */
interface HistoryItemProps {
  item: HistoryItemType;
  onDelete?: () => void;
  className?: string;
}

/**
 * HistoryItem component
 *
 * Displays a single history item with its details and a delete button.
 * Supports all 4 history types: chat, ideation, roadmap, and repo.
 *
 * Features:
 * - Type-specific display (version for roadmap, repo name for repo, etc.)
 * - Relative time formatting for created/updated dates
 * - Delete button with callback
 * - i18n support for all UI text
 * - Memoized for performance optimization
 *
 * @example
 * ```tsx
 * <HistoryItem
 *   item={{ type: 'chat', data: chatHistory }}
 *   onDelete={() => handleDelete(chatHistory.id)}
 * />
 * ```
 */
export const HistoryItem = memo<HistoryItemProps>(({ item, onDelete, className }) => {
  const { t } = useTranslation(['tasks', 'common']);

  // Extract common data
  const { type, data } = item;

  // Get title based on type (repo history uses repo_name instead of title)
  const getTitle = () => {
    if (type === 'repo') {
      return (data as RepoHistory).repo_name || t('tasks:history.item.noTitle');
    }
    return (data as ChatHistory | IdeationHistory | RoadmapHistory).title || t('tasks:history.item.noTitle');
  };

  const title = getTitle();
  const createdAt = formatRelativeTime(new Date(data.created_at));
  const updatedAt = 'updated_at' in data ? formatRelativeTime(new Date(data.updated_at)) : null;

  // Render type-specific content
  const renderTypeSpecificInfo = () => {
    switch (type) {
      case 'chat':
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="text-xs">
              {t('tasks:history.types.chat')}
            </Badge>
            <span>{t('tasks:history.item.createdAt', { date: createdAt })}</span>
            {updatedAt && updatedAt !== createdAt && (
              <span>{t('tasks:history.item.updatedAt', { date: updatedAt })}</span>
            )}
          </div>
        );

      case 'ideation':
        const ideationData = data as IdeationHistory;
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="text-xs">
              {t('tasks:history.types.ideation')}
            </Badge>
            <span>{t('tasks:history.item.createdAt', { date: createdAt })}</span>
            {updatedAt && updatedAt !== createdAt && (
              <span>{t('tasks:history.item.updatedAt', { date: updatedAt })}</span>
            )}
            {ideationData.tags && ideationData.tags.length > 0 && (
              <div className="flex items-center gap-1 ml-2">
                {ideationData.tags.slice(0, 3).map((tag, index) => (
                  <Badge key={index} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
                {ideationData.tags.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{ideationData.tags.length - 3}
                  </Badge>
                )}
              </div>
            )}
          </div>
        );

      case 'roadmap':
        const roadmapData = data as RoadmapHistory;
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="text-xs">
              {t('tasks:history.types.roadmap')}
            </Badge>
            {roadmapData.version && (
              <Badge variant="outline" className="text-xs">
                v{roadmapData.version}
              </Badge>
            )}
            <span>{t('tasks:history.item.createdAt', { date: createdAt })}</span>
            {updatedAt && updatedAt !== createdAt && (
              <span>{t('tasks:history.item.updatedAt', { date: updatedAt })}</span>
            )}
          </div>
        );

      case 'repo':
        const repoData = data as RepoHistory;
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="text-xs">
              {t('tasks:history.types.repo')}
            </Badge>
            <span className="font-medium">{repoData.repo_name}</span>
            {repoData.interaction_type && (
              <Badge variant="outline" className="text-xs">
                {t(`tasks:history.interactionTypes.${repoData.interaction_type}` as const) ||
                  repoData.interaction_type}
              </Badge>
            )}
            <span>{t('tasks:history.item.createdAt', { date: createdAt })}</span>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Card className={cn('group hover:border-primary/50 transition-colors', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Title */}
            <h3 className="font-medium text-base truncate mb-2">{title}</h3>

            {/* Type-specific info */}
            {renderTypeSpecificInfo()}

            {/* Additional metadata for specific types */}
            {type === 'chat' && (data as ChatHistory).messages && (
              <p className="text-xs text-muted-foreground mt-1">
                {(data as ChatHistory).messages.length}{' '}
                {(data as ChatHistory).messages.length === 1 ? 'message' : 'messages'}
              </p>
            )}
          </div>

          {/* Actions */}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={t('tasks:history.actions.delete')}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

HistoryItem.displayName = 'HistoryItem';

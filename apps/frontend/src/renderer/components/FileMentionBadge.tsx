import * as React from 'react';
import { FileCode, X } from '@/lib/icons';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import type { FileMention } from '@/shared/types/insights';

export interface FileMentionBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  mention: FileMention;
  onRemove?: (id: string) => void;
  variant?: 'default' | 'error' | 'success';
}

export function FileMentionBadge({
  mention,
  onRemove,
  variant = 'default',
  className,
  ...props
}: FileMentionBadgeProps) {
  const { t } = useTranslation(['common', 'insights']);

  // Build display name with line range if present
  const displayName = React.useMemo(() => {
    if (mention.displayName) {
      return mention.displayName;
    }

    const fileName = mention.filePath.split('/').pop() || mention.filePath;
    if (mention.lineRange) {
      const { start, end } = mention.lineRange;
      const rangeStr = start === end ? `:${start}` : `:${start}-${end}`;
      return `${fileName}${rangeStr}`;
    }

    return fileName;
  }, [mention.displayName, mention.filePath, mention.lineRange]);

  // Build full path with tooltip
  const fullPath = React.useMemo(() => {
    if (mention.lineRange) {
      const { start, end } = mention.lineRange;
      const rangeStr = start === end ? `:${start}` : `:${start}-${end}`;
      return `${mention.filePath}${rangeStr}`;
    }
    return mention.filePath;
  }, [mention.filePath, mention.lineRange]);

  // Badge variant mapping
  const badgeVariant = variant === 'error' ? 'destructive' : variant === 'success' ? 'success' : 'secondary';

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(mention.id);
  };

  return (
    <Badge
      variant={badgeVariant}
      className={cn('gap-1.5 pr-1.5', className)}
      title={fullPath}
      aria-label={t('insights:fileMention.badgeTitle', { filePath: fullPath })}
      {...props}
    >
      <FileCode className="h-3 w-3" aria-hidden="true" />
      <span className="truncate max-w-[150px]">{displayName}</span>
      {onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          className={cn(
            'rounded-sm p-0.5 hover:bg-background/80',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'transition-colors'
          )}
          aria-label={t('insights:fileMention.removeAriaLabel', { fileName: displayName })}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </Badge>
  );
}

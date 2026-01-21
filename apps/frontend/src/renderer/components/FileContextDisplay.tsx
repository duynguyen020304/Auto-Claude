import { File, FileCode, FileJson, FileText, FileImage, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { FileMention } from '../../shared/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './ui/tooltip';
import { Badge } from './ui/badge';
import { useTranslation } from 'react-i18next';

interface FileContextDisplayProps {
  mentions: FileMention[];
  className?: string;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/**
 * Get appropriate icon based on file extension
 * Matches the pattern from ReferencedFilesSection.tsx
 */
function getFileIcon(name: string): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'cs':
    case 'php':
    case 'swift':
    case 'kt':
      return <FileCode className="h-4 w-4 text-info shrink-0" />;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return <FileJson className="h-4 w-4 text-warning shrink-0" />;
    case 'md':
    case 'txt':
    case 'rst':
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return <FileImage className="h-4 w-4 text-purple-400 shrink-0" />;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return <FileCode className="h-4 w-4 text-pink-400 shrink-0" />;
    case 'html':
    case 'htm':
      return <FileCode className="h-4 w-4 text-orange-400 shrink-0" />;
    default:
      return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

/**
 * Truncate a path for display, showing the beginning and end
 */
function truncatePath(path: string, maxLength: number = 40): string {
  if (path.length <= maxLength) return path;

  const start = Math.floor(maxLength / 3);
  const end = maxLength - start - 3; // 3 for "..."
  return `${path.slice(0, start)}...${path.slice(-end)}`;
}

/**
 * FileContextDisplay displays file metadata alongside AI responses
 * Shows file size, line count, encoding, and truncation status
 */
export function FileContextDisplay({
  mentions,
  className
}: FileContextDisplayProps) {
  const { t } = useTranslation(['common', 'insights']);

  // Filter mentions that have context resolved
  const mentionsWithMetadata = mentions.filter(m => m.context);

  if (mentionsWithMetadata.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className={cn('space-y-2', className)}>
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t('insights:fileContext.title', { defaultValue: 'Referenced Files' })}
          </span>
          <Badge variant="outline" className="text-xs">
            {mentionsWithMetadata.length}
          </Badge>
        </div>

        {/* File metadata list */}
        <div className="space-y-1.5">
          {mentionsWithMetadata.map((mention) => {
            const context = mention.context!;
            const fileName = mention.filePath.split('/').pop() || mention.filePath;
            const hasLineRange = mention.lineRange || context.startLine;

            return (
              <div
                key={mention.id}
                className={cn(
                  'flex items-start gap-2 py-1.5 px-2 rounded-md',
                  'bg-muted/30 border border-border/50'
                )}
              >
                {/* File icon */}
                <div className="shrink-0 mt-0.5">
                  {getFileIcon(fileName)}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0 space-y-1">
                  {/* File name with line range */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">
                      {fileName}
                    </span>
                    {hasLineRange && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {mention.lineRange
                          ? `:${mention.lineRange.start}-${mention.lineRange.end}`
                          : context.startLine
                          ? `:${context.startLine}+`
                          : ''}
                      </Badge>
                    )}
                    {context.truncated && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="text-xs px-1.5 py-0 gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {t('insights:fileContext.truncated', { defaultValue: 'Truncated' })}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p className="text-xs">
                            {t('insights:fileContext.truncatedTooltip', {
                              defaultValue: 'Showing {{lines}} of {{total}} lines',
                              lines: context.linesIncluded,
                              total: context.lineCount
                            })}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* Metadata row */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    {/* File size */}
                    {context.fileSize && (
                      <span>{formatFileSize(context.fileSize)}</span>
                    )}

                    {/* Line count */}
                    {context.lineCount && (
                      <span>
                        {t('insights:fileContext.lines', {
                          defaultValue: '{{count}} lines',
                          count: context.lineCount
                        })}
                      </span>
                    )}

                    {/* Encoding */}
                    {context.encoding && (
                      <span className="uppercase">{context.encoding}</span>
                    )}

                    {/* Lines included (when different from total) */}
                    {context.linesIncluded &&
                      context.lineCount &&
                      context.linesIncluded !== context.lineCount && (
                        <span>
                          {t('insights:fileContext.linesIncluded', {
                            defaultValue: '{{included}} included',
                            included: context.linesIncluded
                          })}
                        </span>
                      )}
                  </div>

                  {/* Full path tooltip */}
                  {mention.filePath !== fileName && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-xs text-muted-foreground truncate cursor-default">
                          {truncatePath(mention.filePath)}
                        </p>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="start" className="max-w-md">
                        <p className="text-xs break-all">{mention.filePath}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

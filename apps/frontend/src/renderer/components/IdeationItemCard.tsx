import { useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  Lightbulb,
  Sparkles,
  ExternalLink,
  Play,
  Shield,
  Zap,
  BookOpen,
  Palette,
  Gauge,
  Code2,
  AlertTriangle,
  Clock,
  Target
} from 'lucide-react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from './ui/collapsible';
import { cn } from '../lib/utils';
import {
  IDEATION_TYPE_COLORS,
  IDEATION_STATUS_COLORS,
  IDEATION_EFFORT_COLORS,
  SECURITY_SEVERITY_COLORS,
  CODE_QUALITY_SEVERITY_COLORS
} from '../../shared/constants';
import type {
  Idea,
  CodeImprovementIdea,
  UIUXImprovementIdea,
  DocumentationGapIdea,
  SecurityHardeningIdea,
  PerformanceOptimizationIdea,
  CodeQualityIdea,
  IdeationType
} from '../../shared/types';
import {
  isCodeImprovementIdea,
  isUIUXIdea,
  isDocumentationGapIdea,
  isSecurityHardeningIdea,
  isPerformanceOptimizationIdea,
  isCodeQualityIdea
} from './ideation/type-guards';

interface IdeationItemCardProps {
  idea: Idea;
  onExploreInChat?: (idea: Idea) => void;
  onConvertToSpec?: (idea: Idea) => void;
  onViewLinkedSpec?: (specId: string) => void;
  className?: string;
}

// Type to icon mapping
const TYPE_ICONS: Record<IdeationType, React.ReactNode> = {
  code_improvements: <Zap className="h-3.5 w-3.5" aria-hidden="true" />,
  ui_ux_improvements: <Palette className="h-3.5 w-3.5" aria-hidden="true" />,
  documentation_gaps: <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />,
  security_hardening: <Shield className="h-3.5 w-3.5" aria-hidden="true" />,
  performance_optimizations: <Gauge className="h-3.5 w-3.5" aria-hidden="true" />,
  code_quality: <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
};

// Effort value mapping for indicator display
const EFFORT_VALUE: Record<string, number> = {
  trivial: 1,
  small: 2,
  medium: 3,
  large: 4,
  complex: 5
};

// Metric indicator component (dots display)
function MetricIndicator({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex gap-0.5" role="presentation" aria-label={`Level ${value} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={`metric-dot-${i}`}
          className={cn(
            'w-1.5 h-1.5 rounded-full transition-colors',
            i < value ? 'bg-primary' : 'bg-muted-foreground/30'
          )}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

// Collapsible section component
interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  items: string[] | undefined;
  defaultOpen?: boolean;
}

function CollapsibleSection({ title, icon, items, defaultOpen = false }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const hasContent = items && items.length > 0;
  const contentId = useId();

  if (!hasContent) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-expanded={isOpen}
          aria-controls={contentId}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          )}
          {icon}
          <span>{title}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/70" aria-live="polite">
            {items.length}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent id={contentId} className="pt-1.5">
        <ul className="space-y-1 pl-5">
          {items.map((item, index) => (
            <li
              key={`item-${index}-${item.slice(0, 20)}`}
              className="text-xs text-muted-foreground list-disc marker:text-muted-foreground/50"
            >
              {item}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Type-specific badge renderer
function TypeSpecificBadges({ idea }: { idea: Idea }) {
  const { t } = useTranslation(['ideation', 'common']);

  if (isCodeImprovementIdea(idea)) {
    const typedIdea = idea as CodeImprovementIdea;
    return (
      <Badge
        variant="outline"
        className={cn('text-[10px] px-1.5 py-0', IDEATION_EFFORT_COLORS[typedIdea.estimatedEffort])}
      >
        {t('ideation:effort.' + typedIdea.estimatedEffort)}
      </Badge>
    );
  }

  if (isSecurityHardeningIdea(idea)) {
    const typedIdea = idea as SecurityHardeningIdea;
    return (
      <Badge
        variant="outline"
        className={cn('text-[10px] px-1.5 py-0', SECURITY_SEVERITY_COLORS[typedIdea.severity])}
      >
        <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
        {t('ideation:severity.' + typedIdea.severity)}
      </Badge>
    );
  }

  if (isPerformanceOptimizationIdea(idea)) {
    const typedIdea = idea as PerformanceOptimizationIdea;
    return (
      <>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 bg-purple-500/10 text-purple-400 border-purple-500/30"
        >
          <Target className="h-3 w-3 mr-1" aria-hidden="true" />
          {t('ideation:impact.' + typedIdea.impact)}
        </Badge>
        <Badge
          variant="outline"
          className={cn('text-[10px] px-1.5 py-0', IDEATION_EFFORT_COLORS[typedIdea.estimatedEffort])}
        >
          {t('ideation:effort.' + typedIdea.estimatedEffort)}
        </Badge>
      </>
    );
  }

  if (isCodeQualityIdea(idea)) {
    const typedIdea = idea as CodeQualityIdea;
    return (
      <>
        <Badge
          variant="outline"
          className={cn('text-[10px] px-1.5 py-0', CODE_QUALITY_SEVERITY_COLORS[typedIdea.severity])}
        >
          {t('ideation:severity.' + typedIdea.severity)}
        </Badge>
        <Badge
          variant="outline"
          className={cn('text-[10px] px-1.5 py-0', IDEATION_EFFORT_COLORS[typedIdea.estimatedEffort])}
        >
          {t('ideation:effort.' + typedIdea.estimatedEffort)}
        </Badge>
      </>
    );
  }

  if (isUIUXIdea(idea)) {
    const typedIdea = idea as UIUXImprovementIdea;
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
        {t('ideation:categories.' + typedIdea.category)}
      </Badge>
    );
  }

  if (isDocumentationGapIdea(idea)) {
    const typedIdea = idea as DocumentationGapIdea;
    return (
      <>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {t('ideation:categories.' + typedIdea.category)}
        </Badge>
        <Badge
          variant="outline"
          className={cn('text-[10px] px-1.5 py-0', IDEATION_EFFORT_COLORS[typedIdea.estimatedEffort])}
        >
          {t('ideation:effort.' + typedIdea.estimatedEffort)}
        </Badge>
      </>
    );
  }

  return null;
}

// Type-specific details renderer
function TypeSpecificDetails({ idea }: { idea: Idea }) {
  const { t } = useTranslation(['insights', 'ideation']);

  if (isCodeImprovementIdea(idea)) {
    const typedIdea = idea as CodeImprovementIdea;
    const effortValue = EFFORT_VALUE[typedIdea.estimatedEffort] || 1;

    return (
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t('insights:ideation.effort')}:</span>
          <MetricIndicator value={effortValue} />
        </div>
      </div>
    );
  }

  if (isPerformanceOptimizationIdea(idea)) {
    const typedIdea = idea as PerformanceOptimizationIdea;
    return (
      <div className="space-y-1 text-xs">
        {typedIdea.currentMetric && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.currentMetric')}:</span> {typedIdea.currentMetric}
          </p>
        )}
        {typedIdea.expectedImprovement && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.expectedImprovement')}:</span> {typedIdea.expectedImprovement}
          </p>
        )}
      </div>
    );
  }

  if (isSecurityHardeningIdea(idea)) {
    const typedIdea = idea as SecurityHardeningIdea;
    return (
      <div className="space-y-1 text-xs">
        {typedIdea.vulnerability && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.vulnerability')}:</span> {typedIdea.vulnerability}
          </p>
        )}
        {typedIdea.currentRisk && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.currentRisk')}:</span> {typedIdea.currentRisk}
          </p>
        )}
      </div>
    );
  }

  if (isUIUXIdea(idea)) {
    const typedIdea = idea as UIUXImprovementIdea;
    return (
      <div className="space-y-1 text-xs">
        {typedIdea.currentState && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.currentState')}:</span> {typedIdea.currentState}
          </p>
        )}
        {typedIdea.userBenefit && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.userBenefit')}:</span> {typedIdea.userBenefit}
          </p>
        )}
      </div>
    );
  }

  if (isDocumentationGapIdea(idea)) {
    const typedIdea = idea as DocumentationGapIdea;
    return (
      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">
          <span className="font-medium">{t('insights:ideation.targetAudience')}:</span>{' '}
          {t('ideation:audience.' + typedIdea.targetAudience)}
        </p>
        {typedIdea.priority && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.priority')}:</span>{' '}
            {t('ideation:priority.' + typedIdea.priority)}
          </p>
        )}
      </div>
    );
  }

  if (isCodeQualityIdea(idea)) {
    const typedIdea = idea as CodeQualityIdea;
    return (
      <div className="space-y-1 text-xs">
        {typedIdea.currentState && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.currentState')}:</span> {typedIdea.currentState}
          </p>
        )}
        {typedIdea.metrics?.lineCount && (
          <p className="text-muted-foreground">
            <span className="font-medium">{t('insights:ideation.linesOfCode')}:</span> {typedIdea.metrics.lineCount.toLocaleString()}
          </p>
        )}
        {typedIdea.breakingChange && (
          <p className="text-destructive text-[10px] font-medium">
            {t('insights:ideation.breakingChangeWarning')}
          </p>
        )}
      </div>
    );
  }

  return null;
}

// Get affected items based on idea type
function getAffectedItems(idea: Idea): string[] | undefined {
  if (isCodeImprovementIdea(idea)) {
    return (idea as CodeImprovementIdea).affectedFiles;
  }
  if (isSecurityHardeningIdea(idea)) {
    return (idea as SecurityHardeningIdea).affectedFiles;
  }
  if (isPerformanceOptimizationIdea(idea)) {
    return (idea as PerformanceOptimizationIdea).affectedAreas;
  }
  if (isCodeQualityIdea(idea)) {
    return (idea as CodeQualityIdea).affectedFiles;
  }
  if (isUIUXIdea(idea)) {
    return (idea as UIUXImprovementIdea).affectedComponents;
  }
  if (isDocumentationGapIdea(idea)) {
    return (idea as DocumentationGapIdea).affectedAreas;
  }
  return undefined;
}

// Get builds upon / prerequisites
function getPrerequisites(idea: Idea): string[] | undefined {
  if (isCodeImprovementIdea(idea)) {
    return (idea as CodeImprovementIdea).buildsUpon;
  }
  if (isCodeQualityIdea(idea)) {
    return (idea as CodeQualityIdea).prerequisites;
  }
  return undefined;
}

// Get existing patterns
function getExistingPatterns(idea: Idea): string[] | undefined {
  if (isCodeImprovementIdea(idea)) {
    return (idea as CodeImprovementIdea).existingPatterns;
  }
  return undefined;
}

export function IdeationItemCard({
  idea,
  onExploreInChat,
  onConvertToSpec,
  onViewLinkedSpec,
  className
}: IdeationItemCardProps) {
  const { t } = useTranslation(['insights', 'ideation', 'common']);
  const rationaleContentId = useId();
  const implementationContentId = useId();

  const isConverted = idea.status === 'converted';
  const isDismissed = idea.status === 'dismissed';
  const isArchived = idea.status === 'archived';
  const isInactive = isDismissed || isArchived;
  const canConvert = idea.status === 'draft' || idea.status === 'selected';

  const affectedItems = getAffectedItems(idea);
  const prerequisites = getPrerequisites(idea);
  const existingPatterns = getExistingPatterns(idea);

  // Get implementation-related text based on type
  const getImplementationText = (): string | undefined => {
    if (isCodeImprovementIdea(idea)) {
      return (idea as CodeImprovementIdea).implementationApproach;
    }
    if (isSecurityHardeningIdea(idea)) {
      return (idea as SecurityHardeningIdea).remediation;
    }
    if (isPerformanceOptimizationIdea(idea)) {
      return (idea as PerformanceOptimizationIdea).implementation;
    }
    if (isUIUXIdea(idea)) {
      return (idea as UIUXImprovementIdea).proposedChange;
    }
    if (isDocumentationGapIdea(idea)) {
      return (idea as DocumentationGapIdea).proposedContent;
    }
    if (isCodeQualityIdea(idea)) {
      return (idea as CodeQualityIdea).proposedChange;
    }
    return undefined;
  };

  const implementationText = getImplementationText();

  return (
    <Card
      className={cn('p-4 space-y-3 border-l-4', className)}
      style={{
        borderLeftColor: idea.type === 'security_hardening' ? 'var(--destructive)' :
          idea.type === 'performance_optimizations' ? '#a855f7' :
          idea.type === 'code_quality' ? '#06b6d4' :
          idea.type === 'ui_ux_improvements' ? 'var(--info)' :
          idea.type === 'documentation_gaps' ? '#f59e0b' :
          'var(--success)'
      }}
      role="article"
      aria-label={t('insights:ideation.itemAriaLabel', { title: idea.title })}
    >
      {/* Header - Title, Type, Status, Badges */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={cn('text-[10px] px-1.5 py-0', IDEATION_TYPE_COLORS[idea.type])}
            >
              {TYPE_ICONS[idea.type]}
              <span className="ml-1">{t('ideation:types.' + idea.type)}</span>
            </Badge>
            {idea.status !== 'draft' && (
              <Badge
                variant="outline"
                className={cn('text-[10px] px-1.5 py-0', IDEATION_STATUS_COLORS[idea.status])}
              >
                {t('ideation:status.' + idea.status)}
              </Badge>
            )}
            <TypeSpecificBadges idea={idea} />
          </div>
          <h3 className={cn('text-base font-semibold leading-snug', isInactive && 'line-through')}>
            {idea.title}
          </h3>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {onExploreInChat && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onExploreInChat(idea)}
              aria-label={t('insights:ideation.exploreInChat')}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          )}
          {isConverted && idea.taskId ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => idea.taskId && onViewLinkedSpec?.(idea.taskId)}
              aria-label={t('insights:ideation.viewLinkedSpec')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              <span className="text-xs">{t('insights:ideation.viewSpec')}</span>
            </Button>
          ) : (
            canConvert && onConvertToSpec && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => onConvertToSpec(idea)}
                aria-label={t('insights:ideation.convertToSpec')}
              >
                <Play className="h-3 w-3 mr-1" />
                <span className="text-xs">{t('insights:ideation.convertToSpec')}</span>
              </Button>
            )
          )}
        </div>
      </div>

      {/* Description */}
      {idea.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {idea.description}
        </p>
      )}

      {/* Type-specific metrics/details */}
      <TypeSpecificDetails idea={idea} />

      {/* Collapsible Sections */}
      <div className="space-y-1 pt-1 border-t border-border/50">
        {/* Affected Items (files, components, areas) */}
        <CollapsibleSection
          title={t('insights:ideation.affectedItems')}
          icon={<FileText className="h-3 w-3" aria-hidden="true" />}
          items={affectedItems}
        />

        {/* Prerequisites / Builds Upon */}
        <CollapsibleSection
          title={isCodeImprovementIdea(idea) ? t('insights:ideation.buildsUpon') : t('insights:ideation.prerequisites')}
          icon={<GitBranch className="h-3 w-3" aria-hidden="true" />}
          items={prerequisites}
        />

        {/* Existing Patterns (code improvements only) */}
        {isCodeImprovementIdea(idea) && existingPatterns && existingPatterns.length > 0 && (
          <CollapsibleSection
            title={t('insights:ideation.existingPatterns')}
            icon={<Code2 className="h-3 w-3" aria-hidden="true" />}
            items={existingPatterns}
          />
        )}

        {/* Implementation / Remediation */}
        {implementationText && (
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                aria-expanded="false"
                aria-controls={implementationContentId}
              >
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
                <Target className="h-3 w-3" aria-hidden="true" />
                <span>
                  {isSecurityHardeningIdea(idea)
                    ? t('insights:ideation.remediation')
                    : isCodeQualityIdea(idea)
                    ? t('insights:ideation.proposedChange')
                    : t('insights:ideation.implementation')}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent id={implementationContentId} className="pt-1.5 pl-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {implementationText}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Rationale */}
        {idea.rationale && (
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                aria-expanded="false"
                aria-controls={rationaleContentId}
              >
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
                <Lightbulb className="h-3 w-3" aria-hidden="true" />
                <span>{t('insights:ideation.rationale')}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent id={rationaleContentId} className="pt-1.5 pl-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {idea.rationale}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </Card>
  );
}

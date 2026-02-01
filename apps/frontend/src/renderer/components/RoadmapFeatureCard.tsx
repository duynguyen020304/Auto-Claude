import { useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  CheckCircle2,
  GitBranch,
  Lightbulb,
  Sparkles,
  ExternalLink,
  Play
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
  ROADMAP_STATUS_COLORS,
  ROADMAP_STATUS_LABELS,
  ROADMAP_PRIORITY_COLORS,
  ROADMAP_PRIORITY_LABELS
} from '../../shared/constants';
import type { RoadmapFeature } from '../../shared/types';

interface RoadmapFeatureCardProps {
  feature: RoadmapFeature;
  onConvertToSpec?: (feature: RoadmapFeature) => void;
  onViewLinkedSpec?: (specId: string) => void;
  onExploreInChat?: (feature: RoadmapFeature) => void;
  className?: string;
}

// Complexity/Impact value mapping (low=1, medium=2, high=3)
const COMPLEXITY_IMPACT_VALUE: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3
};

// Metric indicator component (dots display)
function MetricIndicator({ value, max = 3 }: { value: number; max?: number }) {
  return (
    <div className="flex gap-0.5" role="presentation" aria-label={`Level ${value} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
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
              key={index}
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

export function RoadmapFeatureCard({
  feature,
  onConvertToSpec,
  onViewLinkedSpec,
  onExploreInChat,
  className
}: RoadmapFeatureCardProps) {
  const { t } = useTranslation(['insights', 'common']);
  const rationaleContentId = useId();

  const complexityValue = COMPLEXITY_IMPACT_VALUE[feature.complexity] || 1;
  const impactValue = COMPLEXITY_IMPACT_VALUE[feature.impact] || 1;

  return (
    <Card
      className={cn('p-4 space-y-3', className)}
      role="article"
      aria-label={`Roadmap feature: ${feature.title}`}
    >
      {/* Header - Title, Status, Priority */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={cn('text-[10px] px-1.5 py-0', ROADMAP_STATUS_COLORS[feature.status])}
            >
              {ROADMAP_STATUS_LABELS[feature.status]}
            </Badge>
            <Badge
              variant="outline"
              className={cn('text-[10px] px-1.5 py-0', ROADMAP_PRIORITY_COLORS[feature.priority])}
            >
              {ROADMAP_PRIORITY_LABELS[feature.priority]}
            </Badge>
          </div>
          <h3 className="text-base font-semibold leading-snug">{feature.title}</h3>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {onExploreInChat && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onExploreInChat(feature)}
              aria-label={t('insights:roadmap.featureCard.exploreInChat')}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          )}
          {feature.linkedSpecId ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => onViewLinkedSpec?.(feature.linkedSpecId!)}
              aria-label={t('insights:roadmap.featureCard.viewLinkedSpec')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              <span className="text-xs">{t('insights:roadmap.featureCard.viewSpec')}</span>
            </Button>
          ) : (
            onConvertToSpec && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => onConvertToSpec(feature)}
                aria-label={t('insights:roadmap.featureCard.convertToSpec')}
              >
                <Play className="h-3 w-3 mr-1" />
                <span className="text-xs">{t('insights:roadmap.featureCard.convertToSpec')}</span>
              </Button>
            )
          )}
        </div>
      </div>

      {/* Description */}
      {feature.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {feature.description}
        </p>
      )}

      {/* Metrics - Complexity & Impact */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t('insights:roadmap.featureCard.complexity')}:</span>
          <MetricIndicator value={complexityValue} />
          <span className="text-muted-foreground/70 capitalize">{feature.complexity}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t('insights:roadmap.featureCard.impact')}:</span>
          <MetricIndicator value={impactValue} />
          <span className="text-muted-foreground/70 capitalize">{feature.impact}</span>
        </div>
      </div>

      {/* Collapsible Sections */}
      <div className="space-y-1 pt-1 border-t border-border/50">
        {/* User Stories */}
        <CollapsibleSection
          title={t('insights:roadmap.featureCard.userStories')}
          icon={<FileText className="h-3 w-3" aria-hidden="true" />}
          items={feature.userStories}
        />

        {/* Acceptance Criteria */}
        <CollapsibleSection
          title={t('insights:roadmap.featureCard.acceptanceCriteria')}
          icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
          items={feature.acceptanceCriteria}
        />

        {/* Dependencies */}
        {feature.dependencies && feature.dependencies.length > 0 && (
          <CollapsibleSection
            title={t('insights:roadmap.featureCard.dependencies')}
            icon={<GitBranch className="h-3 w-3" aria-hidden="true" />}
            items={feature.dependencies}
          />
        )}

        {/* Rationale */}
        {feature.rationale && (
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
                <span>{t('insights:roadmap.featureCard.rationale')}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent id={rationaleContentId} className="pt-1.5 pl-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {feature.rationale}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </Card>
  );
}

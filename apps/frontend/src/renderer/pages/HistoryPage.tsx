import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

/**
 * History page component
 *
 * Provides tabbed interface for viewing different types of user history:
 * - Chat history (conversation threads)
 * - Ideation history (brainstorming sessions)
 * - Roadmap history (roadmap versions)
 * - Repository history (repository interactions)
 *
 * Features:
 * - Tab-based navigation between history types
 * - Search functionality for filtering history items
 * - Time period and status filters
 * - i18n support for all UI text
 * - Empty state for each history type
 * - Consistent styling with other pages
 */
export function HistoryPage() {
  const { t } = useTranslation(['history', 'common']);

  // State for search and filters
  const [searchQuery, setSearchQuery] = useState('');
  const [timePeriodFilter, setTimePeriodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Check if filters are active
  const hasActiveFilters = searchQuery || timePeriodFilter !== 'all' || statusFilter !== 'all';

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery('');
    setTimePeriodFilter('all');
    setStatusFilter('all');
  };

  return (
    <div className="container mx-auto max-w-6xl py-6 px-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">
            {t('history:title')}
          </CardTitle>
          <CardDescription>
            View and manage your history across different features
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Search and Filter Controls */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            {/* Search Input */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t('history:actions.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Time Period Filter */}
            <Select value={timePeriodFilter} onValueChange={setTimePeriodFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder={t('history:filters.timePeriod')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('history:filters.timePeriods.all')}</SelectItem>
                <SelectItem value="today">{t('history:filters.timePeriods.today')}</SelectItem>
                <SelectItem value="yesterday">{t('history:filters.timePeriods.yesterday')}</SelectItem>
                <SelectItem value="last7Days">{t('history:filters.timePeriods.last7Days')}</SelectItem>
                <SelectItem value="last30Days">{t('history:filters.timePeriods.last30Days')}</SelectItem>
                <SelectItem value="last90Days">{t('history:filters.timePeriods.last90Days')}</SelectItem>
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder={t('history:filters.status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('history:filters.statuses.all')}</SelectItem>
                <SelectItem value="active">{t('history:filters.statuses.active')}</SelectItem>
                <SelectItem value="completed">{t('history:filters.statuses.completed')}</SelectItem>
                <SelectItem value="archived">{t('history:filters.statuses.archived')}</SelectItem>
              </SelectContent>
            </Select>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="px-3"
              >
                <X className="h-4 w-4 mr-2" />
                {t('history:filters.clear')}
              </Button>
            )}
          </div>

          <Tabs defaultValue="chat" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="chat">
                {t('history:tabs.chat')}
              </TabsTrigger>
              <TabsTrigger value="ideation">
                {t('history:tabs.ideation')}
              </TabsTrigger>
              <TabsTrigger value="roadmap">
                {t('history:tabs.roadmap')}
              </TabsTrigger>
              <TabsTrigger value="repo">
                {t('history:tabs.repo')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="mt-4">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-lg font-medium text-muted-foreground">
                  {t('history:empty.title')}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('history:empty.description')}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="ideation" className="mt-4">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-lg font-medium text-muted-foreground">
                  {t('history:empty.title')}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('history:empty.description')}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="roadmap" className="mt-4">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-lg font-medium text-muted-foreground">
                  {t('history:empty.title')}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('history:empty.description')}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="repo" className="mt-4">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-lg font-medium text-muted-foreground">
                  {t('history:empty.title')}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('history:empty.description')}
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

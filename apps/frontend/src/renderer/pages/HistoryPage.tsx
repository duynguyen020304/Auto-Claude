import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

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
 * - i18n support for all UI text
 * - Empty state for each history type
 * - Consistent styling with other pages
 */
export function HistoryPage() {
  const { t } = useTranslation(['history', 'common']);

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

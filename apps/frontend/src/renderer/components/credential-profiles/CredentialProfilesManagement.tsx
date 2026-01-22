/**
 * CredentialProfilesManagement - Main credential profiles management interface
 *
 * Provides tabbed interface for managing:
 * - Credential Profiles (API and OAuth)
 * - Pools (profile groups)
 * - Usage Monitor (real-time usage tracking)
 */

import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { CredentialProfilesManager } from './CredentialProfilesManager';
import { PoolManager } from './PoolManager';
import { UsageMonitor } from './UsageMonitor';

type TabValue = 'profiles' | 'pools' | 'usage';

export function CredentialProfilesManagement() {
  return (
    <div className="w-full">
      <Tabs defaultValue="profiles" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="pools">Pools</TabsTrigger>
          <TabsTrigger value="usage">Usage Monitor</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-6">
          <CredentialProfilesManager />
        </TabsContent>

        <TabsContent value="pools" className="mt-6">
          <PoolManager />
        </TabsContent>

        <TabsContent value="usage" className="mt-6">
          <UsageMonitor />
        </TabsContent>
      </Tabs>
    </div>
  );
}

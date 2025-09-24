import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield } from 'lucide-react';
import RolesManagement from '@/components/admin/RolesManagement';

export default function AdminRolesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Role Management
        </h1>
        <p className="text-muted-foreground">
          Create and manage system roles with different permission levels
        </p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Roles
          </CardTitle>
          <CardDescription>
            Define system roles and their descriptions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RolesManagement />
        </CardContent>
      </Card>
    </div>
  );
}
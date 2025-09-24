import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCheck } from 'lucide-react';
import RoleAssignments from '@/components/admin/RoleAssignments';

export default function AdminAssignmentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Role Assignments
        </h1>
        <p className="text-muted-foreground">
          Assign roles to users and manage user access permissions
        </p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            User Role Assignments
          </CardTitle>
          <CardDescription>
            Manage which roles are assigned to each user
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoleAssignments />
        </CardContent>
      </Card>
    </div>
  );
}
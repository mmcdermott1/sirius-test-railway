import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WorkerLayout } from "@/components/layouts/WorkerLayout";
import { Badge } from "@/components/ui/badge";

function WorkerStewardContent() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Shop Steward</CardTitle>
          <Badge variant="outline">Coming Soon</Badge>
        </div>
        <CardDescription>
          Manage shop steward designation for this worker
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          This feature is under development. When complete, you will be able to designate this worker as a shop steward and manage their steward-related information.
        </p>
      </CardContent>
    </Card>
  );
}

export default function WorkerSteward() {
  return (
    <WorkerLayout activeTab="steward">
      <WorkerStewardContent />
    </WorkerLayout>
  );
}

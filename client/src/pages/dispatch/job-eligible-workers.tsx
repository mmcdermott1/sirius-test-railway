import { DispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";

export default function DispatchJobEligibleWorkersPage() {
  return (
    <DispatchJobLayout activeTab="eligible-workers">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Eligible Workers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Users className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              Coming Soon
            </h3>
            <p className="text-muted-foreground max-w-md">
              This feature will show workers who are eligible for this dispatch job based on their skills, availability, and other criteria.
            </p>
          </div>
        </CardContent>
      </Card>
    </DispatchJobLayout>
  );
}

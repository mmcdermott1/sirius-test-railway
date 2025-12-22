import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommInApp } from "@/components/comm/CommInApp";
import { Bell, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function WorkerSendInAppContent() {
  const { contact } = useWorkerLayout();

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Send In-App Message
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Contact Not Found</AlertTitle>
            <AlertDescription>
              Unable to load contact information for this worker.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return <CommInApp contactId={contact.id} />;
}

export default function WorkerSendInApp() {
  return (
    <WorkerLayout activeTab="send-inapp">
      <WorkerSendInAppContent />
    </WorkerLayout>
  );
}

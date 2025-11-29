import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { CommEmail } from "@/components/comm/CommEmail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function WorkerSendEmailContent() {
  const { worker, contact } = useWorkerLayout();

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Email
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

  return (
    <CommEmail 
      contactId={contact.id} 
      email={contact.email}
      contactName={contact.displayName}
    />
  );
}

export default function WorkerSendEmail() {
  return (
    <WorkerLayout activeTab="send-email">
      <WorkerSendEmailContent />
    </WorkerLayout>
  );
}

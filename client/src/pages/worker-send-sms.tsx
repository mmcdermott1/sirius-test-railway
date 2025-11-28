import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { MessageSquare, Construction } from "lucide-react";

function WorkerSendSmsContent() {
  const { worker } = useWorkerLayout();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Send SMS
        </CardTitle>
        <CardDescription>
          Send SMS messages to this worker
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-4">
          <Construction className="h-16 w-16" />
          <div className="text-center">
            <p className="text-lg font-medium">Coming Soon</p>
            <p className="text-sm">SMS sending functionality is under development.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkerSendSms() {
  return (
    <WorkerLayout activeTab="send-sms">
      <WorkerSendSmsContent />
    </WorkerLayout>
  );
}

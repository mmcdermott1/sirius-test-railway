import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import BirthDateManagement from "@/components/worker/BirthDateManagement";

function WorkerBirthDateContent() {
  const { worker } = useWorkerLayout();

  return (
    <Card>
      <CardContent>
        <BirthDateManagement contactId={worker.contactId} />
      </CardContent>
    </Card>
  );
}

export default function WorkerBirthDate() {
  return (
    <WorkerLayout activeTab="birth-date">
      <WorkerBirthDateContent />
    </WorkerLayout>
  );
}

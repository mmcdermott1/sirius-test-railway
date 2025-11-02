import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import GenderManagement from "@/components/worker/GenderManagement";

function WorkerGenderContent() {
  const { worker } = useWorkerLayout();

  return (
    <Card>
      <CardContent>
        <GenderManagement contactId={worker.contactId} />
      </CardContent>
    </Card>
  );
}

export default function WorkerGender() {
  return (
    <WorkerLayout activeTab="gender">
      <WorkerGenderContent />
    </WorkerLayout>
  );
}

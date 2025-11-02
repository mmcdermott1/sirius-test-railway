import { Card, CardContent } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import NameManagement from "@/components/worker/NameManagement";

function WorkerNameContent() {
  const { worker } = useWorkerLayout();

  return (
    <Card>
      <CardContent>
        <NameManagement workerId={worker.id} contactId={worker.contactId} />
      </CardContent>
    </Card>
  );
}

export default function WorkerName() {
  return (
    <WorkerLayout activeTab="name">
      <WorkerNameContent />
    </WorkerLayout>
  );
}

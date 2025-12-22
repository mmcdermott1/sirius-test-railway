import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommInApp } from "@/components/comm/CommInApp";

function EmployerContactSendInAppContent() {
  const { employerContact } = useEmployerContactLayout();

  return <CommInApp contactId={employerContact.contactId} />;
}

export default function EmployerContactSendInApp() {
  return (
    <EmployerContactLayout activeTab="send-inapp">
      <EmployerContactSendInAppContent />
    </EmployerContactLayout>
  );
}

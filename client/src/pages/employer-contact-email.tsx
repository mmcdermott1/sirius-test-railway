import { Card, CardContent } from "@/components/ui/card";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import EmployerContactEmailManagement from "@/components/employer-contacts/EmployerContactEmailManagement";

function EmployerContactEmailContent() {
  const { employerContact } = useEmployerContactLayout();

  return (
    <Card>
      <CardContent>
        <EmployerContactEmailManagement 
          employerContactId={employerContact.id} 
          contactEmail={employerContact.contact.email}
        />
      </CardContent>
    </Card>
  );
}

export default function EmployerContactEmail() {
  return (
    <EmployerContactLayout activeTab="email">
      <EmployerContactEmailContent />
    </EmployerContactLayout>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import EmployerContactNameManagement from "@/components/employer-contacts/EmployerContactNameManagement";

function EmployerContactNameContent() {
  const { employerContact } = useEmployerContactLayout();

  return (
    <Card>
      <CardContent>
        <EmployerContactNameManagement 
          employerContactId={employerContact.id}
          contactDisplayName={employerContact.contact.displayName}
          contactData={{
            title: employerContact.contact.title,
            given: employerContact.contact.given,
            middle: employerContact.contact.middle,
            family: employerContact.contact.family,
            generational: employerContact.contact.generational,
            credentials: employerContact.contact.credentials,
          }}
        />
      </CardContent>
    </Card>
  );
}

export default function EmployerContactName() {
  return (
    <EmployerContactLayout activeTab="name">
      <EmployerContactNameContent />
    </EmployerContactLayout>
  );
}

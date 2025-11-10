import { Card, CardContent } from "@/components/ui/card";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { PhoneNumberManagement } from "@/components/worker/PhoneNumberManagement";

function EmployerContactPhoneNumbersContent() {
  const { employerContact } = useEmployerContactLayout();

  return (
    <Card>
      <CardContent>
        <PhoneNumberManagement contactId={employerContact.contactId} />
      </CardContent>
    </Card>
  );
}

export default function EmployerContactPhoneNumbers() {
  return (
    <EmployerContactLayout activeTab="phone-numbers">
      <EmployerContactPhoneNumbersContent />
    </EmployerContactLayout>
  );
}

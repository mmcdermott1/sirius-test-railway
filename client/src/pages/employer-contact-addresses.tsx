import { Card, CardContent } from "@/components/ui/card";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import AddressManagement from "@/components/worker/AddressManagement";

function EmployerContactAddressesContent() {
  const { employerContact } = useEmployerContactLayout();

  return (
    <Card>
      <CardContent>
        <AddressManagement 
          workerId={employerContact.id} 
          contactId={employerContact.contactId} 
        />
      </CardContent>
    </Card>
  );
}

export default function EmployerContactAddresses() {
  return (
    <EmployerContactLayout activeTab="addresses">
      <EmployerContactAddressesContent />
    </EmployerContactLayout>
  );
}

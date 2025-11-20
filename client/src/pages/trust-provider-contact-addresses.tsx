import { Card, CardContent } from "@/components/ui/card";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import AddressManagement from "@/components/worker/AddressManagement";

function TrustProviderContactAddressesContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  return (
    <Card>
      <CardContent>
        <AddressManagement 
          workerId={trustProviderContact.id} 
          contactId={trustProviderContact.contactId} 
        />
      </CardContent>
    </Card>
  );
}

export default function TrustProviderContactAddresses() {
  return (
    <TrustProviderContactLayout activeTab="addresses">
      <TrustProviderContactAddressesContent />
    </TrustProviderContactLayout>
  );
}

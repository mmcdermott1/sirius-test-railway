import { Card, CardContent } from "@/components/ui/card";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import TrustProviderContactEmailManagement from "@/components/trust-provider-contacts/TrustProviderContactEmailManagement";

function TrustProviderContactEmailContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  return (
    <Card>
      <CardContent>
        <TrustProviderContactEmailManagement 
          trustProviderContactId={trustProviderContact.id} 
          contactEmail={trustProviderContact.contact.email}
        />
      </CardContent>
    </Card>
  );
}

export default function TrustProviderContactEmail() {
  return (
    <TrustProviderContactLayout activeTab="email">
      <TrustProviderContactEmailContent />
    </TrustProviderContactLayout>
  );
}

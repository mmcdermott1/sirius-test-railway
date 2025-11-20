import { Card, CardContent } from "@/components/ui/card";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import TrustProviderContactNameManagement from "@/components/trust-provider-contacts/TrustProviderContactNameManagement";

function TrustProviderContactNameContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  return (
    <Card>
      <CardContent>
        <TrustProviderContactNameManagement 
          trustProviderContactId={trustProviderContact.id}
          contactDisplayName={trustProviderContact.contact.displayName}
          contactData={{
            title: trustProviderContact.contact.title,
            given: trustProviderContact.contact.given,
            middle: trustProviderContact.contact.middle,
            family: trustProviderContact.contact.family,
            generational: trustProviderContact.contact.generational,
            credentials: trustProviderContact.contact.credentials,
          }}
        />
      </CardContent>
    </Card>
  );
}

export default function TrustProviderContactName() {
  return (
    <TrustProviderContactLayout activeTab="name">
      <TrustProviderContactNameContent />
    </TrustProviderContactLayout>
  );
}

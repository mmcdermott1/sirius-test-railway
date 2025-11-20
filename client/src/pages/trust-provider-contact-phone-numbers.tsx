import { Card, CardContent } from "@/components/ui/card";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { PhoneNumberManagement } from "@/components/worker/PhoneNumberManagement";

function TrustProviderContactPhoneNumbersContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  return (
    <Card>
      <CardContent>
        <PhoneNumberManagement contactId={trustProviderContact.contactId} />
      </CardContent>
    </Card>
  );
}

export default function TrustProviderContactPhoneNumbers() {
  return (
    <TrustProviderContactLayout activeTab="phone-numbers">
      <TrustProviderContactPhoneNumbersContent />
    </TrustProviderContactLayout>
  );
}

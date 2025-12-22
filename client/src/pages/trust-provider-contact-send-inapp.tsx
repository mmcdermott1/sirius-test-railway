import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { CommInApp } from "@/components/comm/CommInApp";

function TrustProviderContactSendInAppContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  return <CommInApp contactId={trustProviderContact.contactId} />;
}

export default function TrustProviderContactSendInApp() {
  return (
    <TrustProviderContactLayout activeTab="send-inapp">
      <TrustProviderContactSendInAppContent />
    </TrustProviderContactLayout>
  );
}

import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import EntityNotesPanel from "@/components/entity-notes/EntityNotesPanel";

function TrustProviderNotesContent() {
  const { provider } = useTrustProviderLayout();

  if (!provider) {
    return null;
  }

  return <EntityNotesPanel entityType="trust_provider" entityId={provider.id} />;
}

export default function TrustProviderNotesPage() {
  return (
    <TrustProviderLayout activeTab="notes">
      <TrustProviderNotesContent />
    </TrustProviderLayout>
  );
}

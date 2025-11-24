import { EALayout } from "@/components/layouts/EALayout";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";
import { useParams } from "wouter";

function EATransactionsContent() {
  const { id } = useParams<{ id: string }>();

  return (
    <LedgerTransactionsView
      queryKey={[`/api/ledger/ea/${id}/transactions`]}
      title="Transactions"
      csvFilename="ea-transactions"
    />
  );
}

export default function EATransactionsPage() {
  return (
    <EALayout activeTab="transactions">
      <EATransactionsContent />
    </EALayout>
  );
}

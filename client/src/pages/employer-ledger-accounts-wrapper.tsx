import { EmployerLayout } from "@/components/layouts/EmployerLayout";
import EmployerLedgerAccounts from "./employer-ledger-accounts";

export default function EmployerLedgerAccountsWrapper() {
  return (
    <EmployerLayout activeTab="ledger-accounts">
      <EmployerLedgerAccounts />
    </EmployerLayout>
  );
}

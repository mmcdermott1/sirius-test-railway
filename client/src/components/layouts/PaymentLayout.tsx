import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { LedgerPayment } from "@shared/schema";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaymentLayoutProps {
  children: React.ReactNode;
  activeTab: "view" | "edit";
}

export function PaymentLayout({ children, activeTab }: PaymentLayoutProps) {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  const { data: payment, isLoading } = useQuery<LedgerPayment>({
    queryKey: ["/api/ledger/payments", id],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="container mx-auto py-6">
        <p className="text-muted-foreground">Payment not found</p>
      </div>
    );
  }

  const paymentIdShort = payment.id.slice(0, 8);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.history.back()}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          Payment {paymentIdShort}...
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage this payment record
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setLocation(`/ledger/payment/${id}/${value === "view" ? "" : value}`)}>
        <TabsList>
          <TabsTrigger value="view" data-testid="tab-view">
            View
          </TabsTrigger>
          <TabsTrigger value="edit" data-testid="tab-edit">
            Edit
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {children}
    </div>
  );
}

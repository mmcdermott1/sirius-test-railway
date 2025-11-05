import { Heart } from "lucide-react";
import { AddTrustBenefitForm } from "@/components/trust-benefits/add-trust-benefit-form";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { TrustBenefit } from "@shared/schema";
import { PageHeader } from "@/components/layout/PageHeader";

export default function TrustBenefitsAdd() {
  const [location] = useLocation();
  const { data: benefits = [] } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const tabs = [
    { id: "list", label: "List", href: "/trust-benefits" },
    { id: "add", label: "Add", href: "/trust-benefits/add" },
  ];

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Add Trust Benefit" 
        icon={<Heart className="text-primary-foreground" size={16} />}
        backLink={{ href: "/trust-benefits", label: "Back to Trust Benefits" }}
      />

      {/* Tab Navigation */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => (
              <Link key={tab.id} href={tab.href}>
                <Button
                  variant={location === tab.href ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-trust-benefits-${tab.id}`}
                >
                  {tab.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AddTrustBenefitForm />
      </main>
    </div>
  );
}

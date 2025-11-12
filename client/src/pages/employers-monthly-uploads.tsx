import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, FileText, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useLocation } from "wouter";
import { format } from "date-fns";

interface WizardType {
  name: string;
  displayName: string;
  description?: string;
  isMonthly?: boolean;
}

interface MonthlyWizard {
  id: string;
  type: string;
  entityId: string;
  status: string;
  currentStep: string;
  data: any;
  createdAt: string;
  updatedAt: string;
  employerId: string;
  year: number;
  month: number;
}

interface Employer {
  id: string;
  name: string;
}

function generateMonthList(count: number = 12) {
  const months = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      label: format(date, "MMMM yyyy"),
      value: `${date.getFullYear()}-${date.getMonth() + 1}`
    });
  }
  
  return months;
}

export default function EmployersMonthlyUploads() {
  const [, setLocation] = useLocation();
  const [selectedWizardType, setSelectedWizardType] = useState<string>("all");
  const [openMonths, setOpenMonths] = useState<string[]>([]);
  const monthList = generateMonthList(12);

  // Fetch all wizard types
  const { data: wizardTypes = [] } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  // Fetch all employers for name lookup
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  // Filter to only monthly wizard types
  const monthlyWizardTypes = wizardTypes.filter(wt => wt.isMonthly === true);

  // Create employer lookup map
  const employerMap = new Map(employers.map(e => [e.id, e.name]));

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">
          Monthly Uploads
        </h1>
        <p className="text-muted-foreground" data-testid="text-page-description">
          View and manage employer monthly wizard uploads
        </p>
      </div>

      {/* Wizard Type Filter */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filter by Wizard Type</CardTitle>
          <CardDescription>Select a specific wizard type or view all monthly uploads</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedWizardType} onValueChange={setSelectedWizardType}>
            <SelectTrigger className="w-full max-w-md" data-testid="select-wizard-type">
              <SelectValue placeholder="Select wizard type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="select-option-all">All Monthly Wizards</SelectItem>
              {monthlyWizardTypes.map((wizardType) => (
                <SelectItem 
                  key={wizardType.name} 
                  value={wizardType.name}
                  data-testid={`select-option-${wizardType.name}`}
                >
                  {wizardType.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Monthly Upload Accordion */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            Uploads by Month
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion 
            type="multiple" 
            className="w-full"
            value={openMonths}
            onValueChange={setOpenMonths}
          >
            {monthList.map((month) => (
              <MonthAccordion
                key={month.value}
                year={month.year}
                month={month.month}
                label={month.label}
                value={month.value}
                isOpen={openMonths.includes(month.value)}
                selectedWizardType={selectedWizardType}
                wizardTypes={wizardTypes}
                employerMap={employerMap}
                onNavigate={setLocation}
              />
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

interface MonthAccordionProps {
  year: number;
  month: number;
  label: string;
  value: string;
  isOpen: boolean;
  selectedWizardType: string;
  wizardTypes: WizardType[];
  employerMap: Map<string, string>;
  onNavigate: (path: string) => void;
}

function MonthAccordion({ 
  year, 
  month, 
  label, 
  value,
  isOpen,
  selectedWizardType, 
  wizardTypes,
  employerMap,
  onNavigate 
}: MonthAccordionProps) {
  // Fetch data for this month only when accordion is opened (lazy loading)
  const { data: wizards = [], isLoading } = useQuery<MonthlyWizard[]>({
    queryKey: ["/api/wizards/employer-monthly/by-period", { year, month }],
    enabled: isOpen,
  });

  // Filter wizards by selected type if not "all"
  const filteredWizards = selectedWizardType === "all" 
    ? wizards 
    : wizards.filter(w => w.type === selectedWizardType);

  return (
    <AccordionItem value={value} data-testid={`accordion-month-${year}-${month}`}>
      <AccordionTrigger className="hover:no-underline" data-testid={`button-expand-${year}-${month}`}>
        <div className="flex items-center justify-between w-full pr-4">
          <span className="font-medium">{label}</span>
          <span className="text-sm text-muted-foreground" data-testid={`text-count-${year}-${month}`}>
            {filteredWizards.length} {filteredWizards.length === 1 ? "upload" : "uploads"}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground" data-testid={`text-loading-${year}-${month}`}>
            Loading uploads...
          </div>
        ) : filteredWizards.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid={`text-empty-${year}-${month}`}>
            <Upload className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No uploads for this month</p>
          </div>
        ) : (
          <div className="space-y-2 mt-2">
            {filteredWizards.map((wizard) => {
              const wizardType = wizardTypes.find(wt => wt.name === wizard.type);
              const employerName = employerMap.get(wizard.employerId);
              
              return (
                <div
                  key={wizard.id}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => onNavigate(`/wizards/${wizard.id}`)}
                  data-testid={`wizard-item-${wizard.id}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 
                        className="font-medium text-foreground hover:underline cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate(`/employers/${wizard.employerId}`);
                        }}
                        data-testid={`text-employer-name-${wizard.id}`}
                      >
                        {employerName || wizard.employerId}
                      </h4>
                      <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                        {wizard.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-sm text-muted-foreground" data-testid={`text-type-${wizard.id}`}>
                        {wizardType?.displayName || wizard.type}
                      </p>
                      <span className="text-muted-foreground">•</span>
                      <p className="text-sm text-muted-foreground" data-testid={`text-created-${wizard.id}`}>
                        Created: {format(new Date(wizard.createdAt), 'PPp')}
                      </p>
                      {wizard.currentStep && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <p className="text-sm text-muted-foreground" data-testid={`text-step-${wizard.id}`}>
                            Step: {wizard.currentStep}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

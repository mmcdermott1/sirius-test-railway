import { useState } from "react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scan, Loader2, Calendar } from "lucide-react";

function WorkerBenefitsScanContent() {
  const { worker, contact } = useWorkerLayout();
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState<string>(currentDate.getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState<string>((currentDate.getMonth() + 1).toString());
  const [isScanning, setIsScanning] = useState(false);

  const years = Array.from({ length: 10 }, (_, i) => currentDate.getFullYear() - i);
  const months = [
    { value: "1", label: "January" },
    { value: "2", label: "February" },
    { value: "3", label: "March" },
    { value: "4", label: "April" },
    { value: "5", label: "May" },
    { value: "6", label: "June" },
    { value: "7", label: "July" },
    { value: "8", label: "August" },
    { value: "9", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

  const handleRunScan = async () => {
    setIsScanning(true);
    // TODO: Implement scan functionality
    setTimeout(() => {
      setIsScanning(false);
    }, 1000);
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground" data-testid="heading-benefits-scan">
          Benefits Eligibility Scan
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Run an eligibility scan for {contact?.displayName || "this worker"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Scan Configuration
          </CardTitle>
          <CardDescription>
            Select the year and month for the eligibility scan
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="year-select">Year</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger id="year-select" data-testid="select-scan-year">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="month-select">Month</Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger id="month-select" data-testid="select-scan-month">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <Button
              onClick={handleRunScan}
              disabled={isScanning}
              data-testid="button-run-scan"
            >
              {isScanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Scan className="mr-2 h-4 w-4" />
              )}
              Run Eligibility Scan
            </Button>
          </div>

          <div className="p-4 bg-muted/50 rounded-md">
            <p className="text-sm text-muted-foreground">
              Scan functionality will be implemented. This will evaluate eligibility rules for the selected period.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkerBenefitsScan() {
  return (
    <WorkerLayout activeTab="benefits-scan">
      <WorkerBenefitsScanContent />
    </WorkerLayout>
  );
}

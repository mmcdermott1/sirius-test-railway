import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "lucide-react";

interface InputsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
}

export function InputsStep({ wizardId, wizardType, data }: InputsStepProps) {
  const wizardDisplayName = wizardType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Report Configuration</CardTitle>
        <CardDescription>
          Configure parameters for {wizardDisplayName}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Ready to Generate Report
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-200">
              This report will analyze all workers in the system. Click "Next" to proceed to the run step.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

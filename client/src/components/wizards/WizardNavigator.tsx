import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";

interface WizardNavigatorProps {
  currentStep: string;
  steps: Array<{ id: string; name: string }>;
  onNext: () => void;
  onPrevious: () => void;
  isLoading?: boolean;
  canProceed?: boolean;
}

export function WizardNavigator({
  currentStep,
  steps,
  onNext,
  onPrevious,
  isLoading = false,
  canProceed = true,
}: WizardNavigatorProps) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === steps.length - 1;
  const nextDisabled = isLastStep || isLoading || !canProceed;

  return (
    <div className="space-y-4">
      {!canProceed && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please complete all required items in this step before proceeding to the next step.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex items-center justify-between gap-4 pt-6 border-t border-border">
        <Button
          variant="outline"
          onClick={onPrevious}
          disabled={isFirstStep || isLoading}
          data-testid="button-previous-step"
        >
          <ChevronLeft size={16} className="mr-2" />
          Previous
        </Button>

        <div className="text-sm text-muted-foreground">
          Step {currentIndex + 1} of {steps.length}
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  onClick={onNext}
                  disabled={nextDisabled}
                  data-testid="button-next-step"
                >
                  Next
                  <ChevronRight size={16} className="ml-2" />
                </Button>
              </span>
            </TooltipTrigger>
            {!canProceed && !isLastStep && !isLoading && (
              <TooltipContent>
                <p>Complete this step to proceed</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

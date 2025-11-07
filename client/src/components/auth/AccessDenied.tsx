import { AlertCircle, CheckCircle, XCircle, Shield } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface RequirementEvaluation {
  type: string;
  description: string;
  status: 'passed' | 'failed' | 'skipped';
  reason?: string;
  details?: any;
}

interface DetailedPolicyResult {
  policy: {
    name: string;
    description?: string;
  };
  allowed: boolean;
  evaluatedAt: string;
  adminBypass: boolean;
  requirements: RequirementEvaluation[];
}

interface AccessDeniedProps {
  policyResult: DetailedPolicyResult;
}

export default function AccessDenied({ policyResult }: AccessDeniedProps) {
  const failedRequirements = policyResult.requirements.filter(r => r.status === 'failed');

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Access Denied</CardTitle>
              <CardDescription>
                You don't have the required access to view this page
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Policy Check Failed: {policyResult.policy.name}</AlertTitle>
            <AlertDescription>
              {policyResult.policy.description || 'Access requirements not met'}
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Requirements ({policyResult.requirements.length})
            </h3>
            
            {policyResult.requirements.map((req, index) => (
              <div
                key={index}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  req.status === 'passed'
                    ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
                    : req.status === 'failed'
                    ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}
                data-testid={`requirement-${index}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {req.status === 'passed' ? (
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  ) : req.status === 'failed' ? (
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {req.description}
                  </p>
                  {req.reason && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {req.reason}
                    </p>
                  )}
                  {req.status === 'skipped' && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 italic">
                      Skipped (admin bypass active)
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {failedRequirements.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>What can I do?</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>To access this page, you need:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  {failedRequirements.map((req, index) => (
                    <li key={index} className="text-sm">
                      {req.type === 'component' && req.details?.componentId ? (
                        <>The <span className="font-mono">{req.details.componentId}</span> component to be enabled</>
                      ) : req.type === 'permission' && req.details?.permissionKey ? (
                        <>The <span className="font-mono">{req.details.permissionKey}</span> permission</>
                      ) : (
                        req.description
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm">
                  Please contact your administrator if you believe you should have access to this page.
                </p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

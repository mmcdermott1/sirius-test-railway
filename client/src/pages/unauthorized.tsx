import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="max-w-md w-full" data-testid="card-unauthorized">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto bg-destructive/10 w-16 h-16 rounded-full flex items-center justify-center">
            <ShieldAlert className="h-8 w-8 text-destructive" data-testid="icon-shield-alert" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-unauthorized-title">
            Access Denied
          </CardTitle>
          <CardDescription className="text-base" data-testid="text-unauthorized-description">
            You don't have permission to access this application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground" data-testid="text-contact-admin">
            Your Replit account is not registered in this system. Please contact an administrator to request access.
          </p>
          <div className="pt-4">
            <Button 
              variant="outline" 
              onClick={() => window.location.href = 'https://replit.com'}
              data-testid="button-back-to-replit"
            >
              Back to Replit
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

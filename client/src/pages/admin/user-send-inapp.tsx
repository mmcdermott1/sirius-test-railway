import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommInApp } from "@/components/comm/CommInApp";
import { Bell, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function UserSendInAppContent() {
  const { contact } = useUserLayout();

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Send In-App Message
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Contact Record</AlertTitle>
            <AlertDescription>
              No contact record found for this user. Sending in-app messages requires a contact record.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return <CommInApp contactId={contact.id} />;
}

export default function UserSendInApp() {
  return (
    <UserLayout activeTab="send-inapp">
      <UserSendInAppContent />
    </UserLayout>
  );
}

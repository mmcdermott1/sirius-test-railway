import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail, User, Shield } from "lucide-react";

interface TrustProviderContactResponse {
  id: string;
  providerId: string;
  contactId: string;
  contactTypeId: string | null;
  contact: {
    id: string;
    title: string | null;
    given: string | null;
    middle: string | null;
    family: string | null;
    generational: string | null;
    credentials: string | null;
    displayName: string;
    email: string | null;
    birthDate: string | null;
    gender: string | null;
    genderNota: string | null;
    genderCalc: string | null;
  };
  contactType?: {
    id: string;
    name: string;
    description: string | null;
  } | null;
}

interface TrustProvider {
  id: string;
  name: string;
  data: any;
}

export default function TrustProviderContactView() {
  const { id } = useParams<{ id: string }>();

  const { data: contact, isLoading, error } = useQuery<TrustProviderContactResponse>({
    queryKey: ["/api/trust-provider-contacts", id],
  });

  const { data: provider } = useQuery<TrustProvider>({
    queryKey: ["/api/trust/provider", contact?.providerId],
    enabled: !!contact?.providerId,
  });

  if (isLoading) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Skeleton className="h-10 w-64" />
          </div>
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-48" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-5/6" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-muted-foreground">
                Provider contact not found or you don't have permission to view it.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={provider ? `/trust/provider/${provider.id}/contacts` : "/trust/providers"}>
              <Button variant="ghost" size="sm" data-testid="button-back">
                <ArrowLeft size={16} className="mr-2" />
                Back to {provider ? provider.name : "Providers"}
              </Button>
            </Link>
            <h1 className="text-3xl font-bold" data-testid="text-contact-name">
              {contact.contact.displayName}
            </h1>
            {contact.contactType && (
              <Badge variant="secondary" data-testid="badge-contact-type">
                {contact.contactType.name}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User size={20} />
                Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Display Name</label>
                <p className="text-base" data-testid="text-display-name">{contact.contact.displayName}</p>
              </div>

              {contact.contact.email && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Mail size={14} />
                    Email
                  </label>
                  <p className="text-base" data-testid="text-email">
                    <a href={`mailto:${contact.contact.email}`} className="text-primary hover:underline">
                      {contact.contact.email}
                    </a>
                  </p>
                </div>
              )}

              {contact.contactType && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Contact Type</label>
                  <p className="text-base" data-testid="text-contact-type">{contact.contactType.name}</p>
                  {contact.contactType.description && (
                    <p className="text-sm text-muted-foreground">{contact.contactType.description}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Name Components */}
          <Card>
            <CardHeader>
              <CardTitle>Name Components</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {contact.contact.title && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Title</label>
                  <p className="text-base" data-testid="text-title">{contact.contact.title}</p>
                </div>
              )}

              {contact.contact.given && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Given Name</label>
                  <p className="text-base" data-testid="text-given">{contact.contact.given}</p>
                </div>
              )}

              {contact.contact.middle && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Middle Name</label>
                  <p className="text-base" data-testid="text-middle">{contact.contact.middle}</p>
                </div>
              )}

              {contact.contact.family && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Family Name</label>
                  <p className="text-base" data-testid="text-family">{contact.contact.family}</p>
                </div>
              )}

              {contact.contact.generational && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Generational Suffix</label>
                  <p className="text-base" data-testid="text-generational">{contact.contact.generational}</p>
                </div>
              )}

              {contact.contact.credentials && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Credentials</label>
                  <p className="text-base" data-testid="text-credentials">{contact.contact.credentials}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Provider Information */}
          {provider && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield size={20} />
                  Trust Provider
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Provider Name</label>
                  <p className="text-base">
                    <Link href={`/trust/provider/${provider.id}`}>
                      <span className="text-primary hover:underline cursor-pointer" data-testid="link-provider-name">
                        {provider.name}
                      </span>
                    </Link>
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

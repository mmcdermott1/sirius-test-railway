import { useQuery } from "@tanstack/react-query";
import { Esig } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, FileSignature, Calendar, Hash, Shield } from "lucide-react";
import { format } from "date-fns";

interface EsigViewProps {
  esigId: string;
}

interface EsigData {
  type: "canvas" | "typed";
  data: string;
  typedName?: string;
}

export function EsigView({ esigId }: EsigViewProps) {
  const { data: esig, isLoading, error } = useQuery<Esig>({
    queryKey: ["/api/esigs", esigId],
    enabled: !!esigId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !esig) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Failed to load signature record.</p>
        </CardContent>
      </Card>
    );
  }

  const esigData = esig.esig as EsigData | null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5" />
            Signed Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          {esig.docRender ? (
            <div 
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: esig.docRender }}
              data-testid="text-signed-document"
            />
          ) : (
            <p className="text-muted-foreground">No document content available.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Signature Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                Signed Date
              </label>
              <p className="text-foreground" data-testid="text-esig-signed-date">
                {esig.signedDate 
                  ? format(new Date(esig.signedDate), "MMMM d, yyyy 'at' h:mm a") 
                  : "Unknown"}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Hash className="h-4 w-4" />
                Document Hash
              </label>
              <p className="text-foreground font-mono text-xs break-all" data-testid="text-esig-hash">
                {esig.docHash || "No hash available"}
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Signature</label>
            <SignatureDisplay esigData={esigData} />
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {esig.type || "online"}
            </Badge>
            {esig.docType && (
              <Badge variant="secondary" className="text-xs">
                {esig.docType}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface SignatureDisplayProps {
  esigData: EsigData | null;
}

function SignatureDisplay({ esigData }: SignatureDisplayProps) {
  if (!esigData) {
    return (
      <div className="p-4 border rounded-md bg-muted/50">
        <p className="text-muted-foreground text-sm">No signature data available.</p>
      </div>
    );
  }

  if (esigData.type === "canvas" && esigData.data) {
    return (
      <div className="border rounded-md p-4 bg-white dark:bg-zinc-900" data-testid="display-signature-canvas">
        <img 
          src={esigData.data} 
          alt="Signature" 
          className="max-h-32 object-contain"
        />
      </div>
    );
  }

  if (esigData.type === "typed" && esigData.typedName) {
    return (
      <div className="border rounded-md p-4 bg-white dark:bg-zinc-900" data-testid="display-signature-typed">
        <p 
          className="text-2xl italic text-foreground"
          style={{ fontFamily: "'Dancing Script', cursive, serif" }}
        >
          {esigData.typedName}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 border rounded-md bg-muted/50">
      <p className="text-muted-foreground text-sm">Signature format not recognized.</p>
    </div>
  );
}

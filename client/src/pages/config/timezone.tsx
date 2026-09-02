import { useEffect, useState } from "react";
import { Clock, Loader2, Save } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNow } from "@/hooks/use-now";
import { getBrowserTimeZone } from "@/lib/display-timezone";
import { queryClient } from "@/lib/queryClient";
import {
  parseVariableJson,
  useSetVariable,
  useVariableValue,
} from "@/lib/use-variable";
import { ZoneClock } from "@/components/timezone/ZoneClock";
import { SiteTimeZoneCard } from "@/components/timezone/SiteTimeZoneCard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_TIMEZONE_POLICY,
  TIMEZONE_POLICY_VARIABLE_NAME,
  parseTimeZonePolicy,
} from "@shared/utils/timezone";

/**
 * One place to see what time this site thinks it is, and what that costs.
 *
 * The two clocks are the point of the screen, not decoration: "the site runs
 * in America/New_York" means nothing until it is next to a clock reading four
 * hours away from the reader's own. Everything else here — the site zone and
 * its warning, the personal-zone policy — is downstream of understanding that
 * difference.
 */
export default function TimeZoneConfigPage() {
  usePageTitle("Time Zone");
  const { toast } = useToast();
  const { timezone, displayTimeZone } = useAuth();
  const now = useNow(1000);

  const browserTimeZone = getBrowserTimeZone();

  const { data: policyValue, isLoading: policyLoading } = useVariableValue(
    TIMEZONE_POLICY_VARIABLE_NAME,
  );
  const storedPolicy = parseTimeZonePolicy(parseVariableJson(policyValue));
  /** Whether the row exists at all — an absent row means the default applies. */
  const policyConfigured = policyValue !== null && policyValue !== undefined;

  const [allowUserTimezones, setAllowUserTimezones] = useState(
    DEFAULT_TIMEZONE_POLICY.allowUserTimezones,
  );

  useEffect(() => {
    setAllowUserTimezones(storedPolicy.allowUserTimezones);
  }, [storedPolicy.allowUserTimezones]);

  const saveMutation = useSetVariable(TIMEZONE_POLICY_VARIABLE_NAME, {
    onSuccess: () => {
      // The policy is part of what every client resolves its display zone
      // from, so this page's own dates (and its clocks) have to be told.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Time zone settings saved" });
    },
    onError: (error) =>
      toast({
        title: "Could not save time zone settings",
        description: error.message,
        variant: "destructive",
      }),
  });

  const hasChanges = allowUserTimezones !== storedPolicy.allowUserTimezones;

  // The site's clock and the reader's clock are both always shown, even when
  // they are the same zone: "are these the same?" is the question this screen
  // is opened with, and two cards reading the same time answer it, where a
  // single card leaves the reader to take it on faith. A third appears only
  // when a personal choice put the display somewhere neither of them is.
  const chosenZoneDiffers =
    displayTimeZone !== timezone.systemTimeZone &&
    displayTimeZone !== browserTimeZone;
  const clocks = [
    {
      title: "Site time zone",
      zone: timezone.systemTimeZone,
      description:
        "What every stored date and time means, when scheduled work fires, and where the day ends.",
      testId: "clock-site",
    },
    {
      title: "Your time zone",
      zone: browserTimeZone,
      description: "Where this browser says it is.",
      testId: "clock-browser",
    },
    ...(chosenZoneDiffers
      ? [
          {
            title: "Your chosen time zone",
            zone: displayTimeZone,
            description: "The zone you picked for yourself.",
            testId: "clock-display",
          },
        ]
      : []),
  ];
  // Only the first match is badged — when the site's zone and this browser's
  // zone coincide, badging both would read as two different answers.
  const showingIndex = clocks.findIndex((c) => c.zone === displayTimeZone);
  const zonesAgree =
    timezone.systemTimeZone === browserTimeZone && !chosenZoneDiffers;

  if (policyLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl md:text-2xl font-bold text-foreground"
          data-testid="heading-timezone"
        >
          Time Zone
        </h1>
        <p className="text-muted-foreground mt-2">
          What time this site keeps, and who is allowed to read it differently.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Right now
          </CardTitle>
          <CardDescription>
            The same instant, in each zone that matters here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {clocks.map((clock, index) => (
              <ZoneClock
                key={clock.testId}
                title={clock.title}
                zone={clock.zone}
                at={now}
                showing={index === showingIndex}
                description={clock.description}
                testId={clock.testId}
              />
            ))}
          </div>
          {zonesAgree && (
            <p
              className="text-sm text-muted-foreground mt-4"
              data-testid="text-zones-identical"
            >
              This browser is in the site's own time zone, so the two clocks
              agree and there is nothing to reconcile.
            </p>
          )}
        </CardContent>
      </Card>

      <SiteTimeZoneCard systemTimeZone={timezone.systemTimeZone} />

      <Card>
        <CardHeader>
          <CardTitle>Personal time zones</CardTitle>
          <CardDescription>
            Whether people may read the site in a zone of their own choosing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="allow-user-timezones">
                Let people choose their own time zone
              </Label>
              <p className="text-sm text-muted-foreground max-w-prose">
                On, someone in another state can read every date in their own
                zone; a person who has not chosen one sees their browser's.
                Off, everyone reads the site's zone — including anyone who
                already picked one, whose choice stops being honoured rather
                than merely becoming un-editable.
              </p>
              {!policyConfigured && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="text-policy-unset"
                >
                  Not configured yet — currently the default, which is off, so
                  everyone here reads the site's time zone.
                </p>
              )}
            </div>
            <Switch
              id="allow-user-timezones"
              checked={allowUserTimezones}
              onCheckedChange={setAllowUserTimezones}
              data-testid="switch-allow-user-timezones"
            />
          </div>

          <div className="flex items-center gap-4 pt-4 border-t border-border flex-wrap">
            <Button
              onClick={() => saveMutation.mutate({ allowUserTimezones })}
              disabled={!hasChanges || saveMutation.isPending}
              data-testid="button-save-timezone-settings"
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Changes
            </Button>
            {hasChanges && (
              <span className="text-sm text-muted-foreground">
                Unsaved changes
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

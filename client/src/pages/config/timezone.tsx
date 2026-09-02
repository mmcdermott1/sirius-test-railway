import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, ExternalLink, Loader2, Power, Save } from "lucide-react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

/** The environment variable that holds the site's zone. */
const SITE_TIMEZONE_VARIABLE = "TZ";

interface PendingRestartVariable {
  name: string;
  description: string;
  category: string;
  secret: boolean;
  change: string;
}

interface RestartInfo {
  pendingRestartVariables?: PendingRestartVariable[];
  pendingRestartKnown?: boolean;
}

/**
 * One place to see what time this site thinks it is, and what that costs.
 *
 * The two clocks are the point of the screen, not decoration: "the site runs
 * in America/New_York" means nothing until it is next to a clock reading four
 * hours away from the reader's own. Everything else here — the warning, the
 * link to where the value is actually edited, the personal-zone policy — is
 * downstream of understanding that difference.
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

  // Whether the site zone has been changed but not yet picked up. TZ is read
  // once while the process starts, so a saved change sits inert until then and
  // this page would otherwise show a site clock that disagrees with the value
  // an admin just saved.
  const { data: restartInfo } = useQuery<RestartInfo>({
    queryKey: ["/api/admin/restart/info"],
    retry: false,
    staleTime: 30 * 1000,
  });
  const pendingSiteZone = restartInfo?.pendingRestartVariables?.find(
    (v) => v.name === SITE_TIMEZONE_VARIABLE,
  );
  // A process that never recorded a baseline cannot answer the question at
  // all. Silence would read as "nothing is pending", which is the one thing it
  // does not know — say so instead. Nothing is claimed while the query is
  // still in flight or was refused.
  const pendingUnknown = restartInfo?.pendingRestartKnown === false;

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

      <Card>
        <CardHeader>
          <CardTitle>The site's time zone</CardTitle>
          <CardDescription>
            Currently{" "}
            <code className="font-mono" data-testid="text-site-timezone">
              {timezone.systemTimeZone}
            </code>
            , from the{" "}
            <code className="font-mono">{SITE_TIMEZONE_VARIABLE}</code>{" "}
            environment variable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Said here, where the change is made, because the consequence is
              not reversible by simply changing it back: the same stored rows
              will have been read and acted on in the meantime. */}
          <Alert variant="destructive" data-testid="alert-timezone-consequences">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Changing this re-interprets history</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Dates and times are stored as a wall-clock reading with no zone
                attached, so they mean whatever zone the site is set to. Move
                the site's zone and every date already stored moves with it: a
                shift recorded at 8:00 AM still reads 8:00 AM, but it is now a
                different moment. Nothing is converted, and there is no record
                of the old reading.
              </p>
              <p>
                The new value is read only while the app is starting, so it
                takes effect on the next restart — not when it is saved.
              </p>
            </AlertDescription>
          </Alert>

          {pendingSiteZone && (
            <Alert data-testid="alert-timezone-pending-restart">
              <Power className="h-4 w-4" />
              <AlertTitle>A new site time zone is waiting on a restart</AlertTitle>
              <AlertDescription>
                <code className="font-mono">{SITE_TIMEZONE_VARIABLE}</code> was{" "}
                {pendingSiteZone.change} since this app started, so the clock
                above is still the old zone. Restart to apply it.
                <div className="mt-2">
                  <Link href="/admin/restart">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="link-timezone-restart"
                    >
                      Restart &amp; Reload
                      <ExternalLink className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {pendingUnknown && (
            <Alert data-testid="alert-timezone-pending-unknown">
              <Power className="h-4 w-4" />
              <AlertTitle>
                Whether a new time zone is waiting cannot be determined
              </AlertTitle>
              <AlertDescription>
                This process did not reach the point where it records a
                baseline, so it cannot tell whether{" "}
                <code className="font-mono">{SITE_TIMEZONE_VARIABLE}</code> has
                been edited since it started. If it has, the site clock above
                is still the old zone.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <p className="text-sm text-muted-foreground mb-2">
              The value lives with the other environment variables — this page
              does not keep a second copy of it.
            </p>
            <Link href="/config/env">
              <Button variant="outline" data-testid="link-timezone-env">
                Edit {SITE_TIMEZONE_VARIABLE} on Environment Variables
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

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

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Loader2, Plus, Eye, Calendar,
  Users, MapPin, Video, Presentation, Mic, Ticket, Star, Heart, Clock,
  type LucideIcon
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import type { Event, EventType } from "@shared/schema";

const iconMap: Record<string, LucideIcon> = {
  Calendar, Users, MapPin, Video, Presentation, Mic, Ticket, Star, Heart, Clock,
};

export default function EventsListPage() {
  const { data: events = [], isLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"],
  });

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/event-types"],
  });

  const getEventTypeName = (eventTypeId: string | null) => {
    if (!eventTypeId) return "-";
    const type = eventTypes.find((t) => t.id === eventTypeId);
    return type?.name || "-";
  };

  const getEventTypeIcon = (eventTypeId: string | null) => {
    if (!eventTypeId) return Calendar;
    const type = eventTypes.find((t) => t.id === eventTypeId);
    const data = type?.data as { icon?: string } | null;
    const iconName = data?.icon || "Calendar";
    return iconMap[iconName] || Calendar;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle data-testid="title-page">Events</CardTitle>
              <CardDescription>
                Manage events and their occurrences
              </CardDescription>
            </div>
            <Link href="/events/new">
              <Button data-testid="button-add-event">
                <Plus className="h-4 w-4 mr-2" />
                Add Event
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-state">
              No events yet. Click "Add Event" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const IconComponent = getEventTypeIcon(event.eventTypeId);
                  return (
                    <TableRow key={event.id} data-testid={`row-event-${event.id}`}>
                      <TableCell data-testid={`icon-event-${event.id}`}>
                        <div className="flex items-center gap-2">
                          <IconComponent size={18} className="text-muted-foreground" />
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-title-${event.id}`}>
                        <div className="font-medium">{event.title}</div>
                        <div className="text-sm text-muted-foreground">
                          {getEventTypeName(event.eventTypeId)}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-description-${event.id}`}>
                        {event.description ? (
                          <span className="line-clamp-2">{event.description}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-created-${event.id}`}>
                        {format(new Date(event.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/events/${event.id}`}>
                          <Button
                            data-testid={`button-view-${event.id}`}
                            size="sm"
                            variant="outline"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

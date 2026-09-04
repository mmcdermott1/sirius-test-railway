import { GrievanceLayout, useGrievanceLayout } from "@/components/layouts/GrievanceLayout";
import EntityNotesPanel from "@/components/entity-notes/EntityNotesPanel";

function GrievanceNotesContent() {
  const { grievance } = useGrievanceLayout();
  return <EntityNotesPanel entityType="grievance" entityId={grievance.id} />;
}

export default function GrievanceNotes() {
  return (
    <GrievanceLayout activeTab="notes">
      <GrievanceNotesContent />
    </GrievanceLayout>
  );
}

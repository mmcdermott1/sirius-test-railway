import { db } from "../server/db";
import { 
  contacts, 
  phoneNumbers, 
  employers, 
  workers, 
  workerHours,
  optionsGender,
  optionsEmployerType,
  optionsEmploymentStatus,
  optionsWorkerWs,
  optionsDispatchJobType,
  workerDispatchStatus,
  dispatchJobs,
  dispatches,
} from "../shared/schema";
import * as fs from "fs";
import * as path from "path";

interface DemoSnapshot {
  version: string;
  createdAt: string;
  tables: {
    optionsGender: any[];
    optionsEmployerType: any[];
    optionsEmploymentStatus: any[];
    optionsWorkerWs: any[];
    optionsDispatchJobType: any[];
    contacts: any[];
    phoneNumbers: any[];
    employers: any[];
    workers: any[];
    workerHours: any[];
    workerDispatchStatus: any[];
    dispatchJobs: any[];
    dispatches: any[];
  };
}

async function createSnapshot(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("ERROR: Cannot create snapshot in production environment");
    process.exit(1);
  }

  console.log("Creating demo data snapshot...\n");

  const snapshot: DemoSnapshot = {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    tables: {
      optionsGender: [],
      optionsEmployerType: [],
      optionsEmploymentStatus: [],
      optionsWorkerWs: [],
      optionsDispatchJobType: [],
      contacts: [],
      phoneNumbers: [],
      employers: [],
      workers: [],
      workerHours: [],
      workerDispatchStatus: [],
      dispatchJobs: [],
      dispatches: [],
    },
  };

  try {
    console.log("Fetching options tables...");
    snapshot.tables.optionsGender = await db.select().from(optionsGender);
    snapshot.tables.optionsEmployerType = await db.select().from(optionsEmployerType);
    snapshot.tables.optionsEmploymentStatus = await db.select().from(optionsEmploymentStatus);
    snapshot.tables.optionsWorkerWs = await db.select().from(optionsWorkerWs);
    snapshot.tables.optionsDispatchJobType = await db.select().from(optionsDispatchJobType);

    console.log("Fetching entity tables...");
    snapshot.tables.contacts = await db.select().from(contacts);
    snapshot.tables.phoneNumbers = await db.select().from(phoneNumbers);
    snapshot.tables.employers = await db.select().from(employers);
    snapshot.tables.workers = await db.select().from(workers);

    console.log("Fetching relationship tables...");
    snapshot.tables.workerHours = await db.select().from(workerHours);
    snapshot.tables.workerDispatchStatus = await db.select().from(workerDispatchStatus);

    console.log("Fetching dispatch tables...");
    snapshot.tables.dispatchJobs = await db.select().from(dispatchJobs);
    snapshot.tables.dispatches = await db.select().from(dispatches);

    const outputPath = path.join(process.cwd(), "data", "demo-snapshot.json");
    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));

    console.log("\n--- Snapshot Summary ---");
    console.log(`Version: ${snapshot.version}`);
    console.log(`Created: ${snapshot.createdAt}`);
    console.log("\nRecord counts:");
    for (const [table, records] of Object.entries(snapshot.tables)) {
      console.log(`  ${table}: ${(records as any[]).length} records`);
    }
    console.log(`\nSnapshot saved to: ${outputPath}`);

  } catch (error) {
    console.error("Failed to create snapshot:", error);
    process.exit(1);
  }

  process.exit(0);
}

createSnapshot();

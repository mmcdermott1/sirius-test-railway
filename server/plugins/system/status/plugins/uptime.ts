import { registerSystemStatusPlugin } from "../registry";

/** Boot time captured once at module load (process start, minus uptime). */
const bootedAt = new Date(Date.now() - process.uptime() * 1000);

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

registerSystemStatusPlugin({
  id: "uptime",
  name: "Uptime",
  description: "When this server process started.",
  // The boot time never changes for the life of the process, so there is
  // nothing to re-scan.
  canRescan: false,
  async scan() {
    return [
      {
        priority: "info",
        title: `Up ${formatDuration(Date.now() - bootedAt.getTime())}`,
        details: `Server process started at ${bootedAt.toISOString()}.`,
      },
    ];
  },
});

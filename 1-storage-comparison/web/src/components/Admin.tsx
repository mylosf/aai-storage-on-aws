import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useJob } from "@/useJob";

interface SyncResult {
  output?: string[];
}

export function Admin({ onSynced }: { onSynced: () => void }) {
  const [dropping, setDropping] = useState(false);
  const { job, busy, error, run, clearError } = useJob<SyncResult>();

  useEffect(() => {
    if (error) {
      toast.error(`Sync: ${error}`);
      clearError();
    }
  }, [error, clearError]);

  useEffect(() => {
    if (job?.status === "done") {
      const lines = job.result?.output ?? [];
      toast.success("Content synced to all mounted backends", {
        description: lines.length ? (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{lines.join("\n")}</pre>
        ) : undefined,
        duration: 12000,
      });
      onSynced();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  useEffect(() => {
    if (busy && job?.progress?.message) toast.loading(job.progress.message, { id: "sync" });
    if (!busy) toast.dismiss("sync");
  }, [busy, job?.progress?.message]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          Admin
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Origin instance</DropdownMenuLabel>
        <DropdownMenuItem disabled={busy} onSelect={() => void run(() => api.sync())}>
          {busy ? "Syncing…" : "Sync content to backends"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={dropping}
          onSelect={async () => {
            setDropping(true);
            try {
              const r = await api.dropCaches();
              if (r.dropped) toast.success("Page cache dropped");
              else toast.warning("Could not drop caches (not root?)");
            } catch (err) {
              toast.error(`Drop caches: ${(err as Error).message}`);
            } finally {
              setDropping(false);
            }
          }}
        >
          Drop page cache
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSynced}>Refresh status</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

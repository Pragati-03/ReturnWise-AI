import { useMemo, useState } from "react";

import {
  AUDIT_ACTOR_LABELS,
  AUDIT_EVENT_LABELS,
  AuditTimeline,
} from "@/components/audit/AuditTimeline";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/shared/FilterBar";
import { Pagination, paginate } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/StateViews";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useDemoStore } from "@/lib/demoStore";

const PAGE_SIZE = 10;

const EVENT_OPTIONS = Object.entries(AUDIT_EVENT_LABELS).map(([value, label]) => ({ value, label }));
const ACTOR_OPTIONS = Object.entries(AUDIT_ACTOR_LABELS).map(([value, label]) => ({ value, label }));

export function AuditPage() {
  const { auditLog, returns } = useDemoStore();

  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const [actorType, setActorType] = useState("");
  const [page, setPage] = useState(1);

  const getReturnReference = (id: string) => returns.find((item) => item.id === id)?.reference;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return auditLog
      .filter((entry) => {
        if (eventType && entry.eventType !== eventType) return false;
        if (actorType && entry.actorType !== actorType) return false;
        if (!query) return true;
        const reference = entry.returnId
          ? (returns.find((item) => item.id === entry.returnId)?.reference ?? "")
          : "";
        return [entry.description, entry.actorName, reference, AUDIT_EVENT_LABELS[entry.eventType]]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      // Newest first, so pagination slices the right entries.
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  }, [auditLog, returns, search, eventType, actorType]);

  const pageEntries = paginate(filtered, page, PAGE_SIZE);

  function clearFilters() {
    setSearch("");
    setEventType("");
    setActorType("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="A record of who did what, and when. Entries contain no secrets or payment details."
      />

      <Card flush>
        <div className="border-b border-slate-200 p-4">
          <FilterBar
            searchValue={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            searchLabel="Search audit log"
            searchPlaceholder="Search description, actor or return"
            filters={[
              {
                id: "event",
                label: "Filter by event type",
                value: eventType,
                allLabel: "All events",
                options: EVENT_OPTIONS,
                onChange: (value) => {
                  setEventType(value);
                  setPage(1);
                },
              },
              {
                id: "actor",
                label: "Filter by actor",
                value: actorType,
                allLabel: "All actors",
                options: ACTOR_OPTIONS,
                onChange: (value) => {
                  setActorType(value);
                  setPage(1);
                },
              },
            ]}
            onClear={clearFilters}
            resultLabel={`${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={auditLog.length === 0 ? "No audit entries yet" : "No matching entries"}
            description={
              auditLog.length === 0
                ? "Actions on returns and policy changes will be recorded here."
                : "Try a different search or clear the filters."
            }
            action={
              auditLog.length === 0 ? undefined : (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div className="px-4 py-2">
            <AuditTimeline entries={pageEntries} getReturnReference={getReturnReference} />
          </div>
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={filtered.length}
          onPageChange={setPage}
          itemLabel="entries"
        />
      </Card>
    </div>
  );
}
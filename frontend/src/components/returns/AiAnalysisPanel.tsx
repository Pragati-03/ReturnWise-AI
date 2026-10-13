import { Sparkles } from "lucide-react";

import { EmptyState } from "@/components/shared/StateViews";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  REASON_CATEGORY_LABELS,
  SUGGESTED_ACTION_LABELS,
  formatDateTime,
  type Tone,
} from "@/lib/format";
import type { AiAnalysis, AnalysisSource, SuggestedAction } from "@/types";

const SOURCE_LABELS: Record<AnalysisSource, string> = {
  ai: "AI-generated",
  fallback: "Rule-based fallback (no AI used)",
  demo: "Demo content (no AI used)",
};

const SOURCE_TONES: Record<AnalysisSource, Tone> = {
  ai: "info",
  fallback: "neutral",
  demo: "warning",
};

const ACTION_TONES: Record<SuggestedAction, Tone> = {
  approve: "success",
  reject: "danger",
  request_more_info: "warning",
  manual_review: "warning",
};

interface AiAnalysisPanelProps {
  analysis: AiAnalysis | null;
}

export function AiAnalysisPanel({ analysis }: AiAnalysisPanelProps) {
  if (!analysis) {
    return (
      <Card title="AI case analysis">
        <EmptyState
          title="No analysis available"
          description="An analysis appears here once the case has been processed."
          icon={<Sparkles size={22} />}
        />
      </Card>
    );
  }

  const confidencePercent = Math.round(Math.min(Math.max(analysis.confidence, 0), 1) * 100);

  return (
    <Card
      title="AI case analysis"
      description="Advisory only. It never approves a refund or overrides the policy checks."
      action={<Badge tone={SOURCE_TONES[analysis.source]}>{SOURCE_LABELS[analysis.source]}</Badge>}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{REASON_CATEGORY_LABELS[analysis.category]}</Badge>
          <Badge tone={ACTION_TONES[analysis.suggestedAction]} dot>
            {SUGGESTED_ACTION_LABELS[analysis.suggestedAction]}
          </Badge>
        </div>

        <section aria-labelledby="ai-summary-heading">
          <h3 id="ai-summary-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Summary
          </h3>
          {/* Plain text only: summaries can echo untrusted customer wording. */}
          <p className="mt-1 text-sm text-slate-700">{analysis.summary}</p>
        </section>

        {analysis.keyPoints.length > 0 && (
          <section aria-labelledby="ai-points-heading">
            <h3 id="ai-points-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Key points
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {analysis.keyPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="ai-rationale-heading">
          <h3 id="ai-rationale-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Rationale
          </h3>
          <p className="mt-1 text-sm text-slate-700">{analysis.rationale}</p>
        </section>

        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Confidence</span>
            <span className="font-medium text-slate-700">{confidencePercent}%</span>
          </div>
          <div aria-hidden="true" className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${confidencePercent}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Never used for payment decisions. Generated {formatDateTime(analysis.generatedAt)}.
          </p>
        </div>
      </div>
    </Card>
  );
}
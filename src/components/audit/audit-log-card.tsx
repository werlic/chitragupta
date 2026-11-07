'use client';

import { useEffect, useRef, useState } from 'react';
import { NoAccess } from '@/components/shell/require-permission';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, ScrollText } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

/** Audit trail list (GET /api/admin/audit), shown to audit:view and data:manage. */
export function AuditLogCard() {
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // One request per mount (dev StrictMode runs effects twice)
    if (started.current) return;
    started.current = true;
    fetch('/api/admin/audit')
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          setDenied(true);
          return;
        }
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Audit log gagal dimuat.');
        setAuditLogs(data.logs || []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const eventColors: Record<string, string> = {
    INPUT_RECEIVED: 'info',
    CONSENT_LOGGED: 'secondary',
    INJECTION_DETECTED: 'destructive',
    PII_REDACTED: 'warning',
    PARSER_CALLED: 'info',
    SCHEMA_VALIDATED: 'secondary',
    EVIDENCE_CHECKED: 'secondary',
    CLARIFIER_ASKED: 'warning',
    RULE_WARNING: 'warning',
    VALIDATOR_CALLED: 'info',
    NOTULEN_GENERATED: 'success',
    PLAN_APPROVED: 'success',
    EXECUTION_SUCCESS: 'success',
    EXECUTION_UNDONE: 'destructive',
    EXECUTION_FAILED: 'destructive',
  };

  if (denied) return <NoAccess />;
  if (error)
    return (
      <p role="alert" className="m-0 rounded-lg bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive">
        {error}
      </p>
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-indigo-500" />
          <CardTitle className="text-base">Audit Log ({auditLogs.length})</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-center py-8 text-muted-foreground">Memuat...</p>
        ) : auditLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Database className="h-10 w-10 mx-auto mb-3 opacity-50" />
            Belum ada audit log
          </div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-accent transition-colors text-sm">
                <Badge variant={(eventColors[log.type] as any) || 'secondary'} className="text-xs shrink-0">
                  {log.type}
                </Badge>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDateTime(log.createdAt)}
                </span>
                {log.user && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    oleh {log.user.name}
                  </span>
                )}
                {log.meeting && (
                  <span className="text-xs text-muted-foreground truncate">
                    {log.meeting.title}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

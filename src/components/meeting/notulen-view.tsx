import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Users, ListChecks, Gavel, CheckSquare, Hash, HelpCircle } from 'lucide-react';
import type { Notulen } from '@/lib/agent/types';

const OPEN_ITEM_LABEL: Record<string, string> = {
  suggestion: 'Saran',
  vague: 'Belum spesifik',
  question: 'Pertanyaan',
};

export function NotulenView({ notulen }: { notulen: Notulen }) {
  // Older notulen (saved before open_items existed) have no such field
  const openItems = notulen.open_items ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <CardTitle className="text-[15px]">Notulen</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Identitas */}
        <div className="grid grid-cols-2 gap-4 pb-4 border-b">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Judul</p>
            <p className="font-semibold">{notulen.judul}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Tanggal</p>
            <p className="font-semibold">{notulen.tanggal}</p>
          </div>
        </div>

        {/* Peserta */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-info" />
            <h4 className="text-sm font-semibold">Peserta</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {notulen.peserta.map((p, i) => (
              <Badge key={i} variant="secondary">{p}</Badge>
            ))}
          </div>
        </div>

        {/* Agenda */}
        {notulen.agenda.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ListChecks className="h-4 w-4 text-success" />
              <h4 className="text-sm font-semibold">Agenda</h4>
            </div>
            <ul className="space-y-1">
              {notulen.agenda.map((a, i) => (
                <li key={i} className="text-sm text-muted-foreground pl-4 border-l-2 border-muted">
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pembahasan */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Pembahasan</h4>
          <div className="rounded-md bg-muted/50 p-4 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
            {notulen.pembahasan}
          </div>
        </div>

        {/* Keputusan */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Gavel className="h-4 w-4 text-warning" />
            <h4 className="text-sm font-semibold">Keputusan</h4>
          </div>
          <ul className="space-y-1">
            {notulen.keputusan.map((k, i) => (
              <li key={i} className="text-sm pl-4 border-l-2 border-warning">
                {k}
              </li>
            ))}
          </ul>
        </div>

        {/* Action Items Summary */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CheckSquare className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Aksi ({notulen.actionItems.length})</h4>
          </div>
          <div className="space-y-1">
            {notulen.actionItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm py-1">
                <span>{item.title}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{item.owner}</span>
                  {item.dueDate && <Badge variant="outline">{item.dueDate}</Badge>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Open Items: saran / pertanyaan / belum spesifik — tidak dieksekusi */}
        {openItems.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <HelpCircle className="h-4 w-4 text-clarify" />
              <h4 className="text-sm font-semibold">Open item — tidak dieksekusi ({openItems.length})</h4>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Saran, pertanyaan, atau komitmen yang belum pasti. Dicatat saja, tidak dijadikan aksi.
            </p>
            <div className="space-y-1">
              {openItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-2 text-sm py-1">
                  <div className="min-w-0">
                    <p>{item.title}</p>
                    <p className="text-xs text-muted-foreground italic truncate">&ldquo;{item.evidenceQuote}&rdquo;</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {item.owner && <span>{item.owner}</span>}
                    <Badge variant="outline">{OPEN_ITEM_LABEL[item.status] ?? item.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hash / Tanda Tangan Digital */}
        <div className="pt-4 border-t">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground font-mono break-all">
              Hash notulen (SHA-256): {notulen.hash}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

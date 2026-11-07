import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/auth/rbac';
import { runPipeline, ParserFailedError, PipelineFailedError } from '@/lib/agent/orchestrator';

const ProcessSchema = z.object({
  title: z.string().optional(),
  text: z.string().min(10, 'Teks rapat minimal 10 karakter'),
  participants: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!can(user.role, 'meeting:create')) {
    return NextResponse.json({ error: 'Anda tidak memiliki izin untuk membuat meeting' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = ProcessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  try {
    const result = await runPipeline({
      title: parsed.data.title,
      text: parsed.data.text,
      participants: parsed.data.participants,
      userId: user.userId,
      userName: user.name,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Process error:', error);
    // Parser failure: meeting already REJECTED + PARSER_FAILED logged; the technical reason stays in the audit log
    if (error instanceof ParserFailedError) {
      return NextResponse.json(
        {
          error: 'Agent tidak bisa membaca teks ini. Coba lagi atau ubah teksnya.',
          code: 'PARSER_FAILED',
          meetingId: error.meetingId,
          retryable: true,
        },
        { status: 422 }
      );
    }
    // Later stage failed: meeting already REJECTED + PIPELINE_FAILED logged (when it existed)
    return NextResponse.json(
      {
        error: 'Pipeline gagal. Coba lagi beberapa saat lagi.',
        ...(error instanceof PipelineFailedError ? { code: 'PIPELINE_FAILED', meetingId: error.meetingId } : {}),
      },
      { status: 500 }
    );
  }
}

// Client view of the chat-session contract (/api/chat/ai/sessions*, SSE on /api/chat/ai)

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  pendingApproval?: boolean;
  lastMeetingId?: string | null;
}

export interface PlanCardOption {
  value: string;
  label: string;
  role?: string | null;
  department?: string | null;
  timezone?: string | null;
  location?: string | null;
}

export interface PlanCardData {
  meetingId: string;
  title: string;
  status: string;
  statusLabel?: string;
  /** After approve: whether the run was undone (optional; older servers omit it) */
  executionState?: 'none' | 'executed' | 'undone' | 'partially_undone';
  planHash: string | null;
  reviewUrl: string;
  counts: { actions: number; openItems: number; quarantined: number };
  candidates: {
    candidateId: string;
    title: string;
    actionType: string;
    owner: string;
    dueDate?: string | null;
    dueTime?: string | null;
    recipients: string[];
    highImpact?: boolean;
  }[];
  questions: {
    id: string;
    candidateId: string;
    /** One contact question can cover several actions ("Budi yang mana?" once per name) */
    candidateIds?: string[];
    appliesTo?: string[];
    question: string;
    type: string;
    options?: PlanCardOption[];
  }[];
  ruleWarnings: { candidateId: string; message: string }[];
  quarantined: { segmentId: string; text: string }[];
  openItems: string[];
}

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  plan: PlanCardData | null;
  /** Client-only: still streaming */
  streaming?: boolean;
  error?: boolean;
}

import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { can, type Permission } from '@/lib/auth/rbac';
import type { Role } from '@prisma/client';

export type ActionTool = 'email' | 'calendar' | 'task' | 'whatsapp';

/** Reason codes written to audit and returned by /api/agent/approve. */
export type PermissionDenyReason = 'permission_denied' | 'permission_config_unavailable';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  missingPermission?: Permission;
}

export interface PermissionDenial {
  recipient: string;
  rule: 'role_tool' | 'role_contact' | 'contact_rule' | 'recipient_unknown';
  detail: string;
}

export interface ActionPermissionResult {
  allowed: boolean;
  reason?: PermissionDenyReason;
  /** Human-readable explanation (Bahasa Indonesia) */
  message?: string;
  /** One entry per failed rule (role-level or per recipient) */
  denied?: PermissionDenial[];
}

/**
 * Tools the AI assistant may call. None of them executes an action:
 * propose_actions only creates a plan that a person must approve.
 */
export type ToolType = 'propose_actions';

/**
 * Mapping of tool types to required RBAC permissions.
 */
const TOOL_PERMISSIONS: Record<ToolType, Permission> = {
  propose_actions: 'meeting:create',
};

/**
 * Check if a user's role has permission to execute the given tool.
 * Uses the existing RBAC `can()` function.
 */
export function checkToolPermission(role: Role, toolType: ToolType): PermissionCheckResult {
  const requiredPermission = TOOL_PERMISSIONS[toolType];
  if (!requiredPermission) {
    return { allowed: false, reason: `Unknown tool type: ${toolType}` };
  }

  if (can(role, requiredPermission)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Permission denied. Tool "${toolType}" requires permission "${requiredPermission}"`,
    missingPermission: requiredPermission,
  };
}

// ============ DATA PACK PERMISSION TABLE ============

const ToolSchema = z.enum(['email', 'calendar', 'task', 'whatsapp']);

const PermissionsFileSchema = z.object({
  permissions: z.array(
    z.object({
      role: z.string(),
      canContactRoles: z.array(z.string()),
      allowedTools: z.array(ToolSchema),
    })
  ),
  contactRules: z
    .array(
      z.object({
        contactId: z.string(),
        canBeContactedBy: z.array(z.string()),
        allowedTools: z.array(ToolSchema),
      })
    )
    .default([]),
});

const ContactsFileSchema = z.object({
  contacts: z.array(
    z.object({ id: z.string(), name: z.string(), role: z.string().optional(), email: z.string().optional() })
  ),
  externalContacts: z.array(z.object({ id: z.string(), name: z.string(), email: z.string().optional() })).default([]),
});

interface PackContact {
  id: string;
  name: string;
  email?: string;
  /** ADMIN | DIRECTOR | MANAGER | SECRETARY | STAFF | EXTERNAL */
  permissionRole: string;
}

export interface PermissionConfig {
  permissions: z.infer<typeof PermissionsFileSchema>['permissions'];
  contactRules: z.infer<typeof PermissionsFileSchema>['contactRules'];
  contacts: PackContact[];
}

/**
 * Contact job titles in contacts.json ("Senior Staff", "Team Lead", ...) mapped to the
 * role names used by canContactRoles. Anything that is not management is STAFF.
 */
export function contactPermissionRole(jobRole: string | undefined | null, isExternal: boolean): string {
  if (isExternal) return 'EXTERNAL';
  const r = (jobRole || '').toLowerCase();
  if (/admin/.test(r)) return 'ADMIN';
  if (/direktur|director/.test(r)) return 'DIRECTOR';
  if (/manager|manajer/.test(r)) return 'MANAGER';
  if (/secretary|sekretaris/.test(r)) return 'SECRETARY';
  return 'STAFF';
}

/**
 * Load permissions.json + contacts.json. Returns null when either cannot be read or
 * has an unexpected shape; callers must then refuse (fail-closed).
 */
export function loadPermissionConfig(dir: string = join(process.cwd(), 'data', 'datapack')): PermissionConfig | null {
  try {
    const perms = PermissionsFileSchema.parse(JSON.parse(readFileSync(join(dir, 'permissions.json'), 'utf-8')));
    const contactsFile = ContactsFileSchema.parse(JSON.parse(readFileSync(join(dir, 'contacts.json'), 'utf-8')));
    const contacts: PackContact[] = [
      ...contactsFile.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        permissionRole: contactPermissionRole(c.role, false),
      })),
      ...contactsFile.externalContacts.map((c) => ({ id: c.id, name: c.name, email: c.email, permissionRole: 'EXTERNAL' })),
    ];
    return { permissions: perms.permissions, contactRules: perms.contactRules, contacts };
  } catch (err) {
    console.error('[PermissionGate] Permission table unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Recipient as stored on ActionCandidate.recipients (JSON RecipientInfo) or a raw string. */
interface RecipientRef {
  label: string;
  contactId?: string;
  name?: string;
  email?: string | null;
  isExternal?: boolean;
}

function parseRecipient(raw: string): RecipientRef {
  try {
    const info = JSON.parse(raw);
    if (info && typeof info === 'object') {
      return {
        label: info.name || info.email || info.contactId || raw,
        contactId: info.contactId,
        name: info.name,
        email: info.email,
        isExternal: info.isExternal === true,
      };
    }
  } catch {
    // plain string: a name, email or phone
  }
  const isEmail = raw.includes('@');
  return { label: raw, name: isEmail ? undefined : raw, email: isEmail ? raw : undefined };
}

/**
 * Match a recipient to a data-pack contact: data-pack id, then email, then exact name.
 * DB Contact ids are cuids, so DB recipients reach their data-pack entry via email/name.
 */
function findPackContact(config: PermissionConfig, r: RecipientRef): PackContact | undefined {
  const norm = (s?: string | null) => (s || '').trim().toLowerCase();
  return (
    (r.contactId ? config.contacts.find((c) => c.id === r.contactId) : undefined) ||
    (r.email ? config.contacts.find((c) => c.email && norm(c.email) === norm(r.email)) : undefined) ||
    (r.name ? config.contacts.find((c) => norm(c.name) === norm(r.name)) : undefined)
  );
}

/**
 * Permission check for one action against the data-pack table:
 * 1. allowedTools of the user's role
 * 2. for EVERY recipient: the user's canContactRoles must include the recipient's role
 * 3. for EVERY recipient with a contactRule: canBeContactedBy + allowedTools
 * Fail-closed: unreadable table -> 'permission_config_unavailable';
 * any failed rule or unidentifiable recipient -> 'permission_denied'.
 */
export function checkActionPermission(
  role: Role,
  tool: ActionTool,
  recipients: string[],
  config: PermissionConfig | null = loadPermissionConfig()
): ActionPermissionResult {
  if (!config) {
    return {
      allowed: false,
      reason: 'permission_config_unavailable',
      message: 'Tabel permission (data/datapack/permissions.json) tidak bisa dibaca; aksi ditolak demi keamanan.',
    };
  }

  const denied: PermissionDenial[] = [];
  const roleRule = config.permissions.find((p) => p.role === role);

  if (!roleRule) {
    denied.push({ recipient: '-', rule: 'role_tool', detail: `Role "${role}" tidak ada di tabel permission` });
  } else if (!roleRule.allowedTools.includes(tool)) {
    denied.push({ recipient: '-', rule: 'role_tool', detail: `Role "${role}" tidak boleh memakai tool "${tool}"` });
  }

  for (const raw of recipients) {
    const r = parseRecipient(raw);
    const contact = findPackContact(config, r);
    const recipientRole = contact?.permissionRole ?? (r.isExternal ? 'EXTERNAL' : undefined);

    if (!recipientRole) {
      denied.push({ recipient: r.label, rule: 'recipient_unknown', detail: `Penerima "${r.label}" tidak dikenal di data pack` });
      continue;
    }
    if (roleRule && !roleRule.canContactRoles.includes(recipientRole)) {
      denied.push({
        recipient: r.label,
        rule: 'role_contact',
        detail: `Role "${role}" tidak boleh menghubungi ${recipientRole} (${r.label})`,
      });
    }
    const contactRule = contact ? config.contactRules.find((cr) => cr.contactId === contact.id) : undefined;
    if (contactRule) {
      if (!contactRule.canBeContactedBy.includes(role)) {
        denied.push({ recipient: r.label, rule: 'contact_rule', detail: `${r.label} tidak boleh dihubungi oleh role "${role}"` });
      } else if (!contactRule.allowedTools.includes(tool)) {
        denied.push({ recipient: r.label, rule: 'contact_rule', detail: `Tool "${tool}" tidak diizinkan untuk ${r.label}` });
      }
    }
  }

  if (denied.length > 0) {
    return { allowed: false, reason: 'permission_denied', message: denied.map((d) => d.detail).join('; '), denied };
  }
  return { allowed: true };
}

/**
 * Single-contact check for callers/tests that pass a data-pack contact id ("c001").
 * Same rules and fail-closed behaviour as checkActionPermission.
 */
export async function checkContactPermission(
  role: Role,
  contactId: string,
  tool: ActionTool
): Promise<PermissionCheckResult & { code?: PermissionDenyReason }> {
  const config = loadPermissionConfig();
  const contact = config?.contacts.find((c) => c.id === contactId);
  const recipient = JSON.stringify({ contactId, name: contact?.name ?? contactId, email: contact?.email });
  const result = checkActionPermission(role, tool, [recipient], config);
  return result.allowed ? { allowed: true } : { allowed: false, reason: result.message, code: result.reason };
}

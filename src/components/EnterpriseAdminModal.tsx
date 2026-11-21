import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  ShieldCheck,
  Users,
  HardDrive,
  Server,
  FileCheck2,
  Download,
  RefreshCw,
  LogOut,
  KeyRound,
  UserPlus,
  Archive,
  CheckCircle2,
  AlertTriangle,
  Lock,
} from 'lucide-react';

interface EnterpriseSecuritySummary {
  auth_mode: 'local_open' | 'enforced';
  has_users: boolean;
  user_count: number;
  workspace_count: number;
  audit_log_count: number;
  jwt_secret_configured: boolean;
  admin_passcode_required: boolean;
  rbac_roles: string[];
}

interface StorageStatus {
  backend: 'local' | 's3';
  configured: boolean;
  reachable: boolean;
  bucket: string | null;
  endpoint: string | null;
  region: string | null;
  local_archive_dir: string;
  boto3_installed: boolean;
  message: string;
}

interface ArchiveItem {
  backend: string;
  archive_name: string;
  uri: string;
  size_bytes: number;
  created_at: string | null;
}

interface EnterpriseActor {
  sub?: string;
  email: string;
  full_name: string;
  role: 'admin' | 'engineer' | 'viewer';
  workspace_id: string;
  authenticated?: boolean;
}

interface EnterpriseUserRow {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'engineer' | 'viewer';
  workspace_id: string;
  is_active: boolean;
  created_at: string | null;
}

interface AuditLogRow {
  id: number;
  actor_email: string;
  actor_role: string;
  action: string;
  resource: string;
  status: string;
  ip_address: string;
  entry_hash: string;
  created_at: string | null;
}

interface EnterpriseAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  authToken: string | null;
  onAuthTokenChange: (token: string | null) => void;
  lastTaskId: string | null;
}

type ModalTab = 'identity' | 'storage' | 'orchestration' | 'audit';

export const EnterpriseAdminModal: React.FC<EnterpriseAdminModalProps> = ({
  isOpen,
  onClose,
  authToken,
  onAuthTokenChange,
  lastTaskId,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('identity');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [security, setSecurity] = useState<EnterpriseSecuritySummary | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const [actor, setActor] = useState<EnterpriseActor | null>(null);
  const [users, setUsers] = useState<EnterpriseUserRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);

  // Bootstrap admin form
  const [bootEmail, setBootEmail] = useState('');
  const [bootName, setBootName] = useState('');
  const [bootPassword, setBootPassword] = useState('');
  const [bootWorkspace, setBootWorkspace] = useState('NASEER Engineering Organization');
  const [bootPasscode, setBootPasscode] = useState('');

  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Create user form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'engineer' | 'viewer'>('engineer');

  const [archiving, setArchiving] = useState(false);

  const buildHeaders = useCallback(
    (withJson = false): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (withJson) headers['Content-Type'] = 'application/json';
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      return headers;
    },
    [authToken],
  );

  const extractErr = (body: any, fallback: string) => {
    if (typeof body?.error === 'string') return body.error;
    if (typeof body?.detail === 'string') return body.detail;
    if (typeof body?.detail?.error === 'string') return body.detail.error;
    return fallback;
  };

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const statusRes = await fetch('/api/enterprise/status', { headers: buildHeaders() });
      const statusBody = await statusRes.json().catch(() => null);
      if (!statusRes.ok || !statusBody?.success) {
        throw new Error(extractErr(statusBody, `Enterprise API unavailable (${statusRes.status})`));
      }
      setSecurity(statusBody.security);
      setStorage(statusBody.storage);
      setActor(statusBody.current_actor || null);

      const canQueryProtected =
        statusBody.security?.auth_mode === 'local_open' || Boolean(authToken && statusBody.current_actor);

      if (canQueryProtected) {
        const [storageRes, auditRes] = await Promise.all([
          fetch('/api/enterprise/storage/status', { headers: buildHeaders() }),
          fetch('/api/enterprise/audit-logs?limit=60', { headers: buildHeaders() }),
        ]);
        if (storageRes.ok) {
          const sb = await storageRes.json().catch(() => null);
          if (sb?.storage) setStorage(sb.storage);
          if (Array.isArray(sb?.archives)) setArchives(sb.archives);
        }
        if (auditRes.ok) {
          const ab = await auditRes.json().catch(() => null);
          if (Array.isArray(ab?.logs)) setAuditLogs(ab.logs);
        }
        const isAdmin =
          statusBody.security?.auth_mode === 'local_open' || statusBody.current_actor?.role === 'admin';
        if (isAdmin) {
          const usersRes = await fetch('/api/enterprise/users', { headers: buildHeaders() });
          if (usersRes.ok) {
            const ub = await usersRes.json().catch(() => null);
            if (Array.isArray(ub?.users)) setUsers(ub.users);
          }
        } else {
          setUsers([]);
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to connect to Enterprise Security service on Docker (:8000).');
    } finally {
      setLoading(false);
    }
  }, [authToken, buildHeaders]);

  useEffect(() => {
    if (isOpen) {
      refreshAll();
    }
  }, [isOpen, refreshAll]);

  if (!isOpen) return null;

  const handleBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/enterprise/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: bootEmail.trim(),
          full_name: bootName.trim(),
          password: bootPassword,
          workspace_name: bootWorkspace.trim(),
          ...(bootPasscode.trim() ? { admin_passcode: bootPasscode.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(extractErr(body, `Admin claim failed (${res.status})`));
      }
      onAuthTokenChange(body.access_token || null);
      setBootPassword('');
      setBootPasscode('');
      setSuccessMsg(`Admin account claimed for ${body.user?.email}. Bootstrap endpoint is now permanently locked.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Admin bootstrap failed');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/enterprise/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(extractErr(body, `Sign-in failed (${res.status})`));
      }
      onAuthTokenChange(body.access_token || null);
      setLoginPassword('');
      setSuccessMsg(`Signed in as ${body.user?.email} (${body.user?.role}). Token held in memory only.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Sign-in failed');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/enterprise/users', {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          email: newEmail.trim(),
          full_name: newName.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(extractErr(body, `Create user failed (${res.status})`));
      }
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setSuccessMsg(`Created ${body.user?.role} account: ${body.user?.email}`);
      await refreshAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create user');
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/enterprise/users/${encodeURIComponent(userId)}/role`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ role }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(extractErr(body, `Role update failed (${res.status})`));
      }
      setSuccessMsg(`Updated role for ${body.user?.email} to ${body.user?.role}`);
      await refreshAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Role update failed');
    }
  };

  const handleArchiveLatestJob = async () => {
    if (!lastTaskId) return;
    setArchiving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/enterprise/storage/archive/${encodeURIComponent(lastTaskId)}`, {
        method: 'POST',
        headers: buildHeaders(),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(extractErr(body, `Archive failed (${res.status})`));
      }
      setSuccessMsg(
        `Archived ${body.archive?.file_count} solver files (${(Number(body.archive?.size_bytes || 0) / 1024).toFixed(1)} KB) -> ${body.archive?.uri}`,
      );
      await refreshAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to archive simulation job');
    } finally {
      setArchiving(false);
    }
  };

  const handleDownloadPack = async (packId: string, fallbackFilename: string) => {
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/enterprise/deploy/${encodeURIComponent(packId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(extractErr(body, `Download failed (${res.status})`));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fallbackFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMsg(`Downloaded ${fallbackFilename}`);
    } catch (err: any) {
      setErrorMsg(err?.message || `Failed to download ${fallbackFilename}`);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const tabs: Array<{ id: ModalTab; label: string; icon: React.ReactNode }> = [
    { id: 'identity', label: 'Identity & RBAC', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'storage', label: 'S3 / MinIO Storage', icon: <HardDrive className="h-3.5 w-3.5" /> },
    { id: 'orchestration', label: 'K8s, Slurm & CI/CD', icon: <Server className="h-3.5 w-3.5" /> },
    { id: 'audit', label: 'Audit Trail', icon: <FileCheck2 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Enterprise Security, S3 Object Storage & Cloud Orchestration
              </h2>
              <p className="text-[11px] text-slate-400">
                Multi-Tenant RBAC · Scrypt + HS256 Auth · SHA-256 Audit Ledger · S3/MinIO · Kubernetes & Slurm HPC
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {security && (
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] font-medium ${
                  security.auth_mode === 'enforced'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                }`}
              >
                MODE: {security.auth_mode.toUpperCase()}
              </span>
            )}
            <button
              onClick={refreshAll}
              disabled={loading}
              className="rounded border border-slate-700 bg-slate-800/80 p-1.5 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              title="Refresh live status from Docker FastAPI"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="rounded border border-slate-700 bg-slate-800/80 p-1.5 text-slate-400 hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-900/90 px-5 pt-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-sky-400 text-sky-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Status Messages */}
        {(errorMsg || successMsg) && (
          <div className="space-y-1.5 border-b border-slate-800 px-5 py-2.5">
            {errorMsg && (
              <div className="flex items-center gap-2 rounded border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}
            {successMsg && (
              <div className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{successMsg}</span>
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {activeTab === 'identity' && (
            <div className="space-y-5">
              {/* Live security posture summary */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Auth Mode</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-100">
                    {security?.auth_mode || '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Registered Users</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-sky-300">
                    {security ? security.user_count : '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">JWT Signing Key</div>
                  <div className="mt-1 font-mono text-xs font-semibold text-slate-200">
                    {security?.jwt_secret_configured ? 'ENV Configured' : 'Ephemeral Session'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Audit Events</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-emerald-300">
                    {security ? security.audit_log_count : '—'}
                  </div>
                </div>
              </div>

              {/* Active Session Banner */}
              {actor ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Lock className="h-4 w-4 text-emerald-400" />
                    <div className="text-xs">
                      <div className="font-semibold text-emerald-200">
                        Signed in: {actor.full_name} ({actor.email})
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Role: <span className="font-mono uppercase text-emerald-300">{actor.role}</span> · Workspace:{' '}
                        <span className="font-mono">{actor.workspace_id}</span> · Session token held strictly in memory
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      onAuthTokenChange(null);
                      setActor(null);
                      setSuccessMsg('Signed out and cleared in-memory session token.');
                    }}
                    className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign Out
                  </button>
                </div>
              ) : security && !security.has_users ? (
                /* First-run Admin Claim */
                <form
                  onSubmit={handleBootstrapAdmin}
                  className="space-y-3 rounded-lg border border-sky-500/40 bg-sky-950/20 p-4"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
                    <KeyRound className="h-4 w-4" />
                    First-Run Administrator Claim (One-Time Setup)
                  </div>
                  <p className="text-[11px] text-slate-400">
                    No user accounts exist yet. Create the initial Workspace Administrator account. Once claimed,
                    this bootstrap endpoint permanently locks itself (HTTP 409).
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="email"
                      required
                      value={bootEmail}
                      onChange={(e) => setBootEmail(e.target.value)}
                      placeholder="admin@company.com"
                      className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                    />
                    <input
                      type="text"
                      required
                      value={bootName}
                      onChange={(e) => setBootName(e.target.value)}
                      placeholder="Full Name"
                      className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                    />
                    <input
                      type="password"
                      required
                      minLength={10}
                      value={bootPassword}
                      onChange={(e) => setBootPassword(e.target.value)}
                      placeholder="Strong password (min 10 characters)"
                      className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                    />
                    <input
                      type="text"
                      value={bootWorkspace}
                      onChange={(e) => setBootWorkspace(e.target.value)}
                      placeholder="Workspace Organization Name"
                      className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                    />
                    {security.admin_passcode_required && (
                      <input
                        type="password"
                        required
                        value={bootPasscode}
                        onChange={(e) => setBootPasscode(e.target.value)}
                        placeholder="Server NASEER_ADMIN_PASSCODE"
                        className="rounded border border-amber-500/50 bg-slate-950 px-3 py-2 text-xs text-slate-100 sm:col-span-2"
                      />
                    )}
                  </div>
                  <button
                    type="submit"
                    className="rounded bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
                  >
                    Claim Administrator Account
                  </button>
                </form>
              ) : (
                /* Sign-In Form */
                <form
                  onSubmit={handleLogin}
                  className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <KeyRound className="h-4 w-4 text-sky-400" />
                    Sign In to Workspace (RBAC Session)
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="engineer@company.com"
                      className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                    />
                    <input
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Password"
                      className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
                  >
                    Sign In
                  </button>
                </form>
              )}

              {/* User Provisioning & RBAC Management */}
              {(security?.auth_mode === 'local_open' || actor?.role === 'admin') && (
                <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <UserPlus className="h-4 w-4 text-emerald-400" />
                    Team Members & Role-Based Access Control (RBAC)
                  </div>
                  <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                    <input
                      type="email"
                      required
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="member@company.com"
                      className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Full name"
                      className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                    <input
                      type="password"
                      required
                      minLength={10}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Password (>=10 chars)"
                      className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as 'admin' | 'engineer' | 'viewer')}
                      className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                    >
                      <option value="engineer">Engineer (Run & Export)</option>
                      <option value="viewer">Viewer (Read-Only)</option>
                      <option value="admin">Admin (Full Control)</option>
                    </select>
                    <button
                      type="submit"
                      className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      Add Member
                    </button>
                  </form>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                        <tr>
                          <th className="py-2 pr-3">Name</th>
                          <th className="py-2 pr-3">Email</th>
                          <th className="py-2 pr-3">Role</th>
                          <th className="py-2">Workspace</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {users.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-4 text-center text-slate-500">
                              No user accounts created yet.
                            </td>
                          </tr>
                        ) : (
                          users.map((u) => (
                            <tr key={u.id}>
                              <td className="py-2 pr-3 font-medium text-slate-200">{u.full_name}</td>
                              <td className="py-2 pr-3 font-mono text-slate-300">{u.email}</td>
                              <td className="py-2 pr-3">
                                <select
                                  value={u.role}
                                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-sky-300"
                                >
                                  <option value="viewer">viewer</option>
                                  <option value="engineer">engineer</option>
                                  <option value="admin">admin</option>
                                </select>
                              </td>
                              <td className="py-2 font-mono text-[11px] text-slate-400">{u.workspace_id}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-100">
                      Object Storage Backend:{' '}
                      <span className="font-mono uppercase text-sky-400">{storage?.backend || '—'}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{storage?.message || 'Probing storage...'}</p>
                    <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] text-slate-400">
                      <span>Reachable: {storage?.reachable ? 'YES' : 'NO'}</span>
                      <span>boto3 SDK: {storage?.boto3_installed ? 'Installed' : 'Not installed'}</span>
                      {storage?.bucket && <span>Bucket: {storage.bucket}</span>}
                      {storage?.endpoint && <span>Endpoint: {storage.endpoint}</span>}
                    </div>
                  </div>
                  <button
                    onClick={handleArchiveLatestJob}
                    disabled={!lastTaskId || archiving}
                    className="flex items-center gap-1.5 rounded bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      lastTaskId
                        ? `Zip and upload solver case ${lastTaskId} to configured object storage`
                        : 'Run a Celery simulation first to archive its real case directory'
                    }
                  >
                    <Archive className="h-3.5 w-3.5" />
                    {archiving ? 'Archiving Case...' : 'Archive Latest Job (.zip)'}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                <div className="mb-3 text-xs font-semibold text-slate-200">
                  Archived Simulation Case Packs ({archives.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                      <tr>
                        <th className="py-2 pr-3">Archive</th>
                        <th className="py-2 pr-3">Backend</th>
                        <th className="py-2 pr-3">Size</th>
                        <th className="py-2">URI / Path</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {archives.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-slate-500">
                            No simulation case archives uploaded yet.
                          </td>
                        </tr>
                      ) : (
                        archives.map((item) => (
                          <tr key={item.uri}>
                            <td className="py-2 pr-3 font-mono text-slate-200">{item.archive_name}</td>
                            <td className="py-2 pr-3 font-mono uppercase text-sky-300">{item.backend}</td>
                            <td className="py-2 pr-3 font-mono text-slate-300">{formatBytes(item.size_bytes)}</td>
                            <td className="py-2 font-mono text-[11px] text-slate-400">{item.uri}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'orchestration' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                {
                  id: 'k8s',
                  filename: 'naseer-cae-k8s-stack.yaml',
                  title: 'Kubernetes Production Stack + Worker HPA',
                  desc: 'Namespace, ConfigMap, PVC, Redis, MinIO StatefulSet, FastAPI API, Celery Worker Deployment, HorizontalPodAutoscaler (2–16 replicas), and Nginx Ingress.',
                },
                {
                  id: 'slurm',
                  filename: 'submit_naseer_job.sbatch',
                  title: 'Slurm HPC Supercomputer Script',
                  desc: 'Batch script for university and national HPC clusters launching OpenFOAM MPI (srun/decomposePar), CalculiX OpenMP, or ElmerFEM via native modules or Apptainer.',
                },
                {
                  id: 'compose-enterprise',
                  filename: 'docker-compose.enterprise.yml',
                  title: 'Enterprise Docker Compose (PostgreSQL + MinIO)',
                  desc: 'Full self-hosted multi-tenant stack combining FastAPI (enforced RBAC), Celery CAE Worker, Redis, PostgreSQL 16, and MinIO S3 Object Storage.',
                },
                {
                  id: 'cicd',
                  filename: 'naseer-ci-cd.yml',
                  title: 'GitHub Actions CI/CD Verification Pipeline',
                  desc: 'Automated pipeline running Python solver & V&V unit tests, TypeScript checks, Vite production bundling, shell checks, and Docker API build verification.',
                },
              ].map((pack) => (
                <div
                  key={pack.id}
                  className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-950/60 p-4"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-100">{pack.title}</div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{pack.desc}</p>
                  </div>
                  <button
                    onClick={() => handleDownloadPack(pack.id, pack.filename)}
                    className="mt-4 flex items-center justify-center gap-1.5 rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download {pack.filename}
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-200">
                  Tamper-Evident SHA-256 Chained Audit Trail ({auditLogs.length} recent events)
                </div>
                <span className="font-mono text-[10px] text-slate-400">SQLAlchemy Ledger · Immutable Chain</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                    <tr>
                      <th className="py-2 pr-3">Timestamp (UTC)</th>
                      <th className="py-2 pr-3">Actor</th>
                      <th className="py-2 pr-3">Role</th>
                      <th className="py-2 pr-3">Action</th>
                      <th className="py-2 pr-3">Resource</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">SHA-256 Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-slate-500">
                          No audit events recorded yet. Run a simulation or sign in to generate entries.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((row) => (
                        <tr key={row.id}>
                          <td className="py-2 pr-3 font-mono text-slate-400">
                            {row.created_at ? row.created_at.replace('T', ' ').slice(0, 19) : '—'}
                          </td>
                          <td className="py-2 pr-3 font-mono text-slate-200">{row.actor_email}</td>
                          <td className="py-2 pr-3 font-mono uppercase text-sky-300">{row.actor_role}</td>
                          <td className="py-2 pr-3 font-mono text-slate-200">{row.action}</td>
                          <td className="py-2 pr-3 font-mono text-slate-400">{row.resource}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                                row.status === 'allowed'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-rose-500/15 text-rose-300'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-2 font-mono text-slate-500">{row.entry_hash.slice(0, 14)}…</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

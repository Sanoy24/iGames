import { useCallback, useEffect, useState } from 'react';
import { UserCircle, Phone, Mail, Edit3, Check, X, KeyRound, LogOut } from 'lucide-react';
import { authApi, userApi } from '../lib/api';
import type { User } from '../lib/models';
import { useStore } from '../store/useStore';
import { getErrorMessage } from '../lib/utils';

function InfoRow({ icon, label, value, empty }: { icon: React.ReactNode; label: string; value?: string; empty?: string }) {
  return (
    <div className="profile-info-row">
      <span className="profile-info-icon">{icon}</span>
      <div className="profile-info-body">
        <span className="profile-info-label">{label}</span>
        <span className={value ? 'profile-info-value' : 'profile-info-empty'}>
          {value ?? empty ?? 'Not set'}
        </span>
      </div>
    </div>
  );
}

export function Profile() {
  const storeUser = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const clearAuth = useStore((s) => s.clearAuth);
  const addToast = useStore((s) => s.addToast);

  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const data = await userApi.getMe();
      setProfile(data);
      setDisplayName(data.displayName ?? '');
      setPhoneNumber(data.phoneNumber ?? '');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const startEdit = () => {
    setDisplayName(profile?.displayName ?? '');
    setPhoneNumber(profile?.phoneNumber ?? '');
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const updated = await userApi.updateProfile({
        displayName: displayName.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
      });
      setProfile(updated);
      // Sync store so WalletBar / Home display name updates immediately
      if (storeUser) setUser({ ...storeUser, displayName: updated.displayName, phoneNumber: updated.phoneNumber });
      setEditing(false);
      addToast('success', 'Profile updated.');
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 8) {
      addToast('error', 'New password must be at least 8 characters.');
      return;
    }
    setChangingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      addToast('success', 'Password changed. Sign in again with the new password.');
      localStorage.setItem('manualLogout', '1');
      clearAuth();
    } catch (err) {
      addToast('error', getErrorMessage(err));
    } finally {
      setChangingPassword(false);
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } catch {
      // Local logout still clears the session even if the server is unreachable.
    } finally {
      localStorage.setItem('manualLogout', '1');
      clearAuth();
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="centered-loader" style={{ flex: 1 }}>
        <div className="spinner" />
      </div>
    );
  }

  const user = profile ?? storeUser;

  return (
    <div className="stack-lg">
      {/* Avatar + name header */}
      <section className="card profile-hero">
        <div className="profile-avatar">
          <UserCircle size={64} strokeWidth={1.2} />
        </div>
        <h1 className="profile-name">{user?.displayName ?? 'Player'}</h1>
        <div className="profile-role-row">
          {(user?.roles ?? ['player']).map((role) => (
            <span key={role} className="badge badge-gold">{role}</span>
          ))}
        </div>
      </section>

      {/* Info section */}
      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Your Info</div>
            <p className="section-copy">Manage your display name and payout phone number.</p>
          </div>
          {!editing && (
            <button className="btn btn-secondary btn-sm" onClick={startEdit}>
              <Edit3 size={13} style={{ marginRight: 4 }} />
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <label className="form-field">
              <span>Display Name</span>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                maxLength={64}
              />
            </label>
            <label className="form-field">
              <span>Telebirr Phone Number</span>
              <input
                className="input"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. 0912345678"
                type="tel"
              />
            </label>
            <div className="action-row" style={{ marginTop: 8 }}>
              <button className="btn btn-secondary" onClick={cancelEdit} disabled={saving}>
                <X size={14} style={{ marginRight: 4 }} />
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveProfile} disabled={saving}>
                <Check size={14} style={{ marginRight: 4 }} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-info-list">
            <InfoRow
              icon={<UserCircle size={16} />}
              label="Display Name"
              value={user?.displayName}
            />
            <InfoRow
              icon={<Phone size={16} />}
              label="Telebirr Phone"
              value={user?.phoneNumber}
              empty="Not set — add your number to enable payouts"
            />
            {user?.email && (
              <InfoRow
                icon={<Mail size={16} />}
                label="Email"
                value={user.email}
              />
            )}
          </div>
        )}
      </section>

      {/* Account section */}
      <section className="card">
        <div className="section-title" style={{ marginBottom: 12 }}>Account</div>
        <div className="key-value-list">
          <div className="key-value-row">
            <span>Status</span>
            <strong style={{ textTransform: 'capitalize', color: user?.status === 'active' ? 'var(--green)' : 'var(--danger)' }}>
              {user?.status ?? 'active'}
            </strong>
          </div>
          {user?.lastLoginAt && (
            <div className="key-value-row">
              <span>Last Login</span>
              <strong>{new Date(user.lastLoginAt).toLocaleString()}</strong>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Security</div>
            <p className="section-copy">Change your password or end this session.</p>
          </div>
        </div>
        <div className="stack-sm">
          <label className="form-field">
            <span>Current Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label className="form-field">
            <span>New Password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <div className="action-row" style={{ marginTop: 8 }}>
            <button
              className="btn btn-primary"
              onClick={changePassword}
              disabled={changingPassword || !currentPassword || !newPassword}
            >
              <KeyRound size={14} style={{ marginRight: 4 }} />
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
            <button className="btn btn-secondary" onClick={logout} disabled={loggingOut}>
              <LogOut size={14} style={{ marginRight: 4 }} />
              {loggingOut ? 'Logging out...' : 'Logout'}
            </button>
          </div>
        </div>
      </section>

      {/* Phone prompt if missing */}
      {!user?.phoneNumber && !editing && (
        <section className="card" style={{ borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.05)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Phone size={20} style={{ color: 'var(--gold)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontWeight: 700, marginBottom: 4 }}>Add your Telebirr number</p>
              <p className="section-copy">Your phone number is required to process withdrawal payouts via Telebirr.</p>
              <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={startEdit}>
                Add Phone Number
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

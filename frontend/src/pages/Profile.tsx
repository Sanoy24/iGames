import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    UserCircle,
    Phone,
    Mail,
    Edit3,
    Check,
    X,
    KeyRound,
    LogOut,
    ShieldCheck,
    Send,
    LifeBuoy,
    ChevronRight,
} from 'lucide-react';
import { authApi, userApi } from '../lib/api';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import type { User } from '../lib/models';
import type { AppTab } from '../lib/navigation';
import { useStore } from '../store/useStore';
import { ETHIOPIA_TZ, getErrorMessage } from '../lib/utils';

type TelegramWindow = Window &
    typeof globalThis & { Telegram?: { WebApp?: { initData?: string } } };

function isTelegramMode(): boolean {
    return !!(window as TelegramWindow).Telegram?.WebApp?.initData;
}

function InfoRow({
    icon,
    label,
    value,
    empty,
}: {
    icon: React.ReactNode;
    label: string;
    value?: string;
    empty?: string;
}) {
    const { t } = useTranslation();
    return (
        <div className='profile-info-row'>
            <span className='profile-info-icon'>{icon}</span>
            <div className='profile-info-body'>
                <span className='profile-info-label'>{label}</span>
                <span
                    className={
                        value ? 'profile-info-value' : 'profile-info-empty'
                    }
                >
                    {value ?? empty ?? t('profile.notSet')}
                </span>
            </div>
        </div>
    );
}

export function Profile({
    onNavigate,
}: {
    onNavigate?: (tab: AppTab) => void;
}) {
    const { t } = useTranslation();
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

    const telegramMode = isTelegramMode();

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
            if (storeUser)
                setUser({
                    ...storeUser,
                    displayName: updated.displayName,
                    phoneNumber: updated.phoneNumber,
                });
            setEditing(false);
            addToast('success', t('profile.profileUpdated'));
        } catch (err) {
            addToast('error', getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const changePassword = async () => {
        if (newPassword.length < 8) {
            addToast('error', t('profile.passwordMinLength'));
            return;
        }
        setChangingPassword(true);
        try {
            await authApi.changePassword(currentPassword, newPassword);
            setCurrentPassword('');
            setNewPassword('');
            addToast('success', t('profile.passwordChanged'));
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
            /* local logout is fine even if server unreachable */
        } finally {
            if (!telegramMode) {
                // Standalone web: show credential login on next open
                localStorage.setItem('manualLogout', '1');
            }
            // Telegram mode: just clear tokens  next miniapp open re-auths via initData automatically
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            clearAuth();
            setLoggingOut(false);
        }
    };

    if (loading) {
        return (
            <div className='centered-loader' style={{ flex: 1 }}>
                <div className='spinner' />
            </div>
        );
    }

    const user = profile ?? storeUser;

    return (
        <div className='stack-lg'>
            {/* ── Avatar hero ── */}
            <section className='card profile-hero'>
                <motion.div
                    className='profile-avatar'
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                >
                    <UserCircle size={64} strokeWidth={1.2} />
                </motion.div>
                <h1 className='profile-name'>
                    {user?.displayName ?? t('profile.role_player')}
                </h1>
                <div className='profile-role-row'>
                    {(user?.roles ?? ['player']).map((role) => (
                        <span key={role} className='badge badge-gold'>
                            {t(`profile.role_${role}`, { defaultValue: role })}
                        </span>
                    ))}
                    {telegramMode && (
                        <span
                            className='badge'
                            style={{
                                background: 'rgba(37,99,235,0.15)',
                                color: '#60a5fa',
                                border: '1px solid rgba(59,130,246,0.25)',
                            }}
                        >
                            <Send
                                size={9}
                                style={{ display: 'inline', marginRight: 3 }}
                            />
                            Telegram
                        </span>
                    )}
                </div>
            </section>

            {/* ── Account stats ── */}
            <div className='profile-stats-grid'>
                <div className='profile-stat-card'>
                    <span className='profile-stat-label'>
                        {t('profile.accountStatus')}
                    </span>
                    <span
                        className='profile-stat-value'
                        style={{
                            fontSize: 14,
                            color:
                                user?.status === 'active'
                                    ? 'var(--green)'
                                    : 'var(--danger)',
                        }}
                    >
                        {t(`profile.status_${user?.status ?? 'active'}`, {
                            defaultValue: user?.status ?? 'active',
                        })}
                    </span>
                </div>
                <div className='profile-stat-card'>
                    <span className='profile-stat-label'>
                        {t('profile.lastLogin')}
                    </span>
                    <span
                        className='profile-stat-value'
                        style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--text-secondary)',
                        }}
                    >
                        {user?.lastLoginAt
                            ? new Date(user.lastLoginAt).toLocaleDateString(
                                  'en-GB',
                                  {
                                      timeZone: ETHIOPIA_TZ,
                                      month: 'short',
                                      day: 'numeric',
                                      hour: 'numeric',
                                      minute: '2-digit',
                                      hour12: true,
                                  },
                              )
                            : t('profile.thisSession')}
                    </span>
                </div>
            </div>

            {/* ── Phone number prompt ── */}
            {!user?.phoneNumber && !editing && (
                <div className='info-banner info-banner-gold'>
                    <Phone
                        size={18}
                        style={{
                            color: 'var(--gold)',
                            flexShrink: 0,
                            marginTop: 1,
                        }}
                    />
                    <div>
                        <p
                            style={{
                                fontWeight: 700,
                                marginBottom: 4,
                                fontSize: 13,
                            }}
                        >
                            {t('profile.addTelebirrTitle')}
                        </p>
                        <p style={{ fontSize: 12, lineHeight: 1.5 }}>
                            {t('profile.addTelebirrDesc')}
                        </p>
                        <button
                            className='btn btn-primary btn-sm'
                            style={{ marginTop: 10 }}
                            onClick={startEdit}
                        >
                            {t('profile.addPhoneNumber')}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Profile info ── */}
            <section className='card'>
                <div className='section-header'>
                    <div>
                        <div className='section-title'>
                            {t('profile.yourInfo')}
                        </div>
                        <p className='section-copy'>
                            {t('profile.yourInfoDesc')}
                        </p>
                    </div>
                    {!editing && (
                        <button
                            className='btn btn-secondary btn-sm'
                            onClick={startEdit}
                        >
                            <Edit3 size={13} style={{ marginRight: 4 }} />
                            {t('profile.edit')}
                        </button>
                    )}
                </div>

                {editing ? (
                    <div className='stack-sm' style={{ marginTop: 8 }}>
                        <label className='form-field'>
                            <span>{t('profile.displayNameLabel')}</span>
                            <input
                                className='input'
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder={t('profile.yourNamePlaceholder')}
                                maxLength={64}
                            />
                        </label>
                        <label className='form-field'>
                            <span>{t('profile.telebirrPhoneNumber')}</span>
                            <input
                                className='input'
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                placeholder={t('profile.phonePlaceholder')}
                                type='tel'
                            />
                        </label>
                        <div className='action-row' style={{ marginTop: 8 }}>
                            <button
                                className='btn btn-secondary'
                                onClick={cancelEdit}
                                disabled={saving}
                            >
                                <X size={14} style={{ marginRight: 4 }} />
                                {t('common.cancel')}
                            </button>
                            <button
                                className='btn btn-primary'
                                onClick={saveProfile}
                                disabled={saving}
                            >
                                <Check size={14} style={{ marginRight: 4 }} />
                                {saving
                                    ? t('profile.saving')
                                    : t('profile.saveChanges')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className='profile-info-list'>
                        <InfoRow
                            icon={<UserCircle size={16} />}
                            label={t('profile.displayNameLabel')}
                            value={user?.displayName}
                        />
                        <InfoRow
                            icon={<Phone size={16} />}
                            label={t('profile.telebirrPhone')}
                            value={user?.phoneNumber}
                            empty={t('profile.phoneNotSet')}
                        />
                        {user?.email && (
                            <InfoRow
                                icon={<Mail size={16} />}
                                label={t('profile.email')}
                                value={user.email}
                            />
                        )}
                    </div>
                )}
            </section>

            {/* ── Language ── */}
            <section className='card'>
                <div className='section-header' style={{ marginBottom: 10 }}>
                    <div className='section-title' style={{ fontSize: 14 }}>
                        {t('language.label')}
                    </div>
                </div>
                <LanguageSwitcher />
            </section>

            {/* ── Support entry ── */}
            <section className='card' style={{ padding: 0 }}>
                <button
                    className='btn btn-ghost btn-full'
                    onClick={() => onNavigate?.('support')}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 16px',
                    }}
                >
                    <span
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}
                    >
                        <LifeBuoy
                            size={18}
                            style={{ color: 'var(--accent)' }}
                        />
                        <span style={{ fontWeight: 600 }}>
                            {t('profile.helpAndSupport')}
                        </span>
                    </span>
                    <ChevronRight
                        size={16}
                        style={{ color: 'var(--text-muted)' }}
                    />
                </button>
            </section>

            {/* ── Telegram session info ── */}
            {telegramMode ? (
                <section className='card'>
                    <div className='section-header'>
                        <div>
                            <div
                                className='section-title'
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}
                            >
                                <Send size={14} style={{ color: '#60a5fa' }} />
                                {t('profile.session')}
                            </div>
                            <p className='section-copy'>
                                {t('profile.sessionManagedByTelegram')}
                            </p>
                        </div>
                    </div>
                    <button
                        className='btn btn-danger btn-full'
                        onClick={logout}
                        disabled={loggingOut}
                        style={{ marginTop: 4 }}
                    >
                        <LogOut size={14} style={{ marginRight: 6 }} />
                        {loggingOut
                            ? t('profile.endingSession')
                            : t('profile.endSession')}
                    </button>
                    <p
                        style={{
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            textAlign: 'center',
                            marginTop: 8,
                        }}
                    >
                        {t('profile.reopenViaTelegram')}
                    </p>
                </section>
            ) : (
                /* ── Security (standalone web only) ── */
                <section className='card'>
                    <div className='section-header'>
                        <div>
                            <div
                                className='section-title'
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}
                            >
                                <ShieldCheck
                                    size={15}
                                    style={{ color: 'var(--text-muted)' }}
                                />
                                {t('profile.security')}
                            </div>
                            <p className='section-copy'>
                                {t('profile.securityDesc')}
                            </p>
                        </div>
                    </div>
                    <div className='stack-sm'>
                        <label className='form-field'>
                            <span>{t('profile.currentPassword')}</span>
                            <input
                                className='input'
                                type='password'
                                autoComplete='current-password'
                                value={currentPassword}
                                onChange={(e) =>
                                    setCurrentPassword(e.target.value)
                                }
                            />
                        </label>
                        <label className='form-field'>
                            <span>{t('profile.newPassword')}</span>
                            <input
                                className='input'
                                type='password'
                                autoComplete='new-password'
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                        </label>
                        <div className='action-row' style={{ marginTop: 8 }}>
                            <button
                                className='btn btn-primary'
                                onClick={changePassword}
                                disabled={
                                    changingPassword ||
                                    !currentPassword ||
                                    !newPassword
                                }
                            >
                                <KeyRound
                                    size={14}
                                    style={{ marginRight: 4 }}
                                />
                                {changingPassword
                                    ? t('profile.changing')
                                    : t('profile.changePassword')}
                            </button>
                            <button
                                className='btn btn-danger'
                                onClick={logout}
                                disabled={loggingOut}
                            >
                                <LogOut size={14} style={{ marginRight: 4 }} />
                                {loggingOut
                                    ? t('profile.loggingOut')
                                    : t('profile.logoutBtn')}
                            </button>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}

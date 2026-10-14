import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { UserProfile, UserRole, AccountType, StaffPermissions } from '../../types';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Edit3,
  Filter,
  Key,
  Lock,
  Mail,
  Phone,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../App';

/**
 * `initialRole` — the overview's "Staff Members" tile opens this list showing
 * the people it counted ('team': staff and production), not every customer.
 */
export default function UserManagementAdmin({ initialRole }: { initialRole?: string } = {}) {
  const { user, t } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>(initialRole ?? 'all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modal State for Create / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    phone: '',
    password: '',
    role: 'staff' as UserRole,
    accountType: 'individual' as AccountType,
    companyName: '',
    taxNumber: '',
    status: 'active' as 'active' | 'suspended',
    loyaltyPoints: 0,
    permissions: {
      canManageCategories: true,
      canManageProducts: true,
      canManageOrders: true,
      canManageSiteCustomizer: true,
      canManagePrintSettings: false
    } as StaffPermissions
  });

  // Delete Confirmation Modal
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const data = snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));

      // Whatever is stored, exactly as stored. An empty collection used to be
      // filled in with six invented staff members — including a fake company and
      // a hardcoded main admin — which made the screen look populated on a shop
      // that had no users at all.
      setUsers(data);
    } catch (err) {
      console.warn('Error fetching users from Firestore:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // PAY ON DELIVERY — the customers he lets pay when the order arrives (client,
  // 2026-10-07: "not for the customers; an option where I pick the customer"). Kept
  // by the server, outside the customer's own profile, which the customer may write.
  const [onDelivery, setOnDelivery] = useState<Set<string> | null>(null);
  // Not loaded: the switches stay off-limits and SAY so — an empty list shown as
  // "everyone off" would hide a customer who still has it.
  const [onDeliveryFailed, setOnDeliveryFailed] = useState(false);
  const [onDeliveryBusy, setOnDeliveryBusy] = useState<string | null>(null);
  const adminFetch = async (path: string, init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    const resp = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error || `(${resp.status})`);
    return data;
  };
  useEffect(() => {
    let alive = true;
    adminFetch('/api/admin/customer-terms')
      .then((d) => alive && setOnDelivery(new Set(Array.isArray(d?.payOnDelivery) ? d.payOnDelivery : [])))
      .catch(() => alive && setOnDeliveryFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const togglePayOnDelivery = async (uid: string) => {
    const next = !onDelivery?.has(uid);
    setOnDeliveryBusy(uid);
    try {
      await adminFetch(`/api/admin/customer-terms/${encodeURIComponent(uid)}`, { method: 'POST', body: JSON.stringify({ payOnDelivery: next }) });
      setOnDelivery((prev) => {
        const out = new Set(prev ?? []);
        if (next) out.add(uid);
        else out.delete(uid);
        return out;
      });
    } catch (err: any) {
      setErrorMessage(String(err?.message ?? err));
    } finally {
      setOnDeliveryBusy(null);
    }
  };

  const handleOpenCreateModal = () => {
    setEditingUser(null);
    setFormData({
      displayName: '',
      email: '',
      phone: '',
      password: '',
      role: 'staff',
      accountType: 'individual',
      companyName: '',
      taxNumber: '',
      status: 'active',
      loyaltyPoints: 0,
      permissions: {
        canManageCategories: true,
        canManageProducts: true,
        canManageOrders: true,
        canManageSiteCustomizer: true,
        canManagePrintSettings: false
      }
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (user: UserProfile) => {
    setEditingUser(user);
    setFormData({
      displayName: user.displayName || '',
      email: user.email || '',
      phone: user.phone || '',
      password: '',
      role: user.role,
      accountType: user.accountType || 'individual',
      companyName: user.companyName || '',
      taxNumber: user.taxNumber || '',
      status: user.status || 'active',
      loyaltyPoints: user.loyaltyPoints || 0,
      // An account with no stored permissions has none, so the boxes open empty.
      // Falling back to four trues here meant opening an existing member and
      // pressing Save handed them every permission the form offers, whether or
      // not the owner had touched a single box.
      permissions: user.permissions || {}
    });
    setIsModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.displayName || !formData.email) {
      alert(t('umNameEmailRequired'));
      return;
    }

    setSaving(true);
    try {
      // A NEW account has to be created by the server: only the Admin SDK can make
      // a Firebase Auth account, and without one the person can never sign in. This
      // used to invent an id ('usr_' + a timestamp) and write a profile document
      // that corresponded to no real identity, with the password thrown away.
      if (!editingUser) {
        const idToken = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken ?? ''}` },
          body: JSON.stringify({
            email: formData.email.toLowerCase().trim(),
            displayName: formData.displayName,
            password: formData.password,
            role: formData.role,
            phone: formData.phone,
            accountType: formData.accountType,
            companyName: formData.accountType === 'business' ? formData.companyName : '',
            taxNumber: formData.accountType === 'business' ? formData.taxNumber : '',
            status: formData.status,
            loyaltyPoints: Number(formData.loyaltyPoints) || 0,
            permissions: (formData.role === 'staff' || formData.role === 'production') ? formData.permissions : null,
          }),
        });
        const result = await res.json().catch(() => null);
        if (!res.ok) {
          alert(result?.error || t('umSaveFailed'));
          setSaving(false);
          return;
        }
        // An address that already had an account comes back as THAT account, with
        // only its role, permissions and status changed (the server leaves its
        // password and profile alone): its row is updated, never listed twice.
        const saved = result.user as UserProfile;
        setUsers(prev => prev.some(u => u.uid === result.uid)
          ? prev.map(u => u.uid === result.uid ? { ...u, ...saved } : u)
          : [saved, ...prev]);
        setSuccessMessage(result.existed === true
          ? t('umExisted').replace('{0}', saved.displayName || formData.displayName)
          : t('umCreated').replace('{0}', formData.displayName));
        setIsModalOpen(false);
        setTimeout(() => setSuccessMessage(null), 4000);
        setSaving(false);
        return;
      }

      const uid = editingUser.uid;
      const userPayload: UserProfile = {
        uid,
        displayName: formData.displayName,
        email: formData.email.toLowerCase().trim(),
        phone: formData.phone,
        role: formData.role,
        accountType: formData.accountType,
        companyName: formData.accountType === 'business' ? formData.companyName : undefined,
        taxNumber: formData.accountType === 'business' ? formData.taxNumber : undefined,
        status: formData.status,
        loyaltyPoints: Number(formData.loyaltyPoints) || 0,
        permissions: (formData.role === 'staff' || formData.role === 'production') ? formData.permissions : undefined,
        createdAt: editingUser?.createdAt || new Date().toISOString().split('T')[0]
      };

      // Firestore rejects fields whose value is `undefined` (companyName/taxNumber for
      // non-business accounts, permissions for non-staff roles). Strip them before the
      // write so saving a user never throws.
      const firestorePayload = Object.fromEntries(
        Object.entries(userPayload).filter(([, v]) => v !== undefined)
      );
      await setDoc(doc(db, 'users', uid), firestorePayload, { merge: true });

      setUsers(prev => prev.map(u => u.uid === uid ? userPayload : u));
      setSuccessMessage(t('umUpdated').replace('{0}', formData.displayName));

      setIsModalOpen(false);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error('Error saving user profile:', err);
      alert(t('umSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleQuickRoleChange = async (uid: string, newRole: UserRole) => {
    try {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { role: newRole }, { merge: true });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    } catch (err) {
      console.error('Error updating role:', err);
      // Without this the control simply sprang back and nobody knew the
      // change had been refused.
      setErrorMessage(t('umChangeFailed'));
    }
  };

  const handleQuickStatusToggle = async (uid: string, currentStatus: 'active' | 'suspended') => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { status: nextStatus }, { merge: true });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status: nextStatus } : u));
    } catch (err) {
      console.error('Error toggling status:', err);
      // Without this the control simply sprang back and nobody knew the
      // change had been refused.
      setErrorMessage(t('umChangeFailed'));
    }
  };

  const handleTogglePermission = async (uid: string, permKey: keyof StaffPermissions) => {
    const targetUser = users.find(u => u.uid === uid);
    if (!targetUser) return;

    // Write the ONE key this chip names and nothing else. It used to rebuild the
    // whole map from a fallback that invented four granted permissions for any
    // account that had none — so clicking "Orders" on a customer just promoted
    // through the Role dropdown (which writes { role: 'staff' } alone) quietly
    // granted Categories, Products and Appearance along with it. A merged write
    // folds a nested map key by key, so the stored siblings survive untouched.
    const nextValue = targetUser.permissions?.[permKey] !== true;
    const updatedPerms: StaffPermissions = { ...targetUser.permissions, [permKey]: nextValue };

    try {
      await setDoc(doc(db, 'users', uid), { permissions: { [permKey]: nextValue } }, { merge: true });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, permissions: updatedPerms } : u));
    } catch (err) {
      console.error('Error toggling permission:', err);
      // Without this the control simply sprang back and nobody knew the
      // change had been refused.
      setErrorMessage(t('umChangeFailed'));
    }
  };

  const handleDeleteUserConfirm = async () => {
    if (!userToDelete) return;
    if (
      userToDelete.uid === user?.uid ||
      (userToDelete.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1)
    ) {
      setErrorMessage(t('umProtectedAccount'));
      setUserToDelete(null);
      return;
    }
    // Deleting the Firestore profile from here left the Firebase Auth account
    // intact, so the person could still sign in and the app simply rebuilt their
    // profile as a customer. Only the server can remove the login itself.
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userToDelete.uid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken ?? ''}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'That account could not be deleted.');

      setUsers(prev => prev.filter(u => u.uid !== userToDelete.uid));
      setSuccessMessage(t('umDeleted').replace('{0}', userToDelete.displayName));
      setUserToDelete(null);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      console.error('Error deleting user:', err);
      setErrorMessage(err?.message || t('umDeleteFailed'));
      setUserToDelete(null);
    }
  };

  // Filtered Users
  const filteredUsers = users.filter(u => {
    const matchesSearch = 
      (u.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.companyName || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole = roleFilter === 'all'
      || (roleFilter === 'team' ? u.role === 'staff' || u.role === 'production' : u.role === roleFilter);
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;

    return matchesSearch && matchesRole && matchesStatus;
  });

  // An admin must never delete their own account, and the last remaining admin
  // must never be deletable — otherwise the shop is left with no administrator.
  const adminCount = users.filter(u => u.role === 'admin').length;
  const canDeleteUser = (u: UserProfile) =>
    u.uid !== user?.uid && !(u.role === 'admin' && adminCount <= 1);

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-sm space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <div className="inline-flex items-center space-x-1.5 text-xs font-black text-orange-600 bg-orange-50 px-3 py-1 rounded-full border border-orange-200/80 mb-2">
            <Users className="w-3.5 h-3.5 mr-1" />
            <span>Users & Staff Management</span>
          </div>
          <h2 className="text-2xl font-black text-gray-900">
            {t('umTitle')}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {t('umSubtitle')}
          </p>
        </div>

        {/* Create New User Button */}
        <button
          onClick={handleOpenCreateModal}
          className="bg-orange-600 hover:bg-orange-500 text-white font-black px-5 py-3 rounded-2xl shadow-lg shadow-orange-600/30 flex items-center space-x-2 transition-all active:scale-95 cursor-pointer text-xs"
        >
          <UserPlus className="w-4 h-4 ml-1" />
          <span>Create User/Staff</span>
        </button>
      </div>

      {/* Success Notification Banner */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl flex items-center justify-between text-xs font-bold"
          >
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-700">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Failure banner — deleting or saving a user can fail on permissions, and
          silence there reads as success. */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            role="alert"
            className="p-4 bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl flex items-center justify-between text-xs font-bold"
          >
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="p-1 hover:bg-amber-100 rounded-lg text-amber-700">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search & Filter Controls */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-gray-50/80 p-4 rounded-2xl border border-gray-200/80">
        {/* Search */}
        <div className="md:col-span-6 relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('umSearchPlaceholder')}
            className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold text-gray-900 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Role Filter */}
        <div className="md:col-span-3">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-bold text-gray-900 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Roles</option>
            <option value="team">{t('umRoleTeam')}</option>
            <option value="admin">{t('umRoleAdmin')}</option>
            <option value="staff">{t('umRoleStaff')}</option>
            <option value="production">{t('umRoleProduction')}</option>
            <option value="client">{t('umRoleClient')}</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="md:col-span-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-bold text-gray-900 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Statuses</option>
            <option value="active">{t('umActive')}</option>
            <option value="suspended">{t('umSuspended')}</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto border border-gray-200/90 rounded-2xl shadow-sm">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="bg-gray-100/80 text-gray-700 font-black border-b border-gray-200">
              <th className="p-3.5">{t('umColUser')}</th>
              <th className="p-3.5">{t('umColAccountType')}</th>
              <th className="p-3.5">{t('umColRole')}</th>
              <th className="p-3.5">Staff Permissions</th>
              <th className="p-3.5">{t('umColStatus')}</th>
              <th className="p-3.5 text-center">{t('umColActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 font-semibold text-gray-800">
            {filteredUsers.map((u) => {
              const isStaffOrProd = u.role === 'staff' || u.role === 'production';
              // No stored map means no permissions, and a stored map that omits a
              // key means that key is not granted. This used to fall back to four
              // trues and the chips below asked `!== false`, so a customer just
              // promoted with the Role dropdown showed four green chips while the
              // staff dashboard — which asks `=== true` — let them into nothing.
              const perms: StaffPermissions = u.permissions || {};

              return (
                <tr key={u.uid} className="hover:bg-gray-50/80 transition-colors">
                  {/* User Name & Email */}
                  <td className="p-3.5">
                    <div className="font-extrabold text-gray-900 flex items-center space-x-2">
                      <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 font-black flex items-center justify-center shrink-0 ml-2">
                        {u.displayName ? u.displayName.charAt(0).toUpperCase() : 'U'}
                      </div>
                      <div>
                        <span className="block">{u.displayName}</span>
                        <span className="text-[0.6875rem] text-gray-400 font-mono block" dir="ltr">{u.email}</span>
                        {u.phone && <span className="text-[0.625rem] text-gray-500 font-mono block" dir="ltr">{u.phone}</span>}
                      </div>
                    </div>
                  </td>

                  {/* Account Type */}
                  <td className="p-3.5">
                    {u.accountType === 'business' ? (
                      <span className="px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200/80 rounded-lg text-[0.6875rem] font-bold inline-flex items-center">
                        <Building2 className="w-3 h-3 ml-1" />
                        {u.companyName || t('umBusiness')}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-gray-100 text-gray-700 border border-gray-200/80 rounded-lg text-[0.6875rem] font-bold inline-flex items-center">
                        <User className="w-3 h-3 ml-1" />
                        {t('umIndividual')}
                      </span>
                    )}
                  </td>

                  {/* Role Dropdown */}
                  <td className="p-3.5">
                    <select
                      value={u.role}
                      onChange={(e) => handleQuickRoleChange(u.uid, e.target.value as UserRole)}
                      className={cn(
                        "px-2.5 py-1.5 border rounded-xl font-extrabold text-xs outline-none cursor-pointer",
                        u.role === 'admin' && "bg-amber-50 text-amber-800 border-amber-300",
                        u.role === 'staff' && "bg-blue-50 text-blue-800 border-blue-300",
                        u.role === 'production' && "bg-emerald-50 text-emerald-800 border-emerald-300",
                        u.role === 'client' && "bg-gray-50 text-gray-800 border-gray-300"
                      )}
                    >
                      <option value="client">Client</option>
                      <option value="staff">Staff</option>
                      <option value="production">Production</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>

                  {/* Permissions Chips */}
                  <td className="p-3.5">
                    {isStaffOrProd ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-[0.625rem]">
                        <button
                          type="button"
                          onClick={() => handleTogglePermission(u.uid, 'canManageCategories')}
                          className={cn(
                            "px-2 py-0.5 rounded-md font-bold border transition-all",
                            perms.canManageCategories === true
                              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                              : "bg-gray-50 text-gray-400 border-gray-200 line-through"
                          )}
                        >
                           {t('umTagCategories')}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTogglePermission(u.uid, 'canManageProducts')}
                          className={cn(
                            "px-2 py-0.5 rounded-md font-bold border transition-all",
                            perms.canManageProducts === true
                              ? "bg-blue-50 text-blue-700 border-blue-300"
                              : "bg-gray-50 text-gray-400 border-gray-200 line-through"
                          )}
                        >
                           {t('umTagProducts')}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTogglePermission(u.uid, 'canManageOrders')}
                          className={cn(
                            "px-2 py-0.5 rounded-md font-bold border transition-all",
                            perms.canManageOrders === true
                              ? "bg-purple-50 text-purple-700 border-purple-300"
                              : "bg-gray-50 text-gray-400 border-gray-200 line-through"
                          )}
                        >
                           {t('umTagOrders')}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTogglePermission(u.uid, 'canManageSiteCustomizer')}
                          className={cn(
                            "px-2 py-0.5 rounded-md font-bold border transition-all",
                            perms.canManageSiteCustomizer === true
                              ? "bg-amber-50 text-amber-700 border-amber-300"
                              : "bg-gray-50 text-gray-400 border-gray-200 line-through"
                          )}
                        >
                           {t('umTagAppearance')}
                        </button>
                      </div>
                    ) : u.role === 'admin' ? (
                      <span className="text-[0.6875rem] font-black text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                        {t('umTagFullAdmin')}
                      </span>
                    ) : u.role === 'client' ? (
                      // Pay on delivery, for this customer only — off for everyone until he ticks it.
                      onDeliveryFailed ? (
                        <span className="text-[0.625rem] font-bold text-amber-700" data-rx-pay-on-delivery-failed>{t('umPayOnDeliveryFailed')}</span>
                      ) : (
                      <button
                        type="button"
                        disabled={onDelivery === null || onDeliveryBusy === u.uid}
                        onClick={() => void togglePayOnDelivery(u.uid)}
                        title={t('umPayOnDeliveryHint')}
                        aria-pressed={onDelivery?.has(u.uid) === true}
                        data-rx-pay-on-delivery-switch={u.uid}
                        className={cn(
                          'px-2 py-0.5 rounded-md text-[0.625rem] font-bold border transition-all disabled:opacity-50',
                          onDelivery?.has(u.uid)
                            ? 'bg-sky-50 text-sky-700 border-sky-300'
                            : 'bg-gray-50 text-gray-400 border-gray-200 line-through',
                        )}
                      >
                        {t('umPayOnDelivery')}
                      </button>
                      )
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="p-3.5">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-[0.6875rem] font-extrabold",
                      u.status === 'active' ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    )}>
                      {u.status === 'active' ? t('umActive') : t('umSuspended')}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="p-3.5 text-center">
                    <div className="flex items-center justify-center space-x-2 space-x-reverse">
                      <button
                        onClick={() => handleOpenEditModal(u)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                        title={t('umEditUser')}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleQuickStatusToggle(u.uid, u.status)}
                        className={cn(
                          "px-2 py-1 text-[0.625rem] font-bold rounded-lg transition-colors",
                          u.status === 'active' ? "bg-rose-50 text-rose-600 hover:bg-rose-100" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                        )}
                      >
                        {u.status === 'active' ? t('umSuspendAction') : t('umActivateAction')}
                      </button>

                      {canDeleteUser(u) && (
                        <button
                          onClick={() => setUserToDelete(u)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                          title={t('umDeleteUser')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredUsers.length === 0 && (
          <div className="p-10 text-center text-gray-500 space-y-2">
            <Users className="w-10 h-10 mx-auto text-gray-300" />
            <p className="font-bold text-xs">{t('umNoResults')}</p>
          </div>
        )}
      </div>

      {/* CREATE / EDIT USER MODAL */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-2xl space-y-6 border border-gray-200 text-right"
              dir="rtl"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div>
                  <h3 className="text-xl font-black text-gray-900">
                    {editingUser ? t('umModalEditTitle') : t('umModalCreateTitle')}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {t('umModalSubtitle')}
                  </p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveUser} className="space-y-4">
                {/* Full Name & Email */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('umFullName')}</label>
                    <input
                      type="text"
                      required
                      value={formData.displayName}
                      onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                      placeholder={t('umNamePlaceholder')}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('umEmail')}</label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="name@company.com"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Phone & Initial Password */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+46 70 123 4567"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      dir="ltr"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('umInitialPassword')}</label>
                    <input
                      type="text"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder={t('umPasswordNote')}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>

                {/* Role & Account Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('umRoleLabel')}</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                    >
                      <option value="staff">{t('umRoleStaffLong')}</option>
                      <option value="production">{t('umRoleProductionLong')}</option>
                      <option value="admin">{t('umRoleAdminLong')}</option>
                      <option value="client">{t('umRoleClientLong')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Account Type</label>
                    <select
                      value={formData.accountType}
                      onChange={(e) => setFormData({ ...formData, accountType: e.target.value as AccountType })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                    >
                      <option value="individual">{t('umIndividualAccount')}</option>
                      <option value="business">Business B2B</option>
                    </select>
                  </div>
                </div>

                {/* B2B Company Details if Business */}
                {formData.accountType === 'business' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-purple-50/60 rounded-2xl border border-purple-200/80">
                    <div>
                      <label className="block text-xs font-black text-purple-900 mb-1">Company Name</label>
                      <input
                        type="text"
                        value={formData.companyName}
                        onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                        placeholder={t('umCompanyPlaceholder')}
                        className="w-full px-3 py-2 border border-purple-200 rounded-xl text-xs font-bold bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-purple-900 mb-1">Tax Number</label>
                      <input
                        type="text"
                        value={formData.taxNumber}
                        onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                        placeholder="SE5561234567"
                        className="w-full px-3 py-2 border border-purple-200 rounded-xl text-xs font-bold bg-white"
                        dir="ltr"
                      />
                    </div>
                  </div>
                )}

                {/* Status & Loyalty Points */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('umStatusLabel')}</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'suspended' })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                    >
                      <option value="active">{t('umActive')}</option>
                      <option value="suspended">{t('umSuspended')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Loyalty Points</label>
                    <input
                      type="number"
                      value={formData.loyaltyPoints}
                      onChange={(e) => setFormData({ ...formData, loyaltyPoints: Number(e.target.value) })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>

                {/* Staff Granular Permissions Checklist */}
                {(formData.role === 'staff' || formData.role === 'production') && (
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
                    <h4 className="text-xs font-black text-gray-900 flex items-center">
                      <ShieldCheck className="w-4 h-4 ml-1.5 text-orange-600" />
                      {t('umPermissionsTitle')}
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-bold text-gray-700">
                      <label className="flex items-center space-x-2 space-x-reverse cursor-pointer p-2 bg-white rounded-xl border border-gray-200 hover:bg-orange-50/50">
                        <input
                          type="checkbox"
                          checked={formData.permissions.canManageCategories === true}
                          onChange={(e) => setFormData({
                            ...formData,
                            permissions: { ...formData.permissions, canManageCategories: e.target.checked }
                          })}
                          className="w-4 h-4 text-orange-600 rounded"
                        />
                        <span>{t('umPermCategories')}</span>
                      </label>

                      <label className="flex items-center space-x-2 space-x-reverse cursor-pointer p-2 bg-white rounded-xl border border-gray-200 hover:bg-orange-50/50">
                        <input
                          type="checkbox"
                          checked={formData.permissions.canManageProducts === true}
                          onChange={(e) => setFormData({
                            ...formData,
                            permissions: { ...formData.permissions, canManageProducts: e.target.checked }
                          })}
                          className="w-4 h-4 text-orange-600 rounded"
                        />
                        <span>{t('umPermProducts')}</span>
                      </label>

                      <label className="flex items-center space-x-2 space-x-reverse cursor-pointer p-2 bg-white rounded-xl border border-gray-200 hover:bg-orange-50/50">
                        <input
                          type="checkbox"
                          checked={formData.permissions.canManageOrders === true}
                          onChange={(e) => setFormData({
                            ...formData,
                            permissions: { ...formData.permissions, canManageOrders: e.target.checked }
                          })}
                          className="w-4 h-4 text-orange-600 rounded"
                        />
                        <span>{t('umPermOrders')}</span>
                      </label>

                      <label className="flex items-center space-x-2 space-x-reverse cursor-pointer p-2 bg-white rounded-xl border border-gray-200 hover:bg-orange-50/50">
                        <input
                          type="checkbox"
                          checked={formData.permissions.canManageSiteCustomizer === true}
                          onChange={(e) => setFormData({
                            ...formData,
                            permissions: { ...formData.permissions, canManageSiteCustomizer: e.target.checked }
                          })}
                          className="w-4 h-4 text-orange-600 rounded"
                        />
                        <span>UI Customizer</span>
                      </label>

                      {/* The "technical rules and print settings" toggle was removed: it wrote
                        canManagePrintSettings and canManagePrintingFields to the account and
                        no screen ever read either one, so ticking or clearing it changed
                        nothing at all. Bring it back with the screen it is supposed to
                        control, not before.

                        The "Printing Fields" checkbox is gone for the same reason: it saved
                        canManagePrintingFields, but the printing-fields editor only exists
                        inside the admin dashboard, and the staff dashboard never looks at the
                        flag — so the owner was granting an access that no screen enforced.
                        It can come back alongside a staff-reachable screen that reads it. */}
                    </div>
                  </div>
                )}

                {/* Modal Action Buttons */}
                <div className="flex items-center justify-end space-x-3 space-x-reverse pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50"
                  >
                    {t('umCancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-black rounded-xl shadow-md flex items-center space-x-2 space-x-reverse disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? (
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>{editingUser ? t('umSaveChanges') : t('umCreateAccount')}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE CONFIRMATION MODAL */}
      <AnimatePresence>
        {userToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-right"
              dir="rtl"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-lg font-black text-gray-900">{t('umConfirmDeleteTitle')}</h3>
                <p className="text-xs text-gray-500">
                  {t('umConfirmDeleteBody').replace('{0}', userToDelete.displayName)}
                </p>
              </div>

              <div className="flex items-center justify-center space-x-3 space-x-reverse pt-2">
                <button
                  onClick={() => setUserToDelete(null)}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50"
                >
                  {t('umCancel')}
                </button>
                <button
                  onClick={handleDeleteUserConfirm}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black rounded-xl shadow-md"
                >
                  {t('umConfirmDelete')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

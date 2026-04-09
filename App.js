/**
 * UA Clinic Appointment System (Frontend)
 *
 * What this file contains:
 * - UI for Login + Registration (student/patient accounts)
 * - UI for creating appointments (student)
 * - UI for reviewing/confirming/cancelling appointments (staff)
 * - Calls to the Django/DRF backend (JWT auth)
 * - "Decrypt" flow:
 *   Backend returns AES-encrypted `reason`/`notes` by default.
 *   A special endpoint `/api/appointments/{id}/decrypt/` returns plaintext
 *   for the owner or staff so the user can read it and generate a ticket.
 * - PDF "Ticket" generation using `jsPDF` (works on web; on native devices
 *   PDF download behavior depends on platform/permissions)
 *
 * Key env vars:
 * - EXPO_PUBLIC_API_BASE_URL: backend base URL (Render)
 * - EXPO_PUBLIC_UA_LOGO_URI: optional logo URL for the header
 */

import axios from 'axios';
import { StatusBar } from 'expo-status-bar';
import { jsPDF } from 'jspdf';
import { useEffect, useMemo, useState } from 'react';
import { Picker } from '@react-native-picker/picker';
import {
  Animated,
  Button,
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

// Public config resolution order:
// 1) Runtime-injected values from the Railway Node server (window.__EXPO_PUBLIC_*)
// 2) Build-time inlined Expo vars (process.env.EXPO_PUBLIC_*)
// 3) Hardcoded fallback (old Render URL)
const RUNTIME_API_BASE_URL =
  (typeof window !== 'undefined' && window.__EXPO_PUBLIC_API_BASE_URL) || '';
const RUNTIME_UA_LOGO_URI =
  (typeof window !== 'undefined' && window.__EXPO_PUBLIC_UA_LOGO_URI) || '';

let API_BASE_URL = RUNTIME_API_BASE_URL || 'https://aes-backend-ggxi.onrender.com';
let UA_LOGO_URI = RUNTIME_UA_LOGO_URI || '';

try {
  if (!API_BASE_URL && process.env.EXPO_PUBLIC_API_BASE_URL) {
    API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
  }
  if (!UA_LOGO_URI && process.env.EXPO_PUBLIC_UA_LOGO_URI) {
    UA_LOGO_URI = process.env.EXPO_PUBLIC_UA_LOGO_URI;
  }
} catch (e) {
  // `process` may be undefined in some web runtimes; keep runtime/fallback.
}

function joinUrl(base, path) {
  // Simple URL join helper (avoids accidental double slashes).
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '').startsWith('/') ? String(path || '') : `/${path}`;
  return `${b}${p}`;
}

function formatIsoForSticker(iso) {
  if (!iso || typeof iso !== 'string') return '—';
  // Keep it simple and consistent with the backend: show UTC.
  // Example: "2026-04-07T07:00:00Z" -> "2026-04-07 07:00 UTC"
  const ymd = iso.slice(0, 10);
  const hhmm = iso.length >= 16 ? iso.slice(11, 16) : '';
  if (!ymd || !hhmm) return iso;
  return `${ymd} ${hhmm} UTC`;
}

function hexToRgb(hex) {
  // jsPDF expects RGB components for some APIs; our theme uses hex colors.
  const h = String(hex || '').replace('#', '').trim();
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return {
    r: Number.isFinite(r) ? r : 0,
    g: Number.isFinite(g) ? g : 0,
    b: Number.isFinite(b) ? b : 0,
  };
}

function downloadAppointmentStickerPdf({
  fullName,
  scheduledForIso,
  reason,
  notes,
  appointmentId,
  generatedAtIso,
}) {
  // Generate an A4 PDF with a UA-branded ticket layout.
  // This runs fully client-side; no server-side PDF generation is required.
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;

  const boxX = margin;
  const boxY = margin;
  const boxW = pageWidth - margin * 2;
  const boxH = 380;

  const primary = hexToRgb(THEME.colors.primary);
  const accent = hexToRgb(THEME.colors.accent);
  const border = hexToRgb(THEME.colors.borderStrong);
  const muted = hexToRgb(THEME.colors.muted);

  // Header bar
  doc.setFillColor(primary.r, primary.g, primary.b);
  doc.roundedRect(boxX, boxY, boxW, 54, 12, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('UA CLINIC', boxX + 16, boxY + 32);
  doc.setFontSize(12);
  doc.text('Appointment Ticket', boxX + 110, boxY + 32);

  // Confirmed badge
  const badgeText = 'CONFIRMED APPOINTMENT';
  doc.setFontSize(10);
  const badgePaddingX = 10;
  const badgeW = doc.getTextWidth(badgeText) + badgePaddingX * 2;
  const badgeH = 18;
  const badgeX = boxX + boxW - badgeW - 16;
  const badgeY = boxY + 18;
  doc.setFillColor(accent.r, accent.g, accent.b);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 9, 9, 'F');
  doc.setTextColor(11, 31, 59);
  doc.text(badgeText, badgeX + badgePaddingX, badgeY + 13);

  // Main box
  doc.setDrawColor(border.r, border.g, border.b);
  doc.setLineWidth(1);
  doc.roundedRect(boxX, boxY + 66, boxW, boxH, 12, 12, 'S');

  doc.setTextColor(0, 0, 0);
  const labelX = boxX + 18;
  const valueX = boxX + 165;
  let y = boxY + 96;

  function row(label, value) {
    // Helper to render a label/value row and automatically wrap long values.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(muted.r, muted.g, muted.b);
    doc.text(label, labelX, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    const text = String(value || '—');
    const lines = doc.splitTextToSize(text, boxW - (valueX - boxX) - 18);
    doc.text(lines, valueX, y);
    y += Math.max(18, lines.length * 14) + 10;
  }

  row('Full Name', fullName);
  row('Appointment Time', formatIsoForSticker(scheduledForIso));
  row('Reason', reason);
  row('Notes', notes || '—');
  row('Appointment ID', appointmentId ? String(appointmentId) : '—');
  row('Generated', formatIsoForSticker(generatedAtIso));

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(muted.r, muted.g, muted.b);
  doc.text('Please present this ticket at the clinic.', boxX, boxY + 66 + boxH + 28);
  doc.text('All times are shown in UTC.', boxX, boxY + 66 + boxH + 44);
  doc.text(`Generated by UA Clinic Appointment System`, boxX, pageHeight - 32);

  const safeName = String(fullName || 'appointment').replace(/[^a-z0-9_-]+/gi, '_');
  const safeDate = String(scheduledForIso || '').slice(0, 10) || 'date';
  doc.save(`UA-Clinic-Ticket-${safeName}-${safeDate}.pdf`);
}

const THEME = {
  colors: {
    bg: '#f5f7fb',
    surface: '#ffffff',
    text: '#0b1f3b',
    muted: '#5b6b84',
    border: '#e5e7eb',
    borderStrong: '#d1d5db',
    primary: '#0b3b8c',
    primaryText: '#ffffff',
    accent: '#f5b301',
    dangerBg: '#fdecea',
    dangerBorder: '#f5c2c0',
    dangerText: '#8a1f17',
    successBg: '#e6f7e6',
    successText: '#14532d',
  },
  radius: {
    sm: 10,
    md: 14,
  },
};

function UiButton({
  title,
  onPress,
  disabled,
  variant = 'primary',
  style,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' ? styles.btnPrimary : null,
        variant === 'secondary' ? styles.btnSecondary : null,
        variant === 'ghost' ? styles.btnGhost : null,
        disabled ? styles.btnDisabled : null,
        pressed && !disabled ? styles.btnPressed : null,
        style,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === 'primary' ? styles.btnTextPrimary : null,
          variant !== 'primary' ? styles.btnTextSecondary : null,
          disabled ? styles.btnTextDisabled : null,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function FadeSlideIn({ children, style }) {
  const opacity = useMemo(() => new Animated.Value(0), []);
  const translateY = useMemo(() => new Animated.Value(10), []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View
      style={[
        { opacity, transform: [{ translateY }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

function Field({ label, children, hint }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

function AccountDetails({ me, emailFallback }) {
  const isStaff = !!me?.is_staff;
  const fullName = `${me?.first_name || ''} ${me?.last_name || ''}`.trim();
  const header = fullName || me?.email || emailFallback || 'Account';
  return (
    <View style={styles.accountCard}>
      <View style={styles.accountHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.accountTitle}>{header}</Text>
          <Text style={styles.accountSub}>{isStaff ? 'Staff' : 'Student'}</Text>
        </View>
        <View style={[styles.badge, isStaff ? styles.badgeStaff : styles.badgeStudent]}>
          <Text style={[styles.badgeText, isStaff ? styles.badgeTextStaff : styles.badgeTextStudent]}>
            {isStaff ? 'STAFF' : 'STUDENT'}
          </Text>
        </View>
      </View>

      <View style={styles.accountGrid}>
        <View style={styles.accountCell}>
          <Text style={styles.accountLabel}>Email</Text>
          <Text style={styles.accountValue}>{me?.email || emailFallback || '—'}</Text>
        </View>
        <View style={styles.accountCell}>
          <Text style={styles.accountLabel}>Username</Text>
          <Text style={styles.accountValue}>{me?.username || '—'}</Text>
        </View>
        <View style={styles.accountCell}>
          <Text style={styles.accountLabel}>School ID</Text>
          <Text style={styles.accountValue}>{me?.school_id || '—'}</Text>
        </View>
        <View style={styles.accountCell}>
          <Text style={styles.accountLabel}>Contact</Text>
          <Text style={styles.accountValue}>{me?.contact_number || '—'}</Text>
        </View>
      </View>
    </View>
  );
}

export default function App() {
  // --- Auth/UI mode state -------------------------------------------------
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [showAppointments, setShowAppointments] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);

  const [rememberMe, setRememberMe] = useState(true);

  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthday, setBirthday] = useState(''); // YYYY-MM-DD
  const [schoolId, setSchoolId] = useState('');
  const [contactNumber, setContactNumber] = useState('');

  const [token, setToken] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [appointments, setAppointments] = useState([]);
  const [accounts, setAccounts] = useState([]);

  // Map<appointmentId, {reason, notes}> holding plaintext after decrypt calls.
  // We keep this separate from `appointments` so the list can safely display
  // encrypted text by default.
  const [decryptedById, setDecryptedById] = useState(() => new Map());
  const DAILY_CAPACITY = Number(
    (typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_DAILY_CAPACITY) ||
      10,
  );
  const HOURLY_CAPACITY = 5;

  const [calendarCursor, setCalendarCursor] = useState(() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  });

  const [selectedDateYmd, setSelectedDateYmd] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const timeOptions = useMemo(() => buildTimeOptions(), []);
  const [selectedTime, setSelectedTime] = useState(() => timeOptions[0]?.value || '07:00');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const scheduledForIso = useMemo(() => {
    if (!selectedDateYmd || !selectedTime) return '';
    // Treat user-selected time as UTC to match backend timezone (UTC).
    const d = new Date(`${selectedDateYmd}T${selectedTime}:00Z`);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }, [selectedDateYmd, selectedTime]);

  const bookedCountByDate = useMemo(() => {
    const map = new Map();
    for (const appt of appointments || []) {
      const ymd = typeof appt?.scheduled_for === 'string' ? appt.scheduled_for.slice(0, 10) : '';
      if (!ymd) continue;
      map.set(ymd, (map.get(ymd) || 0) + 1);
    }
    return map;
  }, [appointments]);

  const staffConfirmedAppointments = useMemo(() => {
    return (appointments || []).filter((appt) => {
      const status = String(appt?.status || '').trim().toLowerCase();
      return status === 'confirmed';
    });
  }, [appointments]);

  const confirmedCountByYmdHour = useMemo(() => {
    // Keyed by "YYYY-MM-DD HH:MM" (UTC)
    const map = new Map();
    for (const appt of staffConfirmedAppointments || []) {
      const iso = typeof appt?.scheduled_for === 'string' ? appt.scheduled_for : '';
      if (!iso || iso.length < 16) continue;
      const ymd = iso.slice(0, 10);
      const hhmm = iso.slice(11, 16);
      const key = `${ymd} ${hhmm}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [staffConfirmedAppointments]);

  const staffInboxAppointments = useMemo(() => {
    // Staff "Appointments" view acts like an inbox: pending/cancelled only.
    // Confirmed appointments move to the calendar view.
    return (appointments || []).filter((appt) => {
      const status = String(appt?.status || '').trim().toLowerCase();
      return status !== 'confirmed';
    });
  }, [appointments]);

  const bookedCountByDateConfirmed = useMemo(() => {
    const map = new Map();
    for (const appt of staffConfirmedAppointments) {
      const ymd = typeof appt?.scheduled_for === 'string' ? appt.scheduled_for.slice(0, 10) : '';
      if (!ymd) continue;
      map.set(ymd, (map.get(ymd) || 0) + 1);
    }
    return map;
  }, [staffConfirmedAppointments]);

  const staffAppointmentsForSelectedDate = useMemo(() => {
    const ymd = selectedDateYmd;
    const items = staffConfirmedAppointments.filter((appt) => {
      const apptYmd = typeof appt?.scheduled_for === 'string' ? appt.scheduled_for.slice(0, 10) : '';
      return apptYmd === ymd;
    });
    items.sort((a, b) => String(a?.scheduled_for || '').localeCompare(String(b?.scheduled_for || '')));
    return items;
  }, [staffConfirmedAppointments, selectedDateYmd]);

  const myAppointmentsForSelectedDate = useMemo(() => {
    const ymd = selectedDateYmd;
    const items = (appointments || []).filter((appt) => {
      const apptYmd = typeof appt?.scheduled_for === 'string' ? appt.scheduled_for.slice(0, 10) : '';
      return apptYmd === ymd;
    });
    items.sort((a, b) => String(a?.scheduled_for || '').localeCompare(String(b?.scheduled_for || '')));
    return items;
  }, [appointments, selectedDateYmd]);

  const staffConfirmedAppointmentsForSelectedDate = staffAppointmentsForSelectedDate;

  const selectedHourSlotsLeft = useMemo(() => {
    const key = `${selectedDateYmd} ${selectedTime}`;
    const used = confirmedCountByYmdHour.get(key) || 0;
    return Math.max(0, HOURLY_CAPACITY - used);
  }, [confirmedCountByYmdHour, selectedDateYmd, selectedTime, HOURLY_CAPACITY]);

  const selectedHourUsed = useMemo(() => {
    return Math.max(0, HOURLY_CAPACITY - selectedHourSlotsLeft);
  }, [HOURLY_CAPACITY, selectedHourSlotsLeft]);

  const timeOptionsWithAvailability = useMemo(() => {
    return (timeOptions || []).map((opt) => {
      const key = `${selectedDateYmd} ${opt.value}`;
      const used = confirmedCountByYmdHour.get(key) || 0;
      const left = Math.max(0, HOURLY_CAPACITY - used);
      const status = left > 0 ? 'Available' : 'Not available';
      return {
        ...opt,
        label: `${opt.label} — ${status}`,
      };
    });
  }, [timeOptions, selectedDateYmd, confirmedCountByYmdHour, HOURLY_CAPACITY]);

  function slotsLeftForIso(iso) {
    if (!iso || typeof iso !== 'string' || iso.length < 16) return HOURLY_CAPACITY;
    const ymd = iso.slice(0, 10);
    const hhmm = iso.slice(11, 16);
    const key = `${ymd} ${hhmm}`;
    const used = confirmedCountByYmdHour.get(key) || 0;
    return Math.max(0, HOURLY_CAPACITY - used);
  }

  const earliestAvailableYmd = useMemo(() => {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 366; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const ymd = d.toISOString().slice(0, 10);

      // No appointments on weekends.
      if (isWeekendYmd(ymd)) continue;

      const count = bookedCountByDate.get(ymd) || 0;
      if (count < DAILY_CAPACITY) return ymd;
    }
    return '';
  }, [bookedCountByDate, DAILY_CAPACITY]);

  const api = useMemo(() => {
    // Axios instance for the backend API.
    // We attach the JWT access token (if present) to every request.
    const instance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 60000,
    });

    instance.interceptors.request.use((config) => {
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    return instance;
  }, [token]);

  async function onRegister() {
    // Create a new user account (patient/student).
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/register/', {
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        birthday,
        school_id: schoolId,
        contact_number: contactNumber,
      });
      setMode('login');
      setError('Registered. Now log in.');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLogin() {
    // Obtain JWT access token from backend.
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/auth/token/', {
        email,
        password,
      });

      // SimpleJWT returns { access, refresh }. Be tolerant of other key names.
      const accessToken =
        (res && res.data && (res.data.access || res.data.access_token || res.data.token)) ||
        '';

      if (!accessToken) {
        const text = typeof res?.data === 'string' ? res.data : '';
        const looksLikeHtml = /<\s*!doctype\s+html|<\s*html\b/i.test(text);
        if (looksLikeHtml) {
          setError(
            'You are hitting a web page (HTML) instead of the Django API. Fix Railway variable EXPO_PUBLIC_API_BASE_URL to point to the BACKEND domain, then redeploy the frontend.'
          );
        } else {
          setError(
            'Login request returned no access token. The backend should return JSON like {"access": "...", "refresh": "..."}. Check the /api/auth/token/ response in DevTools.'
          );
        }
        return;
      }

      setToken(accessToken);
      setShowAppointments(false);

      // Immediately load the profile using the fresh token (don’t wait for state).
      await fetchMe(accessToken);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchMe(accessOverride) {
    // Fetch the current user's profile/role.
    const authToken = accessOverride || token;
    if (!authToken) return;
    try {
      const res = await api.get('/api/auth/me/', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      setMe(res.data);
      // Default landing view per role (only on login/fetchMe).
      setShowAppointments(!!res.data?.is_staff);
    } catch (e) {
      // Non-fatal
    }
  }

  async function fetchAppointments() {
    // Staff: gets all appointments.
    // Student: gets only their own appointments.
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.get('/api/appointments/');
      setAppointments(res.data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchAccounts() {
    // Staff-only: list all registered accounts to enable/disable logins.
    if (!token) return;
    if (!me?.is_staff) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.get('/api/staff/users/');
      setAccounts(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function setAccountActive(userId, isActive) {
    if (!token) return;
    if (!me?.is_staff) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/staff/users/${userId}/`, { is_active: !!isActive });
      await fetchAccounts();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function setAppointmentStatus(id, status) {
    // Staff can confirm/cancel.
    // Students can only cancel (backend enforces this).
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/appointments/${id}/`, { status });
      await fetchAppointments();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function decryptAppointment(id) {
    // Calls a special endpoint that returns plaintext reason/notes.
    // The backend checks permissions (owner or staff) before returning plaintext.
    setBusy(true);
    setError('');
    try {
      const res = await api.get(`/api/appointments/${id}/decrypt/`);
      setDecryptedById((prev) => {
        const next = new Map(prev);
        next.set(id, {
          reason: res.data?.reason || '',
          notes: res.data?.notes || '',
        });
        return next;
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadStickerForAppointment(appt) {
    // Generates the PDF ticket for a confirmed appointment.
    // We prefer plaintext from the decrypt endpoint so the PDF shows readable text.
    if (!appt?.id) return;

    // Prefer plaintext (decrypt endpoint). If it fails, fall back to whatever we have.
    setBusy(true);
    setError('');
    try {
      let reasonPlain = '';
      let notesPlain = '';

      const cached = decryptedById.get(appt.id);
      if (cached) {
        reasonPlain = cached.reason || '';
        notesPlain = cached.notes || '';
      } else {
        const res = await api.get(`/api/appointments/${appt.id}/decrypt/`);
        reasonPlain = res.data?.reason || '';
        notesPlain = res.data?.notes || '';
        setDecryptedById((prev) => {
          const next = new Map(prev);
          next.set(appt.id, { reason: reasonPlain, notes: notesPlain });
          return next;
        });
      }

      const fullName =
        appt?.patient_full_name ||
        `${me?.first_name || ''} ${me?.last_name || ''}`.trim() ||
        me?.email ||
        appt?.patient_username ||
        '—';

      downloadAppointmentStickerPdf({
        fullName,
        scheduledForIso: appt?.scheduled_for || '',
        reason: reasonPlain || '(not provided)',
        notes: notesPlain || '',
        appointmentId: appt?.id,
        generatedAtIso: new Date().toISOString(),
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function hideDecrypted(id) {
    setDecryptedById((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  async function createAppointment() {
    if (me?.is_staff) {
      setError('Staff accounts cannot create appointments.');
      return;
    }

    if (selectedHourSlotsLeft <= 0) {
      setError('Selected time is not available. Please choose another hour.');
      return;
    }

    if (isWeekendYmd(selectedDateYmd)) {
      setError('Appointments cannot be created on Saturday or Sunday. Please choose a weekday.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api.post('/api/appointments/', {
        // Backend still expects this field; keep it out of the UI.
        doctor_name: 'General',
        scheduled_for: scheduledForIso,
        reason,
        notes,
      });
      setReason('');
      setNotes('');
      await fetchAppointments();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setToken(null);
    setMe(null);
    setAppointments([]);
    setShowAppointments(false);
    setShowAccounts(false);
  }

  useEffect(() => {
    fetchMe();
    fetchAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (me?.is_staff && showAccounts) {
      fetchAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.is_staff, showAccounts]);

  useEffect(() => {
    // If the selected day becomes invalid (weekend or fully booked), snap to earliest weekday.
    if (!token) return;
    if (me?.is_staff) return;
    if (!earliestAvailableYmd) return;
    const count = bookedCountByDate.get(selectedDateYmd) || 0;
    const isFull = count >= DAILY_CAPACITY;
    if (isWeekendYmd(selectedDateYmd) || isFull) {
      setSelectedDateYmd(earliestAvailableYmd);
    }
  }, [token, earliestAvailableYmd, bookedCountByDate, selectedDateYmd, DAILY_CAPACITY]);

  const screenKey = !token
    ? `auth:${mode}`
    : `app:${me?.is_staff ? 'staff' : 'student'}:${me?.is_staff ? (showAccounts ? 'accounts' : showAppointments ? 'list' : 'create') : (showAppointments ? 'list' : 'create')}`;

  const isStaff = !!me?.is_staff;
  const staffNavKey = showAccounts ? 'accounts' : showAppointments ? 'appointments' : 'home';
  const goStaffHome = () => {
    setShowAccounts(false);
    setShowAppointments(false);
  };
  const goStaffAppointments = () => {
    setShowAccounts(false);
    setShowAppointments(true);
  };
  const goStaffAccounts = () => {
    setShowAppointments(false);
    setShowAccounts(true);
  };

  const studentNavKey = showAccounts ? 'account' : showAppointments ? 'appointments' : 'home';
  const goStudentHome = () => {
    setShowAccounts(false);
    setShowAppointments(false);
  };
  const goStudentAppointments = () => {
    setShowAccounts(false);
    setShowAppointments(true);
  };
  const goStudentAccount = () => {
    setShowAppointments(false);
    setShowAccounts(true);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {!token ? (
        <View style={styles.authShell}>
          <View style={styles.authBg}>
            <View style={[styles.authBlob, styles.authBlobOne]} />
            <View style={[styles.authBlob, styles.authBlobTwo]} />
            <View style={[styles.authBlob, styles.authBlobThree]} />

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.authContainer}
              keyboardShouldPersistTaps="handled"
            >
              {!!error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <FadeSlideIn key={screenKey} style={styles.authCard}>
                <View style={styles.glassOverlay} />

                <View style={styles.authBrandRow}>
                  {UA_LOGO_URI ? (
                    <Image
                      source={{ uri: UA_LOGO_URI }}
                      style={styles.authBrandLogo}
                      resizeMode="contain"
                      accessibilityLabel="University of the Assumption logo"
                    />
                  ) : (
                    <View style={styles.authBrandLogoFallback}>
                      <Text style={styles.authBrandLogoFallbackText}>UA</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.authBrandTitle}>University of the Assumption</Text>
                    <Text style={styles.authBrandSub}>University Clinic • Appointment System</Text>
                  </View>
                </View>

                <View style={styles.authTabsRow}>
                  <Pressable
                    onPress={() => setMode('login')}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.authTab,
                      mode === 'login' ? styles.authTabActive : null,
                      pressed ? styles.authTabPressed : null,
                    ]}
                  >
                    <Text style={[styles.authTabText, mode === 'login' ? styles.authTabTextActive : null]}>Login</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMode('register')}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.authTab,
                      mode === 'register' ? styles.authTabActive : null,
                      pressed ? styles.authTabPressed : null,
                    ]}
                  >
                    <Text style={[styles.authTabText, mode === 'register' ? styles.authTabTextActive : null]}>Register</Text>
                  </Pressable>
                </View>

                <Text style={styles.authHeading}>{mode === 'login' ? 'LOGIN' : 'REGISTER'}</Text>
                <Text style={styles.authSubHeading}>
                  {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
                </Text>

                <Field label="Email">
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={[styles.input, styles.authInput]}
                    placeholder="you@ua.edu.ph"
                    placeholderTextColor={THEME.colors.muted}
                  />
                </Field>

                <Field label="Password">
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    style={[styles.input, styles.authInput]}
                    placeholder="••••••••"
                    placeholderTextColor={THEME.colors.muted}
                  />
                </Field>

                {mode === 'login' ? (
                  <View style={styles.authMetaRow}>
                    <Pressable
                      onPress={() => setRememberMe((v) => !v)}
                      disabled={busy}
                      style={({ pressed }) => [styles.rememberRow, pressed ? styles.rememberPressed : null]}
                    >
                      <View style={[styles.checkbox, rememberMe ? styles.checkboxChecked : null]}>
                        {rememberMe ? <Text style={styles.checkboxTick}>✓</Text> : null}
                      </View>
                      <Text style={styles.rememberText}>Remember me</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => setError('Please contact the clinic staff to reset your password.')}
                      disabled={busy}
                      style={({ pressed }) => [pressed ? styles.authLinkPressed : null]}
                    >
                      <Text style={styles.authLink}>Forgot Password?</Text>
                    </Pressable>
                  </View>
                ) : null}

                {mode === 'register' && (
                  <>
                    <View style={styles.grid2}>
                      <View style={styles.gridCol}>
                        <Field label="First Name">
                          <TextInput
                            value={firstName}
                            onChangeText={setFirstName}
                            style={[styles.input, styles.authInput]}
                            placeholder="First name"
                            placeholderTextColor={THEME.colors.muted}
                          />
                        </Field>
                      </View>
                      <View style={styles.gridCol}>
                        <Field label="Last Name">
                          <TextInput
                            value={lastName}
                            onChangeText={setLastName}
                            style={[styles.input, styles.authInput]}
                            placeholder="Last name"
                            placeholderTextColor={THEME.colors.muted}
                          />
                        </Field>
                      </View>
                    </View>

                    <View style={styles.grid2}>
                      <View style={styles.gridCol}>
                        <Field label="Birthday" hint="Format: YYYY-MM-DD">
                          <TextInput
                            value={birthday}
                            onChangeText={setBirthday}
                            autoCapitalize="none"
                            style={[styles.input, styles.authInput]}
                            placeholder="2000-01-31"
                            placeholderTextColor={THEME.colors.muted}
                          />
                        </Field>
                      </View>
                      <View style={styles.gridCol}>
                        <Field label="School ID">
                          <TextInput
                            value={schoolId}
                            onChangeText={setSchoolId}
                            autoCapitalize="characters"
                            style={[styles.input, styles.authInput]}
                            placeholder="UA-XXXXXX"
                            placeholderTextColor={THEME.colors.muted}
                          />
                        </Field>
                      </View>
                    </View>

                    <Field label="Contact Number">
                      <TextInput
                        value={contactNumber}
                        onChangeText={setContactNumber}
                        autoCapitalize="none"
                        keyboardType={Platform.OS === 'web' ? 'tel' : 'phone-pad'}
                        style={[styles.input, styles.authInput]}
                        placeholder="09xxxxxxxxx"
                        placeholderTextColor={THEME.colors.muted}
                      />
                    </Field>
                  </>
                )}

                <View style={styles.formActions}>
                  <UiButton
                    title={mode === 'login' ? 'Sign in' : 'Create account'}
                    onPress={mode === 'login' ? onLogin : onRegister}
                    disabled={
                      busy ||
                      !email ||
                      !password ||
                      (mode === 'register' &&
                        (!firstName || !lastName || !birthday || !schoolId || !contactNumber))
                    }
                    variant="primary"
                  />
                </View>
              </FadeSlideIn>
            </ScrollView>
          </View>
        </View>
      ) : isStaff ? (
        <View style={styles.staffShell}>
          <View style={styles.sidebar}>
            <View style={styles.sidebarBrandRow}>
              {UA_LOGO_URI ? (
                <Image
                  source={{ uri: UA_LOGO_URI }}
                  style={styles.sidebarLogo}
                  resizeMode="contain"
                  accessibilityLabel="University of the Assumption logo"
                />
              ) : (
                <View style={styles.sidebarLogoFallback}>
                  <Text style={styles.sidebarLogoFallbackText}>UA</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.sidebarTitle}>UA Clinic</Text>
                <Text style={styles.sidebarSub}>Staff Dashboard</Text>
              </View>
            </View>

            <View style={styles.sidebarUserCard}>
              <Text style={styles.sidebarUserName}>
                {`${me?.first_name || ''} ${me?.last_name || ''}`.trim() || me?.email || 'Staff'}
              </Text>
              <Text style={styles.sidebarUserMeta}>{me?.email || email || '—'}</Text>
              <View style={styles.sidebarPillsRow}>
                <View style={[styles.pill, styles.pillNeutral]}>
                  <Text style={styles.pillText}>STAFF</Text>
                </View>
                {staffNavKey === 'accounts' ? (
                  <View style={[styles.pill, styles.pillNeutral]}>
                    <Text style={styles.pillText}>ACCOUNTS</Text>
                  </View>
                ) : staffNavKey === 'appointments' ? (
                  <View style={[styles.pill, styles.pillNeutral]}>
                    <Text style={styles.pillText}>APPOINTMENTS</Text>
                  </View>
                ) : (
                  <View style={[styles.pill, styles.pillNeutral]}>
                    <Text style={styles.pillText}>SCHEDULE</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.sidebarNav}>
              <Pressable
                onPress={goStaffHome}
                disabled={busy}
                style={({ pressed }) => [
                  styles.sidebarNavItem,
                  staffNavKey === 'home' ? styles.sidebarNavItemActive : null,
                  pressed ? styles.sidebarNavItemPressed : null,
                ]}
              >
                <Text style={styles.sidebarNavText}>Home</Text>
              </Pressable>
              <Pressable
                onPress={goStaffAppointments}
                disabled={busy}
                style={({ pressed }) => [
                  styles.sidebarNavItem,
                  staffNavKey === 'appointments' ? styles.sidebarNavItemActive : null,
                  pressed ? styles.sidebarNavItemPressed : null,
                ]}
              >
                <Text style={styles.sidebarNavText}>Appointments</Text>
              </Pressable>
              <Pressable
                onPress={goStaffAccounts}
                disabled={busy}
                style={({ pressed }) => [
                  styles.sidebarNavItem,
                  staffNavKey === 'accounts' ? styles.sidebarNavItemActive : null,
                  pressed ? styles.sidebarNavItemPressed : null,
                ]}
              >
                <Text style={styles.sidebarNavText}>Accounts</Text>
              </Pressable>
            </View>

            <View style={styles.sidebarActions}>
              <UiButton title="Refresh" onPress={fetchAppointments} disabled={busy} variant="secondary" />
              <UiButton title="Logout" onPress={logout} disabled={busy} variant="ghost" />
            </View>
          </View>

          <ScrollView
            style={styles.staffScroll}
            contentContainerStyle={styles.staffContainer}
            keyboardShouldPersistTaps="handled"
          >
            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <FadeSlideIn key={screenKey} style={styles.screenWrap}>
              {!!token && !me ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>Loading account…</Text>
                </View>
              ) : showAccounts ? (
                <View style={styles.card}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>Registered Accounts</Text>
                    <UiButton title="Reload" onPress={fetchAccounts} disabled={busy} variant="ghost" />
                  </View>

                  <FlatList
                    data={accounts}
                    scrollEnabled={false}
                    keyExtractor={(item) => String(item.id)}
                    ListEmptyComponent={<Text style={styles.hint}>No accounts found.</Text>}
                    renderItem={({ item }) => {
                      const isActive = !!item?.is_active;
                      const isStaffRole = !!item?.is_staff;
                      const isSelf = item?.id === me?.id;
                      const fullName = `${item?.first_name || ''} ${item?.last_name || ''}`.trim();
                      const subtitle = fullName || item?.email || item?.username || '—';
                      const roleLabel = isStaffRole ? 'STAFF' : 'STUDENT';
                      const statusLabel = isActive ? 'ACTIVE' : 'DISABLED';

                      return (
                        <View style={styles.item}>
                          <View style={styles.itemHeaderRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.itemTitle}>{subtitle}</Text>
                              <Text style={styles.itemMeta}>{item?.username || ''}</Text>
                            </View>
                            <View style={styles.pillsRow}>
                              <View style={[styles.pill, styles.pillNeutral]}>
                                <Text style={styles.pillText}>{roleLabel}</Text>
                              </View>
                              {isSelf ? (
                                <View style={[styles.pill, styles.pillNeutral]}>
                                  <Text style={styles.pillText}>YOU</Text>
                                </View>
                              ) : null}
                              <View
                                style={[
                                  styles.pill,
                                  isActive ? styles.pillSuccess : styles.pillDanger,
                                ]}
                              >
                                <Text style={styles.pillText}>{statusLabel}</Text>
                              </View>
                            </View>
                          </View>

                          <View style={styles.accountRow}>
                            <View style={styles.accountMiniCell}>
                              <Text style={styles.accountLabel}>School ID</Text>
                              <Text style={styles.accountValue}>{item?.school_id || '—'}</Text>
                            </View>
                            <View style={styles.accountMiniCell}>
                              <Text style={styles.accountLabel}>Contact</Text>
                              <Text style={styles.accountValue}>{item?.contact_number || '—'}</Text>
                            </View>
                          </View>

                          <View style={styles.actionRow}>
                            {isActive ? (
                              <UiButton
                                title="Disable"
                                onPress={() => setAccountActive(item.id, false)}
                                disabled={busy || isSelf}
                                variant="secondary"
                              />
                            ) : (
                              <UiButton
                                title="Enable"
                                onPress={() => setAccountActive(item.id, true)}
                                disabled={busy || isSelf}
                                variant="primary"
                              />
                            )}
                          </View>
                        </View>
                      );
                    }}
                  />
                </View>
              ) : showAppointments ? (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Appointments</Text>
                  <FlatList
                    data={staffInboxAppointments}
                    scrollEnabled={false}
                    keyExtractor={(item) => String(item.id)}
                    ListEmptyComponent={<Text style={styles.hint}>No pending appointments.</Text>}
                    renderItem={({ item }) => (
                      <View style={styles.item}>
                        <View style={styles.itemHeaderRow}>
                          <Text style={styles.itemTitle}>{String(item.status || '').toUpperCase()}</Text>
                          <View
                            style={[
                              styles.pill,
                              String(item.status || '').toLowerCase() === 'confirmed'
                                ? styles.pillSuccess
                                : String(item.status || '').toLowerCase() === 'cancelled'
                                  ? styles.pillDanger
                                  : styles.pillNeutral,
                            ]}
                          >
                            <Text style={styles.pillText}>{String(item.status || '').toUpperCase()}</Text>
                          </View>
                        </View>
                        <Text style={styles.itemMeta}>
                          Patient: {item.patient_full_name || '—'}
                          {item.patient_age !== null && item.patient_age !== undefined
                            ? ` (Age: ${item.patient_age})`
                            : ''}
                        </Text>
                        <Text style={styles.itemMeta}>{item.scheduled_for}</Text>
                        <Text style={styles.hint}>
                          Slots left this hour: {slotsLeftForIso(item.scheduled_for)}/{HOURLY_CAPACITY}
                        </Text>

                        {(() => {
                          const dec = decryptedById.get(item.id);
                          const reasonText = dec ? dec.reason : item.reason;
                          const notesText = dec ? dec.notes : item.notes;

                          return (
                            <>
                              {!!reasonText && (
                                <Text style={styles.itemBody}>
                                  Reason: {reasonText}
                                  {!dec ? ' (encrypted)' : ''}
                                </Text>
                              )}
                              {!!notesText && (
                                <Text style={styles.itemBody}>
                                  Notes: {notesText}
                                  {!dec ? ' (encrypted)' : ''}
                                </Text>
                              )}

                              <View style={styles.actionRow}>
                                <View style={styles.actionBtn}>
                                  {!dec ? (
                                    <UiButton
                                      title="Decrypt"
                                      onPress={() => decryptAppointment(item.id)}
                                      disabled={busy}
                                      variant="secondary"
                                    />
                                  ) : (
                                    <UiButton
                                      title="Hide"
                                      onPress={() => hideDecrypted(item.id)}
                                      disabled={busy}
                                      variant="ghost"
                                    />
                                  )}
                                </View>

                                <View style={styles.actionBtn}>
                                  <UiButton
                                    title="Confirm"
                                    onPress={() => setAppointmentStatus(item.id, 'confirmed')}
                                    disabled={busy || slotsLeftForIso(item.scheduled_for) <= 0}
                                    variant="primary"
                                  />
                                </View>

                                <View style={styles.actionBtn}>
                                  <UiButton
                                    title="Cancel"
                                    onPress={() => setAppointmentStatus(item.id, 'cancelled')}
                                    disabled={busy}
                                    variant="secondary"
                                  />
                                </View>
                              </View>
                            </>
                          );
                        })()}
                      </View>
                    )}
                  />
                </View>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Schedule</Text>

                  <Text style={styles.label}>Scheduled For</Text>
                  {!!earliestAvailableYmd && (
                    <Text style={styles.hint}>
                      Earliest available appointment: {earliestAvailableYmd}
                    </Text>
                  )}

                  <Calendar
                    cursor={calendarCursor}
                    onChangeCursor={setCalendarCursor}
                    selectedDateYmd={selectedDateYmd}
                    onSelectDateYmd={setSelectedDateYmd}
                    bookedCountByDate={bookedCountByDateConfirmed}
                    dailyCapacity={DAILY_CAPACITY}
                  />

                  <Text style={styles.label}>Time (UTC)</Text>
                  <View style={styles.pickerWrap}>
                    <Picker
                      enabled={!busy}
                      selectedValue={selectedTime}
                      onValueChange={(v) => setSelectedTime(String(v))}
                      style={styles.picker}
                    >
                      {timeOptionsWithAvailability.map((opt) => (
                        <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                      ))}
                    </Picker>
                  </View>
                  <Text style={styles.hint}>
                    Selected: {selectedDateYmd} {selectedTime}
                  </Text>
                  <Text style={styles.hint}>
                    Status: {selectedHourSlotsLeft > 0 ? 'Available' : 'Not available'} ({selectedHourUsed}/{HOURLY_CAPACITY})
                  </Text>

                  <View style={styles.availabilityList}>
                    {timeOptions.map((opt) => {
                      const key = `${selectedDateYmd} ${opt.value}`;
                      const used = confirmedCountByYmdHour.get(key) || 0;
                      const statusText = used < HOURLY_CAPACITY ? 'Available' : 'Not available';
                      return (
                        <View key={opt.value} style={styles.availabilityRow}>
                          <Text style={styles.availabilityTime}>{opt.value}</Text>
                          <Text style={styles.availabilityMeta}>
                            {statusText} ({used}/{HOURLY_CAPACITY})
                          </Text>
                        </View>
                      );
                    })}
                  </View>

                  <Text style={[styles.sectionTitle, { marginTop: 12 }]}>
                    Appointments on {selectedDateYmd}
                  </Text>
                  <FlatList
                    data={staffConfirmedAppointmentsForSelectedDate}
                    scrollEnabled={false}
                    keyExtractor={(item) => String(item.id)}
                    ListEmptyComponent={<Text style={styles.hint}>No confirmed appointments for this date.</Text>}
                    renderItem={({ item }) => (
                      <View style={styles.item}>
                        <View style={styles.itemHeaderRow}>
                          <Text style={styles.itemTitle}>{String(item.status || '').toUpperCase()}</Text>
                          <View
                            style={[
                              styles.pill,
                              String(item.status || '').toLowerCase() === 'confirmed'
                                ? styles.pillSuccess
                                : String(item.status || '').toLowerCase() === 'cancelled'
                                  ? styles.pillDanger
                                  : styles.pillNeutral,
                            ]}
                          >
                            <Text style={styles.pillText}>{String(item.status || '').toUpperCase()}</Text>
                          </View>
                        </View>
                        <Text style={styles.itemMeta}>
                          Patient: {item.patient_full_name || '—'}
                          {item.patient_age !== null && item.patient_age !== undefined
                            ? ` (Age: ${item.patient_age})`
                            : ''}
                        </Text>
                        <Text style={styles.itemMeta}>{item.scheduled_for}</Text>

                        {(() => {
                          const dec = decryptedById.get(item.id);
                          const reasonText = dec ? dec.reason : item.reason;
                          const notesText = dec ? dec.notes : item.notes;

                          return (
                            <>
                              {!!reasonText && (
                                <Text style={styles.itemBody}>
                                  Reason: {reasonText}
                                  {!dec ? ' (encrypted)' : ''}
                                </Text>
                              )}
                              {!!notesText && (
                                <Text style={styles.itemBody}>
                                  Notes: {notesText}
                                  {!dec ? ' (encrypted)' : ''}
                                </Text>
                              )}

                              <View style={styles.actionRow}>
                                <View style={styles.actionBtn}>
                                  {!dec ? (
                                    <UiButton
                                      title="Decrypt"
                                      onPress={() => decryptAppointment(item.id)}
                                      disabled={busy}
                                      variant="secondary"
                                    />
                                  ) : (
                                    <UiButton
                                      title="Hide"
                                      onPress={() => hideDecrypted(item.id)}
                                      disabled={busy}
                                      variant="ghost"
                                    />
                                  )}
                                </View>

                                <View style={styles.actionBtn}>
                                  <UiButton
                                    title="Cancel"
                                    onPress={() => setAppointmentStatus(item.id, 'cancelled')}
                                    disabled={busy}
                                    variant="secondary"
                                  />
                                </View>
                              </View>
                            </>
                          );
                        })()}
                      </View>
                    )}
                  />
                </View>
              )}
            </FadeSlideIn>
          </ScrollView>
        </View>
      ) : (
        <View style={styles.staffShell}>
          <View style={styles.sidebar}>
            <View style={styles.sidebarBrandRow}>
              {UA_LOGO_URI ? (
                <Image
                  source={{ uri: UA_LOGO_URI }}
                  style={styles.sidebarLogo}
                  resizeMode="contain"
                  accessibilityLabel="University of the Assumption logo"
                />
              ) : (
                <View style={styles.sidebarLogoFallback}>
                  <Text style={styles.sidebarLogoFallbackText}>UA</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.sidebarTitle}>UA Clinic</Text>
                <Text style={styles.sidebarSub}>Student Portal</Text>
              </View>
            </View>

            <View style={styles.sidebarUserCard}>
              <Text style={styles.sidebarUserName}>
                {`${me?.first_name || ''} ${me?.last_name || ''}`.trim() || me?.email || 'Student'}
              </Text>
              <Text style={styles.sidebarUserMeta}>{me?.email || email || '—'}</Text>
              <View style={styles.sidebarPillsRow}>
                <View style={[styles.pill, styles.pillNeutral]}>
                  <Text style={styles.pillText}>STUDENT</Text>
                </View>
                {studentNavKey === 'appointments' ? (
                  <View style={[styles.pill, styles.pillNeutral]}>
                    <Text style={styles.pillText}>APPOINTMENTS</Text>
                  </View>
                ) : (
                  <View style={[styles.pill, styles.pillNeutral]}>
                    <Text style={styles.pillText}>SCHEDULE</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.sidebarNav}>
              <Pressable
                onPress={goStudentHome}
                disabled={busy}
                style={({ pressed }) => [
                  styles.sidebarNavItem,
                  studentNavKey === 'home' ? styles.sidebarNavItemActive : null,
                  pressed ? styles.sidebarNavItemPressed : null,
                ]}
              >
                <Text style={styles.sidebarNavText}>Home</Text>
              </Pressable>
              <Pressable
                onPress={goStudentAppointments}
                disabled={busy}
                style={({ pressed }) => [
                  styles.sidebarNavItem,
                  studentNavKey === 'appointments' ? styles.sidebarNavItemActive : null,
                  pressed ? styles.sidebarNavItemPressed : null,
                ]}
              >
                <Text style={styles.sidebarNavText}>My Appointments</Text>
              </Pressable>
              <Pressable
                onPress={goStudentAccount}
                disabled={busy}
                style={({ pressed }) => [
                  styles.sidebarNavItem,
                  studentNavKey === 'account' ? styles.sidebarNavItemActive : null,
                  pressed ? styles.sidebarNavItemPressed : null,
                ]}
              >
                <Text style={styles.sidebarNavText}>Account</Text>
              </Pressable>
            </View>

            <View style={styles.sidebarActions}>
              <UiButton title="Refresh" onPress={fetchAppointments} disabled={busy} variant="secondary" />
              <UiButton title="Logout" onPress={logout} disabled={busy} variant="ghost" />
            </View>
          </View>

          <ScrollView
            style={styles.staffScroll}
            contentContainerStyle={styles.staffContainer}
            keyboardShouldPersistTaps="handled"
          >
            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <FadeSlideIn key={screenKey} style={styles.screenWrap}>
              {!!token && !me ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>Loading account…</Text>
                </View>
              ) : showAccounts ? (
                <AccountDetails me={me} emailFallback={email} />
              ) : showAppointments ? (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>My Appointments</Text>
                  <FlatList
                    data={appointments}
                    scrollEnabled={false}
                    keyExtractor={(item) => String(item.id)}
                    ListEmptyComponent={<Text style={styles.hint}>No appointments yet.</Text>}
                    renderItem={({ item }) => (
                      <View style={styles.item}>
                        <View style={styles.itemHeaderRow}>
                          <Text style={styles.itemTitle}>{String(item.status || '').toUpperCase()}</Text>
                          <View
                            style={[
                              styles.pill,
                              String(item.status || '').toLowerCase() === 'confirmed'
                                ? styles.pillSuccess
                                : String(item.status || '').toLowerCase() === 'cancelled'
                                  ? styles.pillDanger
                                  : styles.pillNeutral,
                            ]}
                          >
                            <Text style={styles.pillText}>{String(item.status || '').toUpperCase()}</Text>
                          </View>
                        </View>
                        <Text style={styles.itemMeta}>{item.scheduled_for}</Text>

                        {(() => {
                          const dec = decryptedById.get(item.id);
                          const reasonText = dec ? dec.reason : item.reason;
                          const notesText = dec ? dec.notes : item.notes;
                          const isConfirmed = String(item.status || '').toLowerCase() === 'confirmed';

                          return (
                            <>
                              {!!reasonText && (
                                <Text style={styles.itemBody}>
                                  Reason: {reasonText}
                                  {!dec ? ' (encrypted)' : ''}
                                </Text>
                              )}
                              {!!notesText && (
                                <Text style={styles.itemBody}>
                                  Notes: {notesText}
                                  {!dec ? ' (encrypted)' : ''}
                                </Text>
                              )}

                              <View style={styles.actionRow}>
                                <View style={styles.actionBtn}>
                                  {!dec ? (
                                    <UiButton
                                      title="Decrypt"
                                      onPress={() => decryptAppointment(item.id)}
                                      disabled={busy}
                                      variant="secondary"
                                    />
                                  ) : (
                                    <UiButton
                                      title="Hide"
                                      onPress={() => hideDecrypted(item.id)}
                                      disabled={busy}
                                      variant="ghost"
                                    />
                                  )}
                                </View>

                                {isConfirmed ? (
                                  <View style={styles.actionBtn}>
                                    <UiButton
                                      title="Ticket"
                                      onPress={() => downloadStickerForAppointment(item)}
                                      disabled={busy}
                                      variant="primary"
                                    />
                                  </View>
                                ) : null}

                                <View style={styles.actionBtn}>
                                  <UiButton
                                    title="Cancel"
                                    onPress={() => setAppointmentStatus(item.id, 'cancelled')}
                                    disabled={busy}
                                    variant="secondary"
                                  />
                                </View>
                              </View>
                            </>
                          );
                        })()}
                      </View>
                    )}
                  />
                </View>
              ) : (
                <>
                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Schedule</Text>

                    <Text style={styles.label}>Scheduled For</Text>
                    {!!earliestAvailableYmd && (
                      <Text style={styles.hint}>
                        Earliest available appointment: {earliestAvailableYmd}
                      </Text>
                    )}

                    <Calendar
                      cursor={calendarCursor}
                      onChangeCursor={setCalendarCursor}
                      selectedDateYmd={selectedDateYmd}
                      onSelectDateYmd={setSelectedDateYmd}
                      bookedCountByDate={bookedCountByDate}
                      dailyCapacity={DAILY_CAPACITY}
                    />

                    <Text style={styles.label}>Time (UTC)</Text>
                    <View style={styles.pickerWrap}>
                      <Picker
                        enabled={!busy}
                        selectedValue={selectedTime}
                        onValueChange={(v) => setSelectedTime(String(v))}
                        style={styles.picker}
                      >
                        {timeOptionsWithAvailability.map((opt) => (
                          <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                        ))}
                      </Picker>
                    </View>
                    <Text style={styles.hint}>
                      Selected: {selectedDateYmd} {selectedTime}
                    </Text>
                    <Text style={styles.hint}>
                      Status: {selectedHourSlotsLeft > 0 ? 'Available' : 'Not available'} ({selectedHourUsed}/{HOURLY_CAPACITY})
                    </Text>

                    <View style={styles.availabilityList}>
                      {timeOptions.map((opt) => {
                        const key = `${selectedDateYmd} ${opt.value}`;
                        const used = confirmedCountByYmdHour.get(key) || 0;
                        const statusText = used < HOURLY_CAPACITY ? 'Available' : 'Not available';
                        return (
                          <View key={opt.value} style={styles.availabilityRow}>
                            <Text style={styles.availabilityTime}>{opt.value}</Text>
                            <Text style={styles.availabilityMeta}>
                              {statusText} ({used}/{HOURLY_CAPACITY})
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Create Appointment</Text>

                    <Field label="Reason" hint="Visible only after decrypt (owner/staff).">
                      <TextInput
                        value={reason}
                        onChangeText={setReason}
                        style={[styles.input, styles.textarea]}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        placeholder="Enter reason for visit"
                        placeholderTextColor={THEME.colors.muted}
                      />
                    </Field>

                    <Field label="Notes" hint="Optional additional information.">
                      <TextInput
                        value={notes}
                        onChangeText={setNotes}
                        style={[styles.input, styles.textarea]}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        placeholder="Enter notes (optional)"
                        placeholderTextColor={THEME.colors.muted}
                      />
                    </Field>

                    <UiButton
                      title="Create"
                      onPress={createAppointment}
                      disabled={busy || !scheduledForIso || isWeekendYmd(selectedDateYmd) || selectedHourSlotsLeft <= 0}
                      variant="primary"
                    />
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Appointments on {selectedDateYmd}</Text>
                    <FlatList
                      data={myAppointmentsForSelectedDate}
                      scrollEnabled={false}
                      keyExtractor={(item) => String(item.id)}
                      ListEmptyComponent={<Text style={styles.hint}>No appointments for this date.</Text>}
                      renderItem={({ item }) => (
                        <View style={styles.item}>
                          <View style={styles.itemHeaderRow}>
                            <Text style={styles.itemTitle}>{String(item.status || '').toUpperCase()}</Text>
                            <View
                              style={[
                                styles.pill,
                                String(item.status || '').toLowerCase() === 'confirmed'
                                  ? styles.pillSuccess
                                  : String(item.status || '').toLowerCase() === 'cancelled'
                                    ? styles.pillDanger
                                    : styles.pillNeutral,
                              ]}
                            >
                              <Text style={styles.pillText}>{String(item.status || '').toUpperCase()}</Text>
                            </View>
                          </View>
                          <Text style={styles.itemMeta}>{item.scheduled_for}</Text>
                        </View>
                      )}
                    />
                  </View>
                </>
              )}
            </FadeSlideIn>
          </ScrollView>
        </View>
      )}

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function getErrorMessage(e) {
  // Converts Axios/HTTP errors into user-friendly messages.
  // Axios timeout errors (common with Render free-tier cold starts)
  if (e?.code === 'ECONNABORTED' || String(e?.message || '').toLowerCase().includes('timeout')) {
    return 'Backend did not respond in time. If the backend is on Render, wait 30–60 seconds and try again.';
  }

  // Browser network errors (DNS/CORS/offline)
  if (!e?.response && String(e?.message || '').toLowerCase().includes('network')) {
    return 'Network error contacting the backend. Check your connection and that the backend URL is correct.';
  }

  if (e?.response?.data) {
    const detail =
      typeof e.response.data === 'object' && e.response.data?.detail
        ? String(e.response.data.detail)
        : '';
    if (detail.toLowerCase().includes('no active account')) {
      return 'Incorrect email or password.';
    }
    if (typeof e.response.data === 'string') {
      const text = e.response.data;
      const looksLikeHtml = /<\s*!doctype\s+html|<\s*html\b/i.test(text);
      const status = e?.response?.status;
      if (looksLikeHtml) {
        if (status === 404) {
          return (
            'API endpoint not found (404). This usually means the backend is not redeployed yet, or EXPO_PUBLIC_API_BASE_URL is pointing to the wrong server.'
          );
        }
        return 'Backend returned an HTML page instead of JSON. Check the backend URL and try again.';
      }
      return text;
    }
    return JSON.stringify(e.response.data);
  }
  return e?.message || 'Request failed';
}

function Calendar({
  cursor,
  onChangeCursor,
  selectedDateYmd,
  onSelectDateYmd,
  bookedCountByDate,
  dailyCapacity,
}) {
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth(); // 0-11

  const monthName = cursor.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

  const weeks = useMemo(() => buildCalendarWeeksUtc(year, month), [year, month]);

  function prevMonth() {
    // Move calendar cursor back one month.
    const d = new Date(cursor);
    d.setUTCMonth(d.getUTCMonth() - 1);
    d.setUTCDate(1);
    onChangeCursor(d);
  }

  function nextMonth() {
    // Move calendar cursor forward one month.
    const d = new Date(cursor);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(1);
    onChangeCursor(d);
  }

  function statusForYmd(ymd) {
    const count = bookedCountByDate.get(ymd) || 0;
    return count >= dailyCapacity ? 'full' : 'available';
  }

  function isWeekend(ymd) {
    return isWeekendYmd(ymd);
  }

  return (
    <View style={styles.calendarCard}>
      <View style={styles.calendarHeaderRow}>
        <UiButton title="<" onPress={prevMonth} variant="ghost" style={styles.calendarNavBtn} />
        <Text style={styles.calendarTitle}>
          {monthName} {year}
        </Text>
        <UiButton title=">" onPress={nextMonth} variant="ghost" style={styles.calendarNavBtn} />
      </View>

      <View style={styles.calendarWeekdaysRow}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <Text key={d} style={styles.calendarWeekday}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.calendarWeekRow}>
          {week.map((cell, di) => {
            if (!cell) {
              return <View key={di} style={[styles.calendarDay, styles.calendarDayEmpty]} />;
            }

            const ymd = cell.ymd;
            const status = statusForYmd(ymd);
            const isSelected = ymd === selectedDateYmd;
            const weekend = isWeekend(ymd);
            const disabled = status === 'full' || weekend;

            return (
              <Pressable
                key={di}
                disabled={disabled}
                onPress={() => onSelectDateYmd(ymd)}
                style={({ pressed }) => [
                  styles.calendarDay,
                  weekend
                    ? styles.calendarDayWeekend
                    : status === 'available'
                      ? styles.calendarDayAvailable
                      : styles.calendarDayFull,
                  isSelected ? styles.calendarDaySelected : null,
                  disabled && !weekend ? styles.calendarDayDisabled : null,
                  pressed ? styles.calendarDayPressed : null,
                ]}
              >
                <Text style={weekend ? styles.calendarDayWeekendText : styles.calendarDayText}>
                  {cell.day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.calendarLegendRow}>
        <View style={[styles.legendChip, styles.legendAvailable]}>
          <Text style={styles.legendText}>Available</Text>
        </View>
        <View style={[styles.legendChip, styles.legendFull]}>
          <Text style={styles.legendText}>Fully Booked</Text>
        </View>
      </View>
    </View>
  );
}

function isWeekendYmd(ymd) {
  // Helper used by both student and staff scheduling views.
  // Sunday = 0, Saturday = 6
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function buildCalendarWeeksUtc(year, monthIndex) {
  const first = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const startDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0));
    cells.push({
      day,
      ymd: d.toISOString().slice(0, 10),
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function buildTimeOptions() {
  // Hourly slots from 07:00 to 16:00 inclusive (UTC).
  const options = [];
  for (let hour = 7; hour <= 16; hour++) {
    const value = `${String(hour).padStart(2, '0')}:00`;
    options.push({ value, label: formatTimeLabel(value) });
  }
  return options;
}

function formatTimeLabel(hhmm) {
  const [hhStr, mm] = String(hhmm).split(':');
  const hh = Number(hhStr);
  if (!Number.isFinite(hh)) return hhmm;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hour12 = ((hh + 11) % 12) + 1;
  return `${hour12}:${mm || '00'} ${ampm}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: THEME.colors.bg,
  },
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: 18,
    backgroundColor: THEME.colors.bg,
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
  },

  // --- Shared brand/header ------------------------------------------------
  brandBar: {
    width: '100%',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: THEME.colors.surface,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandLogo: {
    width: 54,
    height: 54,
  },
  brandLogoFallback: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.bg,
  },
  brandLogoFallbackText: {
    fontWeight: '900',
    color: THEME.colors.text,
    letterSpacing: 1.2,
  },
  brandTextWrap: {
    flex: 1,
  },

  // --- Auth (glass login/register) ----------------------------------------
  authShell: {
    flex: 1,
  },
  authBg: {
    flex: 1,
    backgroundColor: THEME.colors.bg,
  },
  authBlob: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.12,
  },
  authBlobOne: {
    width: 340,
    height: 340,
    left: -120,
    top: -90,
    backgroundColor: THEME.colors.primary,
  },
  authBlobTwo: {
    width: 420,
    height: 420,
    right: -160,
    top: 90,
    backgroundColor: THEME.colors.accent,
  },
  authBlobThree: {
    width: 320,
    height: 320,
    left: 40,
    bottom: -140,
    backgroundColor: THEME.colors.primary,
    opacity: 0.08,
  },
  authContainer: {
    flexGrow: 1,
    padding: 18,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  authCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.md,
    padding: 18,
    overflow: 'hidden',
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: THEME.colors.surface,
    opacity: 0.82,
  },
  authBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  authBrandLogo: {
    width: 44,
    height: 44,
  },
  authBrandLogoFallback: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.bg,
  },
  authBrandLogoFallbackText: {
    fontWeight: '900',
    color: THEME.colors.text,
    letterSpacing: 1.2,
    fontSize: 12,
  },
  authBrandTitle: {
    fontWeight: '900',
    color: THEME.colors.text,
    letterSpacing: 0.2,
  },
  authBrandSub: {
    marginTop: 2,
    color: THEME.colors.muted,
    fontWeight: '700',
    fontSize: 12,
  },
  authTabsRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 12,
    backgroundColor: THEME.colors.bg,
  },
  authTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authTabActive: {
    backgroundColor: THEME.colors.primary,
  },
  authTabPressed: {
    opacity: 0.92,
  },
  authTabText: {
    fontWeight: '900',
    letterSpacing: 0.3,
    color: THEME.colors.text,
  },
  authTabTextActive: {
    color: THEME.colors.primaryText,
  },
  authHeading: {
    marginTop: 2,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 1.0,
    color: THEME.colors.text,
    textAlign: 'center',
  },
  authSubHeading: {
    marginTop: 6,
    marginBottom: 4,
    color: THEME.colors.muted,
    fontWeight: '700',
    textAlign: 'center',
  },
  authInput: {
    backgroundColor: THEME.colors.surface,
  },
  authMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  rememberPressed: {
    opacity: 0.9,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: THEME.colors.borderStrong,
    backgroundColor: THEME.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  checkboxTick: {
    fontWeight: '900',
    color: THEME.colors.primaryText,
    marginTop: -1,
  },
  rememberText: {
    fontWeight: '800',
    color: THEME.colors.text,
  },
  authLink: {
    fontWeight: '900',
    color: THEME.colors.text,
    textDecorationLine: 'underline',
  },
  authLinkPressed: {
    opacity: 0.85,
  },

  // --- Staff shell (sidebar + content) ------------------------------------
  staffShell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: THEME.colors.bg,
  },
  sidebar: {
    width: 270,
    padding: 14,
    backgroundColor: THEME.colors.surface,
    borderRightWidth: 1,
    borderRightColor: THEME.colors.border,
  },
  sidebarBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  sidebarLogo: {
    width: 40,
    height: 40,
  },
  sidebarLogoFallback: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarLogoFallbackText: {
    fontWeight: '900',
    color: THEME.colors.text,
    letterSpacing: 1.2,
    fontSize: 12,
  },
  sidebarTitle: {
    fontWeight: '900',
    color: THEME.colors.text,
    letterSpacing: 0.2,
  },
  sidebarSub: {
    marginTop: 2,
    color: THEME.colors.muted,
    fontWeight: '700',
    fontSize: 12,
  },
  sidebarUserCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.md,
    padding: 12,
    backgroundColor: THEME.colors.bg,
  },
  sidebarUserName: {
    fontWeight: '900',
    color: THEME.colors.text,
  },
  sidebarUserMeta: {
    marginTop: 4,
    color: THEME.colors.muted,
    fontWeight: '700',
    fontSize: 12,
  },
  sidebarPillsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  sidebarNav: {
    marginTop: 12,
    gap: 8,
  },
  sidebarNavItem: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: THEME.colors.surface,
  },
  sidebarNavItemActive: {
    borderColor: THEME.colors.primary,
  },
  sidebarNavItemPressed: {
    opacity: 0.92,
  },
  sidebarNavText: {
    fontWeight: '900',
    color: THEME.colors.text,
    letterSpacing: 0.2,
  },
  sidebarActions: {
    marginTop: 'auto',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
  },
  staffScroll: {
    flex: 1,
  },
  staffContainer: {
    flexGrow: 1,
    padding: 18,
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
  },
  header: {
    marginBottom: 10,
    paddingTop: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: THEME.colors.text,
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 4,
    color: THEME.colors.muted,
    fontWeight: '600',
  },
  screenWrap: {
    width: '100%',
  },
  card: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.md,
    padding: 14,
    marginTop: 12,
    backgroundColor: THEME.colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  topBar: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  segmentBtn: {
    flexGrow: 1,
    minWidth: 160,
  },
  field: {
    marginTop: 12,
  },
  label: {
    marginBottom: 4,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.borderStrong,
    borderRadius: THEME.radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: THEME.colors.surface,
    color: THEME.colors.text,
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: THEME.colors.borderStrong,
    borderRadius: THEME.radius.sm,
    overflow: 'hidden',
    backgroundColor: THEME.colors.surface,
  },
  picker: {
    height: 44,
  },
  hint: {
    marginTop: 6,
    color: THEME.colors.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  spacer: {
    width: 12,
    height: 8,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
  },
  actionBtn: {
    marginRight: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  sectionBlock: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.md,
    padding: 12,
    backgroundColor: THEME.colors.surface,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  sectionBlockTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.2,
    color: THEME.colors.text,
  },
  selectedChip: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: THEME.colors.bg,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  selectedChipText: {
    fontWeight: '900',
    color: THEME.colors.text,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  textarea: {
    minHeight: 86,
    paddingTop: 10,
  },
  item: {
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    paddingVertical: 10,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  itemTitle: {
    fontWeight: '700',
    color: THEME.colors.text,
  },
  itemMeta: {
    color: THEME.colors.muted,
    marginTop: 2,
    flexShrink: 1,
  },
  itemBody: {
    marginTop: 4,
    flexShrink: 1,
    color: THEME.colors.text,
  },
  availabilityList: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.sm,
    overflow: 'hidden',
    backgroundColor: THEME.colors.surface,
  },
  availabilityRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  availabilityTime: {
    fontWeight: '800',
    color: THEME.colors.text,
  },
  availabilityMeta: {
    color: THEME.colors.muted,
    fontWeight: '700',
  },
  errorBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: THEME.radius.sm,
    backgroundColor: THEME.colors.dangerBg,
    borderWidth: 1,
    borderColor: THEME.colors.dangerBorder,
  },
  errorText: {
    color: THEME.colors.dangerText,
  },

  btn: {
    borderRadius: THEME.radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: THEME.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  btnPrimary: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  btnSecondary: {
    backgroundColor: THEME.colors.surface,
    borderColor: THEME.colors.accent,
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  btnPressed: {
    opacity: 0.9,
  },
  btnText: {
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  btnTextPrimary: {
    color: THEME.colors.primaryText,
  },
  btnTextSecondary: {
    color: THEME.colors.text,
  },
  btnTextDisabled: {
    color: THEME.colors.muted,
  },
  formActions: {
    marginTop: 14,
  },
  grid2: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  gridCol: {
    flexGrow: 1,
    minWidth: 240,
  },

  accountCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.md,
    padding: 14,
    backgroundColor: THEME.colors.surface,
  },
  accountHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  accountTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.colors.text,
  },
  accountSub: {
    marginTop: 2,
    color: THEME.colors.muted,
    fontWeight: '700',
  },
  accountGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  accountCell: {
    minWidth: 220,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.sm,
    padding: 10,
  },
  accountLabel: {
    color: THEME.colors.muted,
    fontWeight: '700',
    fontSize: 12,
  },
  accountValue: {
    marginTop: 4,
    color: THEME.colors.text,
    fontWeight: '800',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  badgeStudent: {
    backgroundColor: THEME.colors.successBg,
    borderColor: THEME.colors.border,
  },
  badgeStaff: {
    backgroundColor: THEME.colors.bg,
    borderColor: THEME.colors.border,
  },
  badgeText: {
    fontWeight: '900',
    letterSpacing: 0.8,
    fontSize: 12,
  },
  badgeTextStudent: {
    color: THEME.colors.successText,
  },
  badgeTextStaff: {
    color: THEME.colors.text,
  },

  accountRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  accountMiniCell: {
    minWidth: 220,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.sm,
    padding: 10,
    backgroundColor: THEME.colors.surface,
  },

  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  pillNeutral: {
    backgroundColor: THEME.colors.bg,
  },
  pillSuccess: {
    backgroundColor: THEME.colors.successBg,
  },
  pillDanger: {
    backgroundColor: THEME.colors.dangerBg,
  },
  pillText: {
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.7,
    color: THEME.colors.text,
  },

  calendarCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radius.md,
    padding: 10,
    backgroundColor: THEME.colors.surface,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calendarNavBtn: {
    minWidth: 42,
  },
  calendarTitle: {
    fontWeight: '700',
    color: THEME.colors.text,
  },
  calendarWeekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calendarWeekday: {
    width: 40,
    textAlign: 'center',
    color: THEME.colors.muted,
    fontWeight: '600',
  },
  calendarWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calendarDay: {
    width: 40,
    height: 36,
    borderRadius: THEME.radius.sm,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayEmpty: {
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  calendarDayAvailable: {
    backgroundColor: THEME.colors.successBg,
  },
  calendarDayFull: {
    backgroundColor: THEME.colors.dangerBg,
  },
  calendarDaySelected: {
    borderColor: THEME.colors.primary,
    borderWidth: 2,
  },
  calendarDayPressed: {
    opacity: 0.8,
  },
  calendarDayDisabled: {
    opacity: 0.5,
  },
  calendarDayText: {
    fontWeight: '700',
    color: THEME.colors.text,
  },
  calendarDayWeekend: {
    backgroundColor: 'transparent',
  },
  calendarDayWeekendText: {
    fontWeight: '700',
    color: THEME.colors.muted,
  },
  calendarLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  legendChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: THEME.radius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  legendAvailable: {
    backgroundColor: THEME.colors.successBg,
    marginRight: 8,
  },
  legendFull: {
    backgroundColor: THEME.colors.dangerBg,
  },
  legendText: {
    fontWeight: '700',
    color: THEME.colors.text,
  },
});

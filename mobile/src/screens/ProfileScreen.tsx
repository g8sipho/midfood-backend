import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../api/client';
import Button from '../components/Button';
import { colors, radius, spacing } from '../theme/colors';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function changePassword() {
    setPwDone(false);
    if (!currentPassword || !newPassword) {
      setPwError('Enter your current password and a new one.');
      return;
    }
    if (newPassword.length < 6) {
      setPwError('Your new password must be at least 6 characters.');
      return;
    }
    setPwError(null);
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPwDone(true);
    } catch (err: any) {
      setPwError(err.message || 'Could not change the password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{user?.name?.charAt(0) || '?'}</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        {user?.phone ? (
          <Text style={styles.email}>{user.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3')}</Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account</Text>
          <Text style={styles.cardText}>Member since {user ? new Date(user.createdAt).toLocaleDateString() : '—'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Change password</Text>
          {pwError ? <Text style={styles.error}>{pwError}</Text> : null}
          {pwDone ? <Text style={styles.ok}>Password changed.</Text> : null}
          <Text style={styles.label}>Current password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            textContentType="password"
            placeholder="Your current password"
            placeholderTextColor={colors.textTertiary}
            value={currentPassword}
            onChangeText={setCurrentPassword}
          />
          <Text style={styles.label}>New password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            textContentType="newPassword"
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textTertiary}
            value={newPassword}
            onChangeText={setNewPassword}
            onSubmitEditing={changePassword}
          />
          <Button title="Change password" onPress={changePassword} loading={saving} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Need help?</Text>
          <Text style={styles.cardText}>Call or WhatsApp MidFood on 072 643 7784.</Text>
        </View>

        <Button title="Log out" variant="secondary" onPress={logout} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  content: {
    padding: spacing.lg,
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
  name: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  email: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  card: {
    width: '100%',
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  cardTitle: {
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  cardText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  input: {
    backgroundColor: colors.bgApp,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  error: {
    color: colors.accentError,
    fontSize: 13,
  },
  ok: {
    color: colors.accentSuccess,
    fontSize: 13,
  },
});

import React, { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import * as api from '../api/client';
import Button from '../components/Button';
import Txt from '../components/Txt';
import { Card, Field, Icon } from '../components/ui';
import { colors, night, radius, spacing } from '../theme';

const SUPPORT_PHONE = '0726437784';
const SUPPORT_SHOWN = '072 643 7784';

export default function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasPassword = user?.hasPassword !== false;
  const signsInWith = user?.linked?.google ? 'Google' : user?.linked?.facebook ? 'Facebook' : null;

  async function changePassword() {
    setPwDone(false);
    if ((hasPassword && !currentPassword) || !newPassword) {
      setPwError(hasPassword ? 'Enter your current password and a new one.' : 'Choose a password.');
      return;
    }
    if (newPassword.length < 6) {
      setPwError('The new password needs at least 6 characters.');
      return;
    }
    setPwError(null);
    setSaving(true);
    try {
      await api.changePassword(hasPassword ? currentPassword : null, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPwDone(true);
      refreshUser();
    } catch (err: any) {
      setPwError(err.message || "Couldn't change the password.");
    } finally {
      setSaving(false);
    }
  }

  const initials = (user?.name || '?')
    .split(' ')
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl * 2 }]} keyboardShouldPersistTaps="handled">
        <LinearGradient colors={[...night]} start={{ x: 0, y: 0 }} end={{ x: 0.3, y: 1 }} style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
          <View style={styles.sun} />
          <View style={styles.avatar}>
            <Txt variant="title" color={colors.onDark}>
              {initials}
            </Txt>
          </View>
          <Txt variant="title" color={colors.onDark} style={{ marginTop: spacing.md }}>
            {user?.name}
          </Txt>
          <Txt variant="small" color={colors.onDarkSoft}>
            {user?.email}
            {user?.phone ? ` · ${user.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3')}` : ''}
          </Txt>
          <Txt variant="small" color={colors.onDarkSoft}>
            With MidFood since {user ? new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' }) : '—'}
          </Txt>
        </LinearGradient>

        <View style={styles.body}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <RowLink icon="chat-processing-outline" title="Chat with MidFood" sub="Orders, refunds, anything" onPress={() => navigation.navigate('ChatsTab', { screen: 'ChatThread', params: { title: 'MidFood support' } })} />
            <RowLink icon="whatsapp" title="WhatsApp MidFood" sub={SUPPORT_SHOWN} onPress={() => Linking.openURL(`https://wa.me/27${SUPPORT_PHONE.slice(1)}`)} />
            <RowLink icon="phone-outline" title="Call MidFood" sub={SUPPORT_SHOWN} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)} last />
          </Card>

          <Card style={{ padding: 0, overflow: 'hidden', marginTop: spacing.lg }}>
            <RowLink
              icon={hasPassword ? 'lock-outline' : 'lock-plus-outline'}
              title={hasPassword ? 'Change password' : 'Add a password'}
              sub={showPassword ? 'Hide' : hasPassword ? 'Keep your account yours' : `You sign in with ${signsInWith || 'a linked account'} — a password works too`}
              onPress={() => setShowPassword((s) => !s)}
              last={!showPassword}
            />
            {showPassword ? (
              <View style={styles.passwordForm}>
                {pwError ? (
                  <Txt variant="small" color={colors.berry}>
                    {pwError}
                  </Txt>
                ) : null}
                {pwDone ? (
                  <Txt variant="small" color={colors.mint}>
                    {hasPassword ? 'Password changed.' : 'Password set. You can now sign in with it too.'}
                  </Txt>
                ) : null}
                {hasPassword ? (
                  <Field label="Current password" secureTextEntry textContentType="password" placeholder="Your current password" value={currentPassword} onChangeText={setCurrentPassword} />
                ) : null}
                <Field label={hasPassword ? 'New password' : 'Password'} secureTextEntry textContentType="newPassword" placeholder="At least 6 characters" value={newPassword} onChangeText={setNewPassword} onSubmitEditing={changePassword} style={hasPassword ? { marginTop: spacing.sm } : undefined} />
                <Button title={hasPassword ? 'Save new password' : 'Save password'} variant="dark" onPress={changePassword} loading={saving} style={{ marginTop: spacing.md }} />
              </View>
            ) : null}
          </Card>

          <Card style={{ padding: 0, overflow: 'hidden', marginTop: spacing.lg }}>
            <RowLink icon="store-plus-outline" title="Own a shop or restaurant?" sub="Sell on MidFood — 3 months commission-free" onPress={() => Linking.openURL('https://midfood.co.za/portal/')} />
            <RowLink icon="moped" title="Drive for MidFood" sub="Earn per delivery, paid every Tuesday" onPress={() => Linking.openURL('https://midfood.co.za/driver/')} />
            <RowLink icon="shield-account-outline" title="Privacy" sub="How MidFood looks after your details" onPress={() => Linking.openURL('https://midfood.co.za/privacy/')} last />
          </Card>

          <Button title="Log out" variant="secondary" icon="logout" onPress={logout} style={{ marginTop: spacing.xl }} />
          <Txt variant="small" center style={{ marginTop: spacing.lg }}>
            MidFood · Middelburg's food, delivered to your door
          </Txt>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RowLink({ icon, title, sub, onPress, last }: { icon: any; title: string; sub?: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.rowLink, !last && styles.rowLinkBorder, pressed && { backgroundColor: colors.paper }]}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={20} color={colors.ember} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="subheading">{title}</Txt>
        {sub ? <Txt variant="small">{sub}</Txt> : null}
      </View>
      <Icon name="chevron-right" size={20} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  hero: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
  },
  sun: {
    position: 'absolute',
    top: -60,
    right: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.ember,
    opacity: 0.85,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: spacing.lg,
  },
  rowLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  rowLinkBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.emberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordForm: {
    padding: spacing.md,
    paddingTop: 0,
    gap: spacing.xs,
  },
});

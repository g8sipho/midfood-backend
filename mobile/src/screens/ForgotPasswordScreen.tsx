import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';
import { colors, radius, spacing } from '../theme/colors';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

// Two steps on one screen: ask where to send the code, then take the code
// and the new password. A successful reset signs the customer straight in.
export default function ForgotPasswordScreen({ navigation, route }: Props) {
  const { resetPassword } = useAuth();
  const [identifier, setIdentifier] = useState(route.params?.identifier || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendCode() {
    if (!identifier.trim()) {
      setError('Enter the email address or cellphone number on your account.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await api.forgotPassword(identifier.trim());
      setCodeSent(true);
      setHint(result.emailHint ? `Code sent to ${result.emailHint}. It is valid for 15 minutes.` : result.message);
    } catch (err: any) {
      setError(err.message || 'Could not send the code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function finish() {
    if (code.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    if (password.length < 6) {
      setError('Your new password must be at least 6 characters.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await resetPassword(identifier.trim(), code, password);
      // Signed in now; RootNavigator swaps to the main tabs by itself.
    } catch (err: any) {
      setError(err.message || 'That did not work. Please try again.');
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.sub}>
            {codeSent
              ? 'Check your email for the code (look in spam too), then choose a new password.'
              : "We'll email a 6-digit code to the address on your account."}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {hint && !error ? <Text style={styles.ok}>{hint}</Text> : null}

          <Text style={styles.label}>Email or cellphone number</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com or 082 123 4567"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            value={identifier}
            onChangeText={setIdentifier}
            editable={!codeSent}
            onSubmitEditing={codeSent ? undefined : sendCode}
          />

          {codeSent ? (
            <>
              <Text style={styles.label}>The 6-digit code from the email</Text>
              <TextInput
                style={styles.input}
                placeholder="123456"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={7}
                value={code}
                onChangeText={setCode}
              />
              <Text style={styles.label}>New password</Text>
              <TextInput
                style={styles.input}
                placeholder="At least 6 characters"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry
                textContentType="newPassword"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={finish}
              />
              <Button title="Set new password" onPress={finish} loading={loading} />
              <Pressable onPress={sendCode} hitSlop={8} style={styles.link} disabled={loading}>
                <Text style={styles.linkText}>Didn't get it? Send the code again</Text>
              </Pressable>
            </>
          ) : (
            <Button title="Email me a code" onPress={sendCode} loading={loading} />
          )}
        </View>

        <View style={styles.footer}>
          <Button title="Back to sign in" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sub: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
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
  link: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
  },
  linkText: {
    color: colors.accentPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  footer: {
    marginTop: spacing.xl,
  },
});

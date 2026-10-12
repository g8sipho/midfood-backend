import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';
import { colors, radius, spacing } from '../theme/colors';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    const digits = phone.replace(/[\s()-]/g, '');
    if (!name.trim()) return setError('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Please enter a valid email address.');
    if (!/^(0\d{9}|\+27\d{9})$/.test(digits)) {
      return setError('Please enter a valid cellphone number, e.g. 082 123 4567.');
    }
    if (password.length < 6) return setError('Your password needs at least 6 characters.');
    setError(null);
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), digits, password);
    } catch (err: any) {
      setError(err.message || 'Something went wrong creating your account.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>
          Your number is how the driver reaches you at the door, and you can sign in with it too.
        </Text>

        <View style={styles.card}>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.label}>Full name</Text>
          <TextInput
            style={styles.input}
            placeholder="Thandi Nkosi"
            placeholderTextColor={colors.textTertiary}
            textContentType="name"
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
          />
          <Text style={styles.label}>Cellphone number</Text>
          <TextInput
            style={styles.input}
            placeholder="082 123 4567"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            value={phone}
            onChangeText={setPhone}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            textContentType="newPassword"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={handleRegister}
          />

          <Button title="Create account" onPress={handleRegister} loading={loading} />
        </View>

        <View style={styles.footer}>
          <Button title="I already have an account" variant="secondary" onPress={() => navigation.goBack()} />
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
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
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
  footer: {
    marginTop: spacing.lg,
  },
});

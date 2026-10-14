import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/AuthShell';
import Button from '../components/Button';
import SocialButtons from '../components/SocialButtons';
import Txt from '../components/Txt';
import { Field } from '../components/ui';
import { colors, spacing } from '../theme';
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
    if (!name.trim()) return setError('Enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (!/^(0\d{9}|\+27\d{9})$/.test(digits)) return setError('Enter a cellphone number like 082 123 4567.');
    if (password.length < 6) return setError('Your password needs at least 6 characters.');
    setError(null);
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), digits, password);
    } catch (err: any) {
      setError(err.message || "Couldn't create the account. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Join MidFood"
      lead="Your number is how the driver reaches you at the gate — and you can sign in with it."
      onBack={() => navigation.goBack()}
      footer={
        <>
          <Txt variant="small" color={colors.onDarkSoft}>
            Already have an account?
          </Txt>
          <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
            <Txt variant="subheading" color={colors.onDark}>
              Sign in
            </Txt>
          </Pressable>
        </>
      }
    >
      <SocialButtons onError={setError} />
      <View style={styles.or}>
        <View style={styles.orLine} />
        <Txt variant="small">or with your email</Txt>
        <View style={styles.orLine} />
      </View>
      {error ? (
        <Txt variant="small" color={colors.berry}>
          {error}
        </Txt>
      ) : null}
      <Field label="Full name" icon="account-outline" placeholder="Thandi Nkosi" textContentType="name" value={name} onChangeText={setName} />
      <Field label="Email" icon="email-outline" placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" value={email} onChangeText={setEmail} />
      <Field label="Cellphone number" icon="phone-outline" placeholder="082 123 4567" keyboardType="phone-pad" textContentType="telephoneNumber" value={phone} onChangeText={setPhone} />
      <Field label="Password" icon="lock-outline" placeholder="At least 6 characters" secureTextEntry textContentType="newPassword" value={password} onChangeText={setPassword} onSubmitEditing={handleRegister} />
      <Button title="Create my account" onPress={handleRegister} loading={loading} />
      <Txt variant="small" center>
        By joining you agree to MidFood's privacy policy at midfood.co.za/privacy.
      </Txt>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  or: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
});

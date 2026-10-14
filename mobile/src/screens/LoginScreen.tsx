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

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!identifier.trim() || !password) {
      setError('Enter your email or cellphone number, and your password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(identifier.trim(), password);
    } catch (err: any) {
      setError(err.message || "Couldn't sign you in. Check the details and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={'Hungry?\nWe deliver.'}
      lead="Middelburg's restaurants and shops, to your door."
      footer={
        <>
          <Txt variant="small" color={colors.onDarkSoft}>
            New to MidFood?
          </Txt>
          <Pressable onPress={() => navigation.navigate('Register')} hitSlop={8}>
            <Txt variant="subheading" color={colors.onDark}>
              Create an account
            </Txt>
          </Pressable>
        </>
      }
    >
      <SocialButtons onError={setError} />
      <View style={styles.or}>
        <View style={styles.orLine} />
        <Txt variant="small">or sign in with a password</Txt>
        <View style={styles.orLine} />
      </View>
      {error ? (
        <Txt variant="small" color={colors.berry}>
          {error}
        </Txt>
      ) : null}
      <Field
        label="Email or cellphone number"
        icon="account-outline"
        placeholder="you@example.com or 082 123 4567"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        value={identifier}
        onChangeText={setIdentifier}
      />
      <Field
        label="Password"
        icon="lock-outline"
        placeholder="Your password"
        secureTextEntry
        textContentType="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={handleLogin}
      />
      <Button title="Sign in" onPress={handleLogin} loading={loading} />
      <Pressable onPress={() => navigation.navigate('ForgotPassword', { identifier: identifier.trim() })} hitSlop={8} style={{ alignSelf: 'center' }}>
        <Txt variant="smallBold" color={colors.ember}>
          Forgot your password?
        </Txt>
      </Pressable>
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

import React, { useState } from 'react';
import { Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as api from '../api/client';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/AuthShell';
import Button from '../components/Button';
import Txt from '../components/Txt';
import { Field } from '../components/ui';
import { colors } from '../theme';
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
      setHint(result.emailHint ? `Code sent to ${result.emailHint}. It works for 15 minutes.` : result.message);
    } catch (err: any) {
      setError(err.message || "Couldn't send the code. Try again.");
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
      setError('Your new password needs at least 6 characters.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await resetPassword(identifier.trim(), code, password);
    } catch (err: any) {
      setError(err.message || "That didn't work. Check the code and try again.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Reset password"
      lead={codeSent ? 'Check your email for the code (spam folder too), then choose a new password.' : "We'll email a 6-digit code to the address on your account."}
      onBack={() => navigation.goBack()}
    >
      {error ? (
        <Txt variant="small" color={colors.berry}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="small" color={colors.mint}>
          {hint}
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
        editable={!codeSent}
        onSubmitEditing={codeSent ? undefined : sendCode}
      />
      {codeSent ? (
        <>
          <Field label="The 6-digit code" icon="numeric" placeholder="123456" keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={7} value={code} onChangeText={setCode} />
          <Field label="New password" icon="lock-outline" placeholder="At least 6 characters" secureTextEntry textContentType="newPassword" value={password} onChangeText={setPassword} onSubmitEditing={finish} />
          <Button title="Set password and sign in" onPress={finish} loading={loading} />
          <Pressable onPress={sendCode} hitSlop={8} style={{ alignSelf: 'center' }}>
            <Txt variant="smallBold" color={colors.ember}>
              Send a new code
            </Txt>
          </Pressable>
        </>
      ) : (
        <Button title="Email me a code" onPress={sendCode} loading={loading} />
      )}
    </AuthShell>
  );
}

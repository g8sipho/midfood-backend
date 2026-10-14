import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Txt from './Txt';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing } from '../theme';
import type { SocialProvider } from '../types';

// "Continue with Google / Facebook". One tap, no password to remember; the
// account is created on the first sign-in.
export default function SocialButtons({ onError, onDark }: { onError: (message: string) => void; onDark?: boolean }) {
  const { socialLogin } = useAuth();
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  async function go(provider: SocialProvider) {
    setBusy(provider);
    try {
      await socialLogin(provider);
    } catch (err: any) {
      onError(err.message || `Couldn't sign in with ${provider === 'google' ? 'Google' : 'Facebook'}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.row}>
      <Pressable onPress={() => go('google')} disabled={busy !== null} style={({ pressed }) => [styles.btn, onDark && styles.btnDark, pressed && { opacity: 0.85 }, busy === 'google' && { opacity: 0.6 }]}>
        <MaterialCommunityIcons name="google" size={20} color="#DB4437" />
        <Txt variant="smallBold" color={onDark ? colors.onDark : colors.ink}>
          Google
        </Txt>
      </Pressable>
      <Pressable onPress={() => go('facebook')} disabled={busy !== null} style={({ pressed }) => [styles.btn, onDark && styles.btnDark, pressed && { opacity: 0.85 }, busy === 'facebook' && { opacity: 0.6 }]}>
        <MaterialCommunityIcons name="facebook" size={20} color="#1877F2" />
        <Txt variant="smallBold" color={onDark ? colors.onDark : colors.ink}>
          Facebook
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  btnDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.22)',
  },
});

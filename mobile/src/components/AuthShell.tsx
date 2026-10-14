import React from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Txt from './Txt';
import { Icon } from './ui';
import { colors, night, radius, spacing } from '../theme';

// The frame around every sign-in screen: the plum sky with the logo and a
// line of welcome, and a paper card for the form.
export default function AuthShell({
  title,
  lead,
  onBack,
  children,
  footer,
}: {
  title: string;
  lead?: string;
  onBack?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={[...night]} start={{ x: 0, y: 0 }} end={{ x: 0.3, y: 1 }} style={styles.sky}>
      <View style={styles.sun} />
      <View style={styles.sunGlow} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          <View style={styles.top}>
            {onBack ? (
              <Pressable onPress={onBack} hitSlop={10} style={styles.back}>
                <Icon name="arrow-left" size={22} color={colors.onDark} />
              </Pressable>
            ) : null}
            <Image source={require('../../assets/logo-white.png')} style={styles.logo} resizeMode="contain" />
            <Txt variant="hero" color={colors.onDark} style={styles.title}>
              {title}
            </Txt>
            {lead ? (
              <Txt variant="body" color={colors.onDarkSoft} style={{ marginTop: 6, maxWidth: 320 }}>
                {lead}
              </Txt>
            ) : null}
          </View>
          <View style={styles.card}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  sky: {
    flex: 1,
  },
  sun: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.ember,
    opacity: 0.9,
  },
  sunGlow: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: colors.flameStart,
    opacity: 0.16,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'flex-end',
  },
  top: {
    marginBottom: spacing.xl,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  logo: {
    width: 150,
    height: 38,
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  footer: {
    marginTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
});

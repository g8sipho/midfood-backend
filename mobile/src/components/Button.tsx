import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Txt from './Txt';
import { colors, flame, radius, shadow, spacing } from '../theme';

type Props = {
  title: string;
  onPress: () => void;
  // primary: the ember gradient, for the one thing to do on a screen.
  // dark: plum, for a strong second action. secondary: outlined. ghost: text.
  variant?: 'primary' | 'dark' | 'secondary' | 'ghost' | 'whatsapp';
  size?: 'md' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  // Text shown at the right edge, e.g. the total on "Place order".
  trailing?: string;
  style?: ViewStyle;
};

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  icon,
  trailing,
  style,
}: Props) {
  const inactive = disabled || loading;
  const onDark = variant === 'primary' || variant === 'dark' || variant === 'whatsapp';
  const tint = onDark ? colors.onDark : variant === 'ghost' ? colors.ember : colors.ink;
  const small = size === 'sm';

  const content = loading ? (
    <ActivityIndicator color={tint} />
  ) : (
    <View style={styles.row}>
      {icon ? <MaterialCommunityIcons name={icon} size={small ? 18 : 22} color={tint} style={styles.icon} /> : null}
      <Txt variant="button" color={tint} style={small ? styles.smallText : null}>
        {title}
      </Txt>
      {trailing ? (
        <Txt variant="button" color={tint} style={styles.trailing}>
          {trailing}
        </Txt>
      ) : null}
    </View>
  );

  const press = () => {
    Haptics.selectionAsync().catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={press}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        variant === 'dark' && styles.dark,
        variant === 'secondary' && styles.secondary,
        variant === 'whatsapp' && styles.whatsapp,
        variant === 'primary' && !inactive && shadow.ember,
        inactive && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={[...flame]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fill, small && styles.small]}>
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  fill: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    minHeight: 54,
  },
  small: {
    minHeight: 40,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
  },
  dark: {
    backgroundColor: colors.plum,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
  },
  whatsapp: {
    backgroundColor: colors.whatsapp,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.92,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: spacing.sm,
  },
  smallText: {
    fontSize: 14,
  },
  trailing: {
    marginLeft: spacing.md,
    opacity: 0.85,
  },
});

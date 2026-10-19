// The small building blocks every screen shares: chips, pills, cards,
// inputs, skeleton loaders, the quantity stepper, empty states.
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Txt from './Txt';
import { colors, fonts, radius, shadow, spacing, tint } from '../theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export function Icon({ name, size = 20, color = colors.ink, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} style={style as any} />;
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, shadow.card, pressed && styles.cardPressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, shadow.card, style]}>{children}</View>;
}

export function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={[styles.chip, active && styles.chipActive]}
    >
      {icon ? <Icon name={icon} size={16} color={active ? colors.onDark : colors.ink} style={{ marginRight: 6 }} /> : null}
      <Txt variant="smallBold" color={active ? colors.onDark : colors.ink}>
        {label}
      </Txt>
    </Pressable>
  );
}

// One of a few options to pick from ("R10", "Tomorrow", "18:30"): outlined,
// and ember when chosen. Unlike Chip it never goes plum, so a row of them
// reads as a question with one answer.
export function Choice({
  label,
  active,
  onPress,
  disabled,
  style,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      disabled={disabled}
      style={({ pressed }) => [styles.choice, active && styles.choiceActive, disabled && styles.choiceOff, pressed && !disabled && { opacity: 0.8 }, style]}
    >
      <Txt variant="smallBold" color={active ? colors.emberDeep : colors.ink}>
        {label}
      </Txt>
    </Pressable>
  );
}

// A small coloured tag: "Open", "25 min", "New".
export function Pill({
  label,
  tone = 'neutral',
  icon,
  style,
}: {
  label: string;
  tone?: 'neutral' | 'mint' | 'mango' | 'berry' | 'ember' | 'dark' | 'light';
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const tones = {
    neutral: { bg: colors.sand, fg: colors.ink },
    mint: { bg: colors.mintSoft, fg: colors.mint },
    mango: { bg: colors.mangoSoft, fg: '#9A6300' },
    berry: { bg: colors.berrySoft, fg: colors.berry },
    ember: { bg: colors.emberSoft, fg: colors.emberDeep },
    dark: { bg: 'rgba(23,10,31,0.78)', fg: colors.onDark },
    light: { bg: 'rgba(255,255,255,0.94)', fg: colors.ink },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: tones.bg }, style]}>
      {icon ? <Icon name={icon} size={13} color={tones.fg} style={{ marginRight: 4 }} /> : null}
      <Txt variant="smallBold" color={tones.fg} style={{ fontSize: 11.5, lineHeight: 15 }}>
        {label}
      </Txt>
    </View>
  );
}

// A circle with a photo, or the kitchen's initial on its own colour.
export function Avatar({
  uri,
  name,
  color,
  size = 48,
  square,
}: {
  uri?: string | null;
  name: string;
  color?: string | null;
  size?: number;
  square?: boolean;
}) {
  const r = square ? radius.md : size / 2;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: r, backgroundColor: tint(color, 0.22) }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: r }} resizeMode="cover" />
      ) : (
        <Txt variant="heading" color={color || colors.ember} style={{ fontSize: size * 0.42, lineHeight: size * 0.5 }}>
          {name.trim().charAt(0).toUpperCase()}
        </Txt>
      )}
    </View>
  );
}

// A labelled text box. Errors sit under the box, never in an alert.
export function Field({
  label,
  hint,
  error,
  icon,
  style,
  ...input
}: TextInputProps & { label?: string; hint?: string; error?: string | null; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={style}>
      {label ? (
        <Txt variant="label" style={styles.fieldLabel}>
          {label}
        </Txt>
      ) : null}
      <View style={[styles.field, focused && styles.fieldFocused, error ? styles.fieldError : null, input.multiline && styles.fieldMulti]}>
        {icon ? <Icon name={icon} size={20} color={focused ? colors.ember : colors.inkFaint} style={{ marginRight: spacing.sm }} /> : null}
        <TextInput
          placeholderTextColor={colors.inkFaint}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, input.multiline && styles.inputMulti]}
        />
      </View>
      {error ? (
        <Txt variant="small" color={colors.berry} style={styles.fieldHint}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="small" style={styles.fieldHint}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// − 2 + control, dark so it reads as "in the cart".
export function Stepper({ value, onChange, size = 'md' }: { value: number; onChange: (n: number) => void; size?: 'md' | 'lg' }) {
  const big = size === 'lg';
  const bump = (n: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onChange(n);
  };
  return (
    <View style={[styles.stepper, big && styles.stepperLg]}>
      <Pressable style={[styles.stepBtn, big && styles.stepBtnLg]} onPress={() => bump(value - 1)} hitSlop={6}>
        <Icon name={value <= 1 ? 'trash-can-outline' : 'minus'} size={big ? 20 : 16} color={colors.onDark} />
      </Pressable>
      <Txt variant="subheading" color={colors.onDark} style={[styles.stepQty, big && { fontSize: 18, minWidth: 28 }]}>
        {value}
      </Txt>
      <Pressable style={[styles.stepBtn, big && styles.stepBtnLg]} onPress={() => bump(value + 1)} hitSlop={6}>
        <Icon name="plus" size={big ? 20 : 16} color={colors.onDark} />
      </Pressable>
    </View>
  );
}

// Grey blocks that breathe while the real content loads.
export function Skeleton({ width, height, round, style }: { width?: number | `${number}%`; height: number; round?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[{ width: width ?? '100%', height, borderRadius: round ?? radius.sm, backgroundColor: colors.sandDeep, opacity: pulse }, style]}
    />
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={30} color={colors.ember} />
      </View>
      <Txt variant="heading" center>
        {title}
      </Txt>
      {body ? (
        <Txt variant="body" color={colors.inkSoft} center style={{ marginTop: 6, maxWidth: 280 }}>
          {body}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionRow}>
      <Txt variant="heading">{title}</Txt>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Txt variant="smallBold" color={colors.ember}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

// Round icon-only button, used over photos and in headers.
export function IconButton({
  name,
  onPress,
  tone = 'light',
  size = 40,
  badge,
}: {
  name: IconName;
  onPress: () => void;
  tone?: 'light' | 'dark' | 'ember';
  size?: number;
  badge?: number;
}) {
  const bg = tone === 'light' ? 'rgba(255,255,255,0.94)' : tone === 'dark' ? 'rgba(23,10,31,0.6)' : colors.ember;
  const fg = tone === 'light' ? colors.ink : colors.onDark;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }, pressed && { opacity: 0.8 }]}
    >
      <Icon name={name} size={size * 0.55} color={fg} />
      {badge ? (
        <View style={styles.badge}>
          <Txt variant="smallBold" color={colors.onDark} style={{ fontSize: 10, lineHeight: 12 }}>
            {badge > 99 ? '99+' : badge}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export const Mono = { fontFamily: fonts.medium };

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  cardPressed: {
    transform: [{ scale: 0.99 }],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipActive: {
    backgroundColor: colors.plum,
    borderColor: colors.plum,
  },
  choice: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceActive: {
    backgroundColor: colors.emberSoft,
    borderColor: colors.ember,
  },
  choiceOff: {
    opacity: 0.4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 9,
    alignSelf: 'flex-start',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fieldLabel: {
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  fieldMulti: {
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    minHeight: 84,
  },
  fieldFocused: {
    borderColor: colors.ember,
  },
  fieldError: {
    borderColor: colors.berry,
  },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 12,
  },
  inputMulti: {
    textAlignVertical: 'top',
    minHeight: 64,
  },
  fieldHint: {
    marginTop: 6,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.plum,
    borderRadius: radius.pill,
    padding: 3,
  },
  stepperLg: {
    padding: 5,
  },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.plumSoft,
  },
  stepBtnLg: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  stepQty: {
    minWidth: 24,
    textAlign: 'center',
    marginHorizontal: 2,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.emberSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

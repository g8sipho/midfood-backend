import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { imageSource } from '../api/client';
import Txt from './Txt';
import { Icon, Pill } from './ui';
import { colors, radius, shadow, spacing, tint } from '../theme';
import type { Restaurant } from '../types';

// A store on the home feed: its cover photo with the name set on it, the
// facts a hungry person decides on along the bottom, and a heart to keep it.
export default function RestaurantCard({
  restaurant,
  onPress,
  favourite,
  onToggleFavourite,
}: {
  restaurant: Restaurant;
  onPress: () => void;
  favourite?: boolean;
  onToggleFavourite?: () => void;
}) {
  const closed = restaurant.open === false;
  const cover = imageSource(restaurant.thumbUrl || restaurant.imageUrl);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, shadow.card, pressed && styles.pressed]}>
      <View style={[styles.cover, { backgroundColor: tint(restaurant.heroColor, 0.35) }]}>
        {cover ? (
          <Image source={cover} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Txt variant="hero" color={restaurant.heroColor || colors.ember} style={styles.initial}>
            {restaurant.name.charAt(0)}
          </Txt>
        )}
        <LinearGradient colors={['rgba(23,10,31,0)', 'rgba(23,10,31,0.72)']} style={styles.shade} />
        <View style={styles.topRow}>
          <View style={styles.topPills}>
            <Pill label={restaurant.rating == null ? 'New' : `${restaurant.rating.toFixed(1)}`} icon={restaurant.rating == null ? undefined : 'star'} tone="light" />
            {closed ? <Pill label="Closed now" tone="dark" /> : <Pill label={`${restaurant.etaMinutes} min`} icon="clock-outline" tone="light" />}
          </View>
          {onToggleFavourite ? <HeartButton on={Boolean(favourite)} onPress={onToggleFavourite} /> : null}
        </View>
        <View style={styles.titleBlock}>
          <Txt variant="title" color={colors.onDark} numberOfLines={1} style={styles.name}>
            {restaurant.name}
          </Txt>
          <Txt variant="smallBold" color={colors.onDarkSoft} numberOfLines={1}>
            {restaurant.cuisine}
          </Txt>
        </View>
        {closed ? <View style={styles.closedWash} /> : null}
      </View>
      <View style={styles.foot}>
        <View style={styles.fact}>
          <Icon name="moped" size={16} color={colors.ember} />
          <Txt variant="smallBold">{restaurant.deliveryFee === 0 ? 'Free delivery' : `R${restaurant.deliveryFee} delivery`}</Txt>
        </View>
        {restaurant.matches && restaurant.matches.length > 0 ? (
          <Txt variant="small" color={colors.ember} numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
            {restaurant.matches.join(' · ')}
          </Txt>
        ) : (
          <View style={styles.fact}>
            <Txt variant="small">{closed ? 'Browse the menu' : 'Taking orders'}</Txt>
            <Icon name="chevron-right" size={18} color={colors.inkFaint} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

// The heart over a cover photo: white disc, ember when the store is kept.
export function HeartButton({ on, onPress, size = 36 }: { on: boolean; onPress: () => void; size?: number }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={on ? 'Remove from favourites' : 'Add to favourites'}
      style={({ pressed }) => [styles.heart, { width: size, height: size, borderRadius: size / 2 }, pressed && { transform: [{ scale: 0.9 }] }]}
    >
      <Icon name={on ? 'heart' : 'heart-outline'} size={size * 0.55} color={on ? colors.ember : colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  heart: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topPills: {
    flexDirection: 'row',
    gap: 6,
    flex: 1,
    flexWrap: 'wrap',
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
  cover: {
    height: 176,
    justifyContent: 'flex-end',
  },
  shade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  initial: {
    position: 'absolute',
    alignSelf: 'center',
    top: 48,
    fontSize: 72,
    lineHeight: 80,
    opacity: 0.55,
  },
  topRow: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleBlock: {
    padding: spacing.md,
  },
  name: {
    fontSize: 23,
    lineHeight: 27,
  },
  closedWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,247,240,0.35)',
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});

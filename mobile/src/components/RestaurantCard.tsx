import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme/colors';
import type { Restaurant } from '../types';

export default function RestaurantCard({
  restaurant,
  onPress,
}: {
  restaurant: Restaurant;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.hero, { backgroundColor: restaurant.heroColor }]}>
        <Text style={styles.heroInitial}>{restaurant.name.charAt(0)}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {restaurant.name}
        </Text>
        <Text style={styles.cuisine} numberOfLines={1}>
          {restaurant.cuisine}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>⭐ {restaurant.rating.toFixed(1)}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>{restaurant.etaMinutes} min</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>R{restaurant.deliveryFee} delivery</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.8,
  },
  hero: {
    width: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInitial: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  info: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  cuisine: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  meta: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  metaDot: {
    fontSize: 12,
    color: colors.textTertiary,
    marginHorizontal: 6,
  },
});

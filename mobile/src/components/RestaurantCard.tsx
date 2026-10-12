import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { imageSource } from '../api/client';
import { colors, radius, spacing } from '../theme/colors';
import type { Restaurant } from '../types';

// A restaurant on the home feed: a wide cover photo with the name over it,
// then the facts a hungry person decides on — rating, time, delivery fee —
// and whether it is taking orders right now.
export default function RestaurantCard({
  restaurant,
  onPress,
}: {
  restaurant: Restaurant;
  onPress: () => void;
}) {
  const closed = restaurant.open === false;
  const cover = imageSource(restaurant.thumbUrl || restaurant.imageUrl);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.cover, { backgroundColor: restaurant.heroColor }]}>
        {cover ? (
          <Image source={cover} style={styles.coverImage} resizeMode="cover" />
        ) : (
          <Text style={styles.coverInitial}>{restaurant.name.charAt(0)}</Text>
        )}
        <View style={styles.coverShade} />
        {closed ? (
          <View style={styles.closedPill}>
            <Text style={styles.closedPillText}>Closed now</Text>
          </View>
        ) : (
          <View style={styles.etaPill}>
            <Text style={styles.etaPillText}>{restaurant.etaMinutes} min</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {restaurant.name}
          </Text>
          <View style={styles.rating}>
            <Text style={styles.ratingText}>
              {restaurant.rating == null ? 'New' : `★ ${restaurant.rating.toFixed(1)}`}
            </Text>
          </View>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {restaurant.cuisine} · {restaurant.deliveryFee === 0 ? 'Free delivery' : `R${restaurant.deliveryFee} delivery`}
        </Text>
        {restaurant.matches && restaurant.matches.length > 0 ? (
          <Text style={styles.matches} numberOfLines={1}>
            {restaurant.matches.join(' · ')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadowCard,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  pressed: {
    opacity: 0.85,
  },
  cover: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImage: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    width: '100%',
    height: '100%',
  },
  coverShade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  coverInitial: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '800',
    opacity: 0.9,
  },
  etaPill: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  etaPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  closedPill: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: 'rgba(15,12,8,0.78)',
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  closedPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  info: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  rating: {
    backgroundColor: colors.bgMuted,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  meta: {
    marginTop: 3,
    fontSize: 13,
    color: colors.textSecondary,
  },
  matches: {
    marginTop: 4,
    fontSize: 12,
    color: colors.accentPrimary,
    fontWeight: '700',
  },
});

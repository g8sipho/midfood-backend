import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchRestaurant } from '../api/client';
import { useCart } from '../context/CartContext';
import { colors, radius, spacing } from '../theme/colors';
import type { Restaurant } from '../types';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'RestaurantDetail'>;

export default function RestaurantDetailScreen({ route, navigation }: Props) {
  const { restaurantId } = route.params;
  const { addItem, itemCount, restaurant: cartRestaurant } = useCart();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRestaurant(restaurantId)
      .then((r) => {
        setRestaurant(r);
        navigation.setOptions({ title: r.name });
      })
      .catch((err) => setError(err.message || 'Could not load this restaurant.'))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  if (loading) {
    return <ActivityIndicator style={styles.loading} color={colors.accentPrimary} />;
  }

  if (error || !restaurant) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error || 'Restaurant not found.'}</Text>
      </View>
    );
  }

  const switchingRestaurant = cartRestaurant && cartRestaurant.id !== restaurant.id;

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { backgroundColor: restaurant.heroColor }]}>
        <Text style={styles.heroTitle}>{restaurant.name}</Text>
        <Text style={styles.heroSubtitle}>
          {restaurant.cuisine} · {restaurant.rating == null ? 'New' : `⭐ ${restaurant.rating.toFixed(1)}`} · {restaurant.etaMinutes} min
        </Text>
      </View>

      {switchingRestaurant && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            Adding an item here will replace your current cart from {cartRestaurant?.name}.
          </Text>
        </View>
      )}

      <FlatList
        data={restaurant.menu || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.menuList}
        renderItem={({ item }) => (
          <View style={styles.menuItem}>
            <View style={styles.menuItemInfo}>
              <Text style={styles.menuItemName}>{item.name}</Text>
              <Text style={styles.menuItemDescription}>{item.description}</Text>
              <Text style={styles.menuItemPrice}>R{item.price}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
              onPress={() => addItem(restaurant, item)}
            >
              <Text style={styles.addButtonText}>Add</Text>
            </Pressable>
          </View>
        )}
      />

      {itemCount > 0 && (
        <Pressable style={styles.cartBar} onPress={() => navigation.navigate('Cart')}>
          <Text style={styles.cartBarText}>View cart · {itemCount} item{itemCount > 1 ? 's' : ''}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  loading: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  error: {
    color: colors.accentError,
    textAlign: 'center',
  },
  hero: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  heroSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 4,
  },
  warningBanner: {
    backgroundColor: `${colors.accentWarning}22`,
    padding: spacing.sm,
  },
  warningText: {
    color: colors.textPrimary,
    fontSize: 12,
    textAlign: 'center',
  },
  menuList: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  menuItemInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  menuItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  menuItemDescription: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: 6,
  },
  menuItemPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accentPrimary,
  },
  addButton: {
    backgroundColor: colors.bgMuted,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  addButtonPressed: {
    backgroundColor: colors.accentPrimary,
  },
  addButtonText: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cartBar: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.accentPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cartBarText: {
    color: colors.textInverse,
    fontWeight: '700',
  },
});

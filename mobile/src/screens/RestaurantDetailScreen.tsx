import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchRestaurant, imageSource } from '../api/client';
import { useCart } from '../context/CartContext';
import { colors, radius, spacing } from '../theme/colors';
import type { MenuItem, Restaurant } from '../types';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'RestaurantDetail'>;

type MenuSection = { title: string; data: MenuItem[] };

// A restaurant's page: cover photo, the facts, then the menu in its sections
// with a photo and an add / quantity control on every dish.
export default function RestaurantDetailScreen({ route, navigation }: Props) {
  const { restaurantId } = route.params;
  const { addItem, setQuantity, lines, itemCount, subtotal, restaurant: cartRestaurant } = useCart();
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

  const sections = useMemo<MenuSection[]>(() => {
    const menu = restaurant?.menu || [];
    const groups = new Map<string, MenuItem[]>();
    for (const item of menu) {
      const key = (item.category || '').trim() || 'Menu';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return [...groups.entries()].map(([title, data]) => ({ title, data }));
  }, [restaurant]);

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

  const closed = restaurant.open === false;
  const switchingRestaurant = cartRestaurant && cartRestaurant.id !== restaurant.id;
  const inCart = cartRestaurant?.id === restaurant.id ? lines : [];
  const quantityOf = (item: MenuItem) => inCart.find((l) => l.menuItem.id === item.id)?.quantity || 0;
  const cover = imageSource(restaurant.imageUrl || restaurant.thumbUrl);

  const header = (
    <View>
      <View style={[styles.cover, { backgroundColor: restaurant.heroColor }]}>
        {cover ? <Image source={cover} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.coverShade} />
        <View style={styles.coverText}>
          <Text style={styles.coverTitle}>{restaurant.name}</Text>
          <Text style={styles.coverSubtitle}>{restaurant.cuisine}</Text>
        </View>
      </View>

      <View style={styles.facts}>
        <Fact label={restaurant.rating == null ? 'New' : `★ ${restaurant.rating.toFixed(1)}`} sub={restaurant.ratingCount ? `${restaurant.ratingCount} ratings` : 'rating'} />
        <Fact label={`${restaurant.etaMinutes} min`} sub="delivery time" />
        <Fact label={restaurant.deliveryFee === 0 ? 'Free' : `R${restaurant.deliveryFee}`} sub="delivery" />
        <Fact label={closed ? 'Closed' : 'Open'} sub={closed ? 'not taking orders' : 'taking orders'} tone={closed ? 'bad' : 'good'} />
      </View>

      {closed && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>This kitchen is closed right now. You can browse the menu and come back when it opens.</Text>
        </View>
      )}
      {switchingRestaurant && !closed && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Adding a dish here replaces the cart you started at {cartRestaurant?.name}.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        ListHeaderComponent={header}
        contentContainerStyle={styles.menuList}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No dishes on the menu yet.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const qty = quantityOf(item);
          const img = imageSource(item.thumbUrl || item.imageUrl);
          return (
            <View style={styles.dish}>
              <View style={styles.dishInfo}>
                <Text style={styles.dishName}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.dishDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                <Text style={styles.dishPrice}>R{item.price}</Text>
              </View>
              <View style={styles.dishRight}>
                {img ? (
                  <Image source={img} style={styles.dishImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.dishImage, styles.dishImageEmpty]} />
                )}
                {closed ? null : qty === 0 ? (
                  <Pressable
                    style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
                    onPress={() => addItem(restaurant, item)}
                  >
                    <Text style={styles.addButtonText}>Add</Text>
                  </Pressable>
                ) : (
                  <View style={styles.stepper}>
                    <Pressable style={styles.stepBtn} onPress={() => setQuantity(item.id, qty - 1)} hitSlop={6}>
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.stepQty}>{qty}</Text>
                    <Pressable style={styles.stepBtn} onPress={() => addItem(restaurant, item)} hitSlop={6}>
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />

      {itemCount > 0 && cartRestaurant?.id === restaurant.id && (
        <Pressable style={styles.cartBar} onPress={() => navigation.navigate('Cart')}>
          <View style={styles.cartBadge}>
            <Text style={styles.cartBadgeText}>{itemCount}</Text>
          </View>
          <Text style={styles.cartBarText}>View cart</Text>
          <Text style={styles.cartBarTotal}>R{subtotal.toFixed(2)}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Fact({ label, sub, tone }: { label: string; sub: string; tone?: 'good' | 'bad' }) {
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, tone === 'good' && styles.factGood, tone === 'bad' && styles.factBad]}>{label}</Text>
      <Text style={styles.factSub}>{sub}</Text>
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
  emptyText: {
    color: colors.textSecondary,
  },
  cover: {
    height: 200,
    justifyContent: 'flex-end',
  },
  coverShade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  coverText: {
    padding: spacing.lg,
  },
  coverTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 8,
  },
  coverSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '600',
    marginTop: 2,
  },
  facts: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
  },
  fact: {
    flex: 1,
    alignItems: 'center',
  },
  factLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  factGood: {
    color: colors.accentSuccess,
  },
  factBad: {
    color: colors.accentError,
  },
  factSub: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  notice: {
    backgroundColor: `${colors.accentWarning}22`,
    padding: spacing.md,
  },
  noticeText: {
    color: colors.textPrimary,
    fontSize: 12,
    textAlign: 'center',
  },
  menuList: {
    paddingBottom: spacing.xxl * 3,
  },
  sectionHeader: {
    backgroundColor: colors.bgApp,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  dish: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  dishInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  dishName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  dishDescription: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 3,
  },
  dishPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.accentPrimary,
    marginTop: 8,
  },
  dishRight: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  dishImage: {
    width: 92,
    height: 92,
    borderRadius: radius.md,
  },
  dishImageEmpty: {
    backgroundColor: colors.bgMuted,
  },
  addButton: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 22,
  },
  addButtonPressed: {
    backgroundColor: colors.accentPrimary,
  },
  addButtonText: {
    fontWeight: '800',
    color: '#fff',
    fontSize: 13,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
  },
  stepBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  stepText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  stepQty: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    minWidth: 18,
    textAlign: 'center',
  },
  cartBar: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.accentPrimary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  cartBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: spacing.md,
  },
  cartBadgeText: {
    color: '#fff',
    fontWeight: '800',
  },
  cartBarText: {
    flex: 1,
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 15,
  },
  cartBarTotal: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 15,
  },
});

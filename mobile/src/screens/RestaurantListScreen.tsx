import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchRestaurants } from '../api/client';
import RestaurantCard from '../components/RestaurantCard';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { colors, spacing } from '../theme/colors';
import type { Restaurant } from '../types';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'RestaurantList'>;

export default function RestaurantListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { itemCount } = useCart();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchRestaurants();
      setRestaurants(data);
    } catch (err: any) {
      setError(err.message || 'Could not load restaurants.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi {user?.name?.split(' ')[0] || 'there'} 👋</Text>
          <Text style={styles.title}>What are you craving?</Text>
        </View>
        {itemCount > 0 && (
          <Pressable style={styles.cartPill} onPress={() => navigation.navigate('Cart')}>
            <Text style={styles.cartPillText}>Cart · {itemCount}</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loading} color={colors.accentPrimary} />
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={restaurants}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <RestaurantCard
              restaurant={item}
              onPress={() => navigation.navigate('RestaurantDetail', { restaurantId: item.id })}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  greeting: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  cartPill: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  cartPillText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 13,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  loading: {
    marginTop: spacing.xxl,
  },
  centered: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  error: {
    color: colors.accentError,
    textAlign: 'center',
  },
});
